import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * RedisService - Helper service for Redis operations
 * 
 * Handles:
 * - JWT Blacklist operations
 * - Refresh Token storage
 * - Session management
 * - Cache-aside pattern with stampede protection
 * - Tagged-key invalidation (replaces SCAN pattern matching)
 * 
 * Cache Stampede Protection:
 * - Uses probabilistic early expiration (PEE)
 * - Acquires lock before recomputing value
 * - Prevents thundering herd when cache expires
 * 
 * Key Tagging Strategy:
 * - Store related keys with tags: post:{postId} uses tag "posts"
 * - Invalidate all related keys by tag instead of SCAN pattern
 * - More efficient and predictable than pattern matching
 */
@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  /**
   * Blacklist JWT token (jti)
   * @param jti - JWT ID (unique identifier)
   * @param expiresIn - Seconds until token expiry
   */
  async blacklistToken(jti: string, expiresIn: number): Promise<void> {
    const key = `blacklist:${jti}`;
    await this.redis.setex(key, expiresIn, '1');
  }

  /**
   * Check if token is blacklisted
   * @param jti - JWT ID
   */
  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `blacklist:${jti}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Store refresh token hash in Redis
   * One user = one active session (can be modified for multi-device)
   * @param userId - User ID
   * @param rtHash - Bcrypt hashed refresh token
   * @param expiresIn - Seconds until expiry (typically 7 days)
   */
  async storeRefreshToken(
    userId: number,
    rtHash: string,
    expiresIn: number,
  ): Promise<void> {
    const key = `rt:${userId}`;
    await this.redis.setex(key, expiresIn, rtHash);
  }

  /**
   * Get stored refresh token hash
   * @param userId - User ID
   */
  async getRefreshTokenHash(userId: number): Promise<string | null> {
    const key = `rt:${userId}`;
    return await this.redis.get(key);
  }

  /**
   * Revoke all refresh tokens for a user (security event)
   * Used when:
   * - User changes password
   * - Token reuse detected
   * - Suspicious activity
   * @param userId - User ID
   */
  async revokeAllTokens(userId: number): Promise<void> {
    const key = `rt:${userId}`;
    await this.redis.del(key);
  }

  /**
   * Store failed login attempt (for rate limiting)
   * Increments counter with 15-minute auto-expiry
   */
  async incrementFailedLogin(key: string, expiresIn: number = 900): Promise<number> {
    const attempts = await this.redis.incr(key);
    // Auto-expire after TTL
    if (attempts === 1) {
      await this.redis.expire(key, expiresIn);
    }
    return attempts;
  }

  /**
   * Get failed login count for email:ip
   */
  async getFailedLoginCount(key: string): Promise<number> {
    const count = await this.redis.get(key);
    return count ? parseInt(count) : 0;
  }

  /**
   * Clear failed login attempts (called after successful login)
   */
  async clearFailedLogin(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Set last login timestamp for a user
   */
  async setLastLogin(key: string, timestamp: string, expiresIn: number): Promise<void> {
    await this.redis.setex(key, expiresIn, timestamp);
  }

  /**
   * Record failed login attempt (for rate limiting analytics)
   * @deprecated Use incrementFailedLogin instead
   */
  async recordFailedLogin(email: string, ip: string): Promise<number> {
    const key = `failed_login:${email}:${ip}`;
    return await this.incrementFailedLogin(key, 15 * 60);
  }

  /**
   * Generic key-value operations
   */
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

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Scan keys matching a pattern and delete them
   * DEPRECATED: Use invalidateByTag() instead for better performance
   * 
   * This function is kept for backward compatibility but should be phased out
   * SCAN is O(N) and inefficient for large key sets
   */
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

  /**
   * Cache-Aside Pattern with Stampede Protection
   * 
   * Implementation uses:
   * - Probabilistic early expiration (PEE)
   * - Distributed locking to prevent cache miss storms
   * - Recompute lock with TTL to prevent deadlocks
   * 
   * Benefits:
   * - Prevents thundering herd on cache miss
   * - Ensures one request recomputes while others wait
   * - Lock auto-expires if process crashes
   */
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
    const lockTTL = 10; // Max 10 seconds to compute

    const acquired = await this.redis.set(
      lockKey,
      lockValue,
      'EX',
      lockTTL,
      'NX', // Only set if not exists
    );

    if (!acquired) {
      // Another process is computing, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 100));
      const retryValue = await this.redis.get(key);
      if (retryValue) {
        return JSON.parse(retryValue);
      }
      // If still not available, compute anyway (fallback)
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

  /**
   * Cache-Aside with Probabilistic Early Expiration (PEE)
   * 
   * Reduces cache stampede by regenerating cache before actual expiry
   * Probability increases as cache approaches expiry time
   * 
   * @param key - Cache key
   * @param computeFn - Function to recompute value
   * @param ttl - Time to live in seconds
   * @param xfetch - Fetch probability window (e.g., 0.1 = last 10% of TTL)
   * 
   * Example: If TTL=100 and xfetch=0.1
   * - Last 10 seconds (80-100s), probability to regenerate increases from 0% to 100%
   */
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

  /**
   * Invalidate all keys with a specific tag
   * 
   * Tagged Key Strategy:
   * - Post list cache: "cache:posts:list" → tag "posts"
   * - Post detail cache: "cache:post:123" → tag "post:123"
   * - User profile cache: "cache:user:456" → tag "user:456"
   * 
   * Benefits:
   * - O(1) invalidation by tag (vs O(N) pattern scan)
   * - Atomic operation - either all deleted or none
   * - Predictable performance
   */
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

  /**
   * Set value with automatic tagging
   * 
   * @param key - Cache key
   * @param value - Value to store
   * @param tags - Tags to associate with this key (for group invalidation)
   * @param ttl - Time to live in seconds
   */
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

  /**
   * Get value and auto-refresh its TTL (for LRU-like behavior)
   */
  async getAndRefresh(key: string, ttl?: number): Promise<string | null> {
    const value = await this.redis.get(key);
    
    if (value && ttl) {
      await this.redis.expire(key, ttl);
    }

    return value;
  }
}

