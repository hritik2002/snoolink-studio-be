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
        maxRetriesPerRequest: null,
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
      };

      console.log(redisConfig);

      this.client = new Redis(redisConfig);

      this.client.on("error", (error) => {
        console.error("Redis connection error:", error);
      });

      this.client.on("connect", async () => {
        console.log("Redis connected successfully");
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
    } catch (error) {
      console.error(`Redis get error for key ${key}:`, error);
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
    } catch (error) {
      console.error(`Redis set error for key ${key}:`, error);
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
    } catch (error) {
      console.error(`Redis delete error for key ${key}:`, error);
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
          console.error(`Redis deletePattern error for pattern ${pattern}:`, error);
          reject(error);
        });
      });
    } catch (error) {
      console.error(`Redis deletePattern error for pattern ${pattern}:`, error);
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
}

export const redisService = new RedisService();
