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
        retryStrategy: (times: number) => Math.min(times * 50, 2000),
      };

      // Add authentication if provided
      if (CONFIG.redis.username) {
        redisConfig.username = CONFIG.redis.username;
      }
      if (CONFIG.redis.password) {
        redisConfig.password = CONFIG.redis.password;
      }

      // Add TLS configuration for Redis Cloud (or if explicitly enabled)
      // Redis Cloud requires TLS
      if (CONFIG.redis.tls !== undefined || CONFIG.redis.host.includes("redislabs.com") || CONFIG.redis.host.includes("redis.cloud")) {
        redisConfig.tls = {
          rejectUnauthorized: false, // Redis Cloud uses self-signed certificates
          minVersion: "TLSv1.2",
        };
      }

      this.client = new Redis(redisConfig);

      this.client.on("error", (error) => {
        console.error("Redis connection error:", error);
      });

      this.client.on("connect", async () => {
        console.log("Redis connected successfully");
        // Verify eviction policy is set to noeviction (required for BullMQ)
        try {
          const maxmemoryPolicy = await this.client!.config("GET", "maxmemory-policy");
          const policy = (maxmemoryPolicy as any[])?.[1];
          if (policy !== "noeviction") {
            console.warn(
              `⚠️  WARNING: Redis eviction policy is "${policy}" but should be "noeviction". ` +
                `This can cause job data loss. Set it with: CONFIG SET maxmemory-policy noeviction`
            );
          } else {
            console.log(
              "✅ Redis eviction policy is correctly set to 'noeviction'"
            );
          }
        } catch (error) {
          console.warn("Could not verify Redis eviction policy:", error);
        }
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
