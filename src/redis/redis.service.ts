import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * RedisService - Helper service for Redis operations
 * 
 * Handles:
 * - JWT Blacklist operations
 * - Refresh Token storage
 * - Session management
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
   * Uses SCAN for memory-efficient pattern matching
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
}
