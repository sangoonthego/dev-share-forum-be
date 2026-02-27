import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  async blacklistToken(jti: string, expiresIn: number): Promise<void> {
    const key = `blacklist:${jti}`;
    await this.redis.setex(key, expiresIn, '1');
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `blacklist:${jti}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async storeRefreshToken(
    userId: number,
    rtHash: string,
    expiresIn: number,
  ): Promise<void> {
    const key = `rt:${userId}`;
    await this.redis.setex(key, expiresIn, rtHash);
  }

  async getRefreshTokenHash(userId: number): Promise<string | null> {
    const key = `rt:${userId}`;
    return await this.redis.get(key);
  }

  async revokeAllTokens(userId: number): Promise<void> {
    const key = `rt:${userId}`;
    await this.redis.del(key);
  }

  async incrementFailedLogin(key: string, expiresIn: number = 900): Promise<number> {
    const attempts = await this.redis.incr(key);
    // Auto-expire after TTL
    if (attempts === 1) {
      await this.redis.expire(key, expiresIn);
    }
    return attempts;
  }

  async getFailedLoginCount(key: string): Promise<number> {
    const count = await this.redis.get(key);
    return count ? parseInt(count) : 0;
  }

  async clearFailedLogin(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async setLastLogin(key: string, timestamp: string, expiresIn: number): Promise<void> {
    await this.redis.setex(key, expiresIn, timestamp);
  }

  async recordFailedLogin(email: string, ip: string): Promise<number> {
    const key = `failed_login:${email}:${ip}`;
    return await this.incrementFailedLogin(key, 15 * 60);
  }

  async set(key: string, value: string, expiresIn?: number): Promise<void> {
    if (expiresIn) {
      await this.redis.setex(key, expiresIn, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let deletedCount = 0;

    try {
      do {
        const [newCursor, keys] = await (this.redis as any).scan(
          cursor,
          'MATCH',
          pattern,
        );
        cursor = newCursor;

        if (keys && keys.length > 0) {
          deletedCount += await (this.redis as any).del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      console.error(`Error deleting keys matching pattern ${pattern}:`, error);
    }

    return deletedCount;
  }

  async getWithStampedeProtection<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl: number = 3600, // Default 1 hour
  ): Promise<T> {
    // 1. Try to get from cache
    const cached = await this.redis.get(key);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. Acquire lock to prevent stampede
    const lockKey = `lock:${key}`;
    const lockValue = Date.now().toString();
    const lockTTL = 10; 

    const acquired = await this.redis.set(
      lockKey,
      lockValue,
      'EX',
      lockTTL,
      'NX', 
    );

    if (!acquired) {
      // Another process is computing, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 100));
      const retryValue = await this.redis.get(key);
      if (retryValue) {
        return JSON.parse(retryValue);
      }
    }

    try {
      // 3. Compute new value
      const value = await computeFn();

      // 4. Store in cache
      await this.redis.setex(key, ttl, JSON.stringify(value));

      return value;
    } finally {
      // 5. Release lock
      const currentLock = await this.redis.get(lockKey);
      if (currentLock === lockValue) {
        await this.redis.del(lockKey);
      }
    }
  }

  async getWithProbabilisticExpiration<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl: number = 3600,
    xfetch: number = 0.1,
  ): Promise<T> {
    const cached = await this.redis.get(key);
    
    if (cached) {
      const ttlRemaining = await this.redis.ttl(key);
      const recomputeThreshold = ttl * xfetch;

      // Check if we should recompute probabilistically
      if (ttlRemaining > 0 && ttlRemaining < recomputeThreshold) {
        const probability = 1 - ttlRemaining / recomputeThreshold;
        
        if (Math.random() < probability) {
          // Recompute in background (fire and forget)
          this.getWithStampedeProtection(key, computeFn, ttl).catch(
            (err) => console.error('Background recomputation failed:', err),
          );
        }
      }

      return JSON.parse(cached);
    }

    // Cache miss - use stampede protection
    return this.getWithStampedeProtection(key, computeFn, ttl);
  }

  async invalidateByTag(tag: string): Promise<number> {
    const tagKey = `tag:${tag}`;
    
    try {
      // Get all keys with this tag
      const keys = await (this.redis as any).smembers(tagKey);
      let deletedCount = 0;

      if (keys && keys.length > 0) {
        // Delete all tagged keys
        deletedCount = await (this.redis as any).del(...keys);
        
        // Delete tag set itself
        await this.redis.del(tagKey);
      }

      return deletedCount;
    } catch (error) {
      console.error(`Error invalidating tag ${tag}:`, error);
      return 0;
    }
  }

  async setWithTags(
    key: string,
    value: string,
    tags: string[],
    ttl?: number,
  ): Promise<void> {
    if (ttl) {
      await this.redis.setex(key, ttl, value);
    } else {
      await this.redis.set(key, value);
    }

    // Add key to each tag set
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      await this.redis.sadd(tagKey, key);
      
      // Tag itself expires with the key
      if (ttl) {
        await this.redis.expire(tagKey, ttl);
      }
    }
  }

  async getAndRefresh(key: string, ttl?: number): Promise<string | null> {
    const value = await this.redis.get(key);
    
    if (value && ttl) {
      await this.redis.expire(key, ttl);
    }

    return value;
  }

  // Public methods for rate limiting and counters
  async incr(key: string): Promise<number> {
    return await this.redis.incr(key);
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return await this.redis.ttl(key);
  }
}

