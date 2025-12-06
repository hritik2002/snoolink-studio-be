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
        username: CONFIG.redis.username,
        password: CONFIG.redis.password,

        // Required for BullMQ
        maxRetriesPerRequest: null,

        retryStrategy: (times: number) => Math.min(times * 50, 2000),

        // TLS required for Redis Cloud
        tls: {
          rejectUnauthorized: false,
        },
      };

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
