import Redis from "ioredis";
import { CONFIG } from "../config";

class RedisService {
  private client: Redis | null = null;

  getClient(): Redis {
    if (!this.client) {
      const redisConfig: any = {
        host: CONFIG.redis.host,
        port: CONFIG.redis.port,
        db: CONFIG.redis.db,
        maxRetriesPerRequest: null, // Required for BullMQ
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
      };

      // Add optional configs
      if (CONFIG.redis.username) {
        redisConfig.username = CONFIG.redis.username;
      }
      if (CONFIG.redis.password) {
        redisConfig.password = CONFIG.redis.password;
      }
      if (CONFIG.redis.tls) {
        redisConfig.tls = CONFIG.redis.tls;
      }

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
}

export const redisService = new RedisService();
