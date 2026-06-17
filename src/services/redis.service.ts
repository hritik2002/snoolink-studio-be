import Redis from "ioredis";
import type { ConnectionOptions } from "bullmq";
import { CONFIG } from "../config";

class RedisService {
  private client: Redis | null = null;
  private readonly DEFAULT_TTL = 3600; // 1 hour in seconds
  private evictionPolicyReady = false;
  private skipBullMqVersionCheck = false;

  /**
   * BullMQ requires Redis maxmemory-policy=noeviction so queue keys are not evicted.
   * Attempts CONFIG SET on startup; if the provider blocks it, enables skipVersionCheck
   * and logs a single actionable warning instead of repeated BullMQ warnings.
   */
  async ensureEvictionPolicy(): Promise<void> {
    if (this.evictionPolicyReady) return;

    const client = this.getClient();
    if (client.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        if (client.status === "ready") {
          resolve();
          return;
        }
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          client.off("ready", onReady);
          client.off("error", onError);
        };
        client.once("ready", onReady);
        client.once("error", onError);
      });
    }

    try {
      const result = (await client.config("GET", "maxmemory-policy")) as string[];
      const current = result?.[1];

      if (current === "noeviction") {
        console.log("Redis maxmemory-policy: noeviction");
        this.evictionPolicyReady = true;
        return;
      }

      try {
        await client.config("SET", "maxmemory-policy", "noeviction");
        console.log(
          `Redis maxmemory-policy updated${current ? ` from ${current}` : ""} to noeviction`
        );
        this.evictionPolicyReady = true;
        return;
      } catch {
        this.skipBullMqVersionCheck = true;
        console.warn(
          `Redis maxmemory-policy is "${current ?? "unknown"}" (expected "noeviction"). ` +
            "Could not change it via CONFIG SET. On Railway, open your Redis service settings " +
            "and set maxmemory-policy to noeviction, or redeploy Redis with that policy. " +
            "Until then, BullMQ job data may be evicted under memory pressure."
        );
      }
    } catch (err) {
      this.skipBullMqVersionCheck = true;
      console.warn(
        "Could not read Redis maxmemory-policy:",
        err instanceof Error ? err.message : err
      );
    }

    this.evictionPolicyReady = true;
  }

  /** When true, pass skipVersionCheck to BullMQ (after ensureEvictionPolicy). */
  shouldSkipBullMqVersionCheck(): boolean {
    return this.skipBullMqVersionCheck;
  }

  /**
   * BullMQ bundles its own ioredis types; cast the shared client for queue/worker options.
   */
  getBullMqConnection(): ConnectionOptions {
    return this.getClient() as unknown as ConnectionOptions;
  }

  getClient(): Redis {
    if (!this.client) {
      const redisConfig: any = {
        host: CONFIG.redis.host,
        port: CONFIG.redis.port,
        username: CONFIG.redis.username,
        password: CONFIG.redis.password,
        db: CONFIG.redis.db,
        maxRetriesPerRequest: null, // Required for BullMQ
        retryStrategy: (times: number) => Math.min(times * 100, 3000),
        enableReadyCheck: true,
        lazyConnect: false,
        connectTimeout: 30000, // 30s connection timeout
        // Removed commandTimeout - let BullMQ handle job timeouts
        enableOfflineQueue: true, // Queue commands when disconnected
        keepAlive: 30000,
        family: 4,
      };

      this.client = new Redis(redisConfig);

      this.client.on("error", () => {
        // Silently handle errors - retryStrategy will reconnect
      });

      this.client.on("connect", () => {
        // Connection established
      });
    }

    return this.client;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const client = this.getClient();
      const value = await client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key: string, value: any, ttl: number = this.DEFAULT_TTL): Promise<boolean> {
    try {
      const client = this.getClient();
      const serialized = JSON.stringify(value);
      if (ttl > 0) {
        await client.setex(key, ttl, serialized);
      } else {
        await client.set(key, serialized);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete a key from cache
   */
  async delete(key: string): Promise<boolean> {
    try {
      const client = this.getClient();
      const result = await client.del(key);
      return result > 0;
    } catch {
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    try {
      const client = this.getClient();
      const stream = client.scanStream({
        match: pattern,
        count: 100,
      });

      let deletedCount = 0;
      const pipeline = client.pipeline();

      stream.on("data", (keys: string[]) => {
        keys.forEach((key) => {
          pipeline.del(key);
          deletedCount++;
        });
      });

      return new Promise((resolve, reject) => {
        stream.on("end", async () => {
          if (deletedCount > 0) {
            await pipeline.exec();
          }
          resolve(deletedCount);
        });

        stream.on("error", (error) => {
          reject(error);
        });
      });
    } catch {
      return 0;
    }
  }

  /**
   * Invalidate all cache keys for a user
   */
  async invalidateUserCache(userId: string): Promise<void> {
    const patterns = [
      `user:${userId}:*`,
      `collections:${userId}:*`,
      `resources:${userId}:*`,
      `profile:${userId}`,
    ];

    for (const pattern of patterns) {
      await this.deletePattern(pattern);
    }
  }

  /**
   * Invalidate cache for a specific collection
   */
  async invalidateCollectionCache(userId: string, collectionName: string): Promise<void> {
    const patterns = [
      `collections:${userId}:${collectionName}:*`,
      `resources:${userId}:${collectionName}:*`,
      // Collection detail (`getCollectionResourcesPaginated`)
      `resources:paginated:${userId}:${collectionName}:*`,
      // Media resources API with collection filter (`getResourcesPaginated`)
      `resources:${userId}:paginated:${collectionName}:*`,
      // Global Files page — all collections (`getResourcesPaginated` without collection)
      `resources:${userId}:paginated:all:*`,
      `collections:${userId}:list`,
    ];

    for (const pattern of patterns) {
      await this.deletePattern(pattern);
    }
  }

  /**
   * Invalidate all resource-related cache for a user
   */
  async invalidateResourcesCache(userId: string, collectionName?: string): Promise<void> {
    if (collectionName) {
      await this.invalidateCollectionCache(userId, collectionName);
    } else {
      await this.deletePattern(`resources:${userId}:*`);
    }
    // Also invalidate collections list
    await this.delete(`collections:${userId}:list`);
  }

  /**
   * Invalidate all search cache for a user
   */
  async invalidateSearchCache(userId: string, type?: "image" | "video"): Promise<void> {
    const pattern = type 
      ? `search:${type}:${userId}:*`
      : `search:*:${userId}:*`;
    await this.deletePattern(pattern);
  }
}

export const redisService = new RedisService();
