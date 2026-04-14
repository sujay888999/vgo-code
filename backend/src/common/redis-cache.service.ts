import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export interface CacheOptions {
  ttl?: number;
}

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private client: Redis;

  constructor(private configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get("REDIS_HOST", "localhost"),
      port: this.configService.get("REDIS_PORT", 6379),
      password: this.configService.get("REDIS_PASSWORD"),
      db: this.configService.get("REDIS_DB", 0),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on("error", (err) => {
      console.error("Redis connection error:", err);
    });

    this.client.on("connect", () => {
      console.log("Redis connected successfully");
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      console.error("Redis get error:", error);
      return null;
    }
  }

  async set(key: string, value: any, options?: CacheOptions): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      if (options?.ttl) {
        await this.client.setex(key, options.ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (error) {
      console.error("Redis set error:", error);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error("Redis del error:", error);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error("Redis exists error:", error);
      return false;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      await this.client.expire(key, ttl);
      return true;
    } catch (error) {
      console.error("Redis expire error:", error);
      return false;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      console.error("Redis incr error:", error);
      return 0;
    }
  }

  async decr(key: string): Promise<number> {
    try {
      return await this.client.decr(key);
    } catch (error) {
      console.error("Redis decr error:", error);
      return 0;
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached) return cached;

    const value = await factory();
    await this.set(key, value, { ttl });
    return value;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.client.mget(...keys);
      return values.map((v) => (v ? JSON.parse(v) : null));
    } catch (error) {
      console.error("Redis mget error:", error);
      return keys.map(() => null);
    }
  }

  async mset(items: Record<string, any>, ttl?: number): Promise<boolean> {
    try {
      const pipeline = this.client.pipeline();
      for (const [key, value] of Object.entries(items)) {
        const serialized = JSON.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      }
      await pipeline.exec();
      return true;
    } catch (error) {
      console.error("Redis mset error:", error);
      return false;
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
