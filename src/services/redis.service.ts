import Redis from "ioredis";
import { CONFIG } from "../config";

class RedisService {
  private client: Redis | null = null;
  private readonly DEFAULT_TTL = 3600; // 1 hour in seconds

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
