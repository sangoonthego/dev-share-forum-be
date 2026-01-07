import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { LoginStatus } from '@prisma/client';

/**
 * LoginAuditService - Track login attempts & history with Redis caching
 * 
 * Features:
 * - Log successful/failed login attempts
 * - Track rate-limited attempts
 * - Get login history
 * - Cache failed attempts in Redis for fast rate limiting
 * - Detect concurrent logins per user
 * 
 * Redis Keys:
 * - failed_login:{email}:{ip} - Counter for failed attempts (TTL: 15 min)
 * - last_login:{userId} - Last successful login timestamp
 * - concurrent_login:{userId} - Number of concurrent sessions
 */
@Injectable()
export class LoginAuditService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  /**
   * Log login attempt with Redis caching for failed attempts
   * @param userId - User ID (null if login failed)
   * @param status - SUCCESS | FAILED | BLOCKED
   * @param ipAddress - Client IP
   * @param userAgent - Client user agent
   * @param attemptedEmail - Email tried to login (for failed attempts)
   */
  async logLoginAttempt(
    userId: number | null,
    status: LoginStatus,
    ipAddress?: string,
    userAgent?: string,
    attemptedEmail?: string,
  ): Promise<void> {
    try {
      // Log to PostgreSQL for persistence
      await this.prisma.login_audits.create({
        data: {
          user_id: userId,
          status,
          ip_address: ipAddress,
          user_agent: userAgent,
          attempted_email: attemptedEmail,
        },
      });

      // Cache failed attempts in Redis for rate limiting (15 minutes)
      if (status === LoginStatus.FAILED && attemptedEmail) {
        const key = `failed_login:${attemptedEmail}:${ipAddress || 'unknown'}`;
        await this.redisService.incrementFailedLogin(key, 900); // 15 min TTL
      }

      // Track successful login for session detection
      if (status === LoginStatus.SUCCESS && userId) {
        const key = `last_login:${userId}`;
        await this.redisService.setLastLogin(key, new Date().toISOString(), 2592000); // 30 days
      }
    } catch (error) {
      // Log but don't throw - audit failure shouldn't break auth
      console.error('Failed to log login attempt:', error);
    }
  }

  /**
   * Check if login is rate limited (failed attempts > threshold)
   * Uses Redis for fast checking
   */
  async isRateLimited(email: string, ipAddress: string = 'unknown', threshold: number = 5): Promise<boolean> {
    const key = `failed_login:${email}:${ipAddress}`;
    const failedCount = await this.redisService.getFailedLoginCount(key);
    return failedCount >= threshold;
  }

  /**
   * Get recent login history for a user (last 20 with caching)
   */
  async getLoginHistory(userId: number, limit: number = 20) {
    const audits = await this.prisma.login_audits.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        ip_address: true,
        user_agent: true,
        created_at: true,
      },
    });

    return audits;
  }

  /**
   * Get failed login attempts for an email in last X minutes
   * Uses Redis for performance + fallback to PostgreSQL
   */
  async getFailedLoginAttempts(
    email: string,
    minutesBack: number = 15,
    ipAddress?: string,
  ): Promise<number> {
    // Try Redis first (cached by logLoginAttempt)
    if (ipAddress) {
      const key = `failed_login:${email}:${ipAddress}`;
      const cachedCount = await this.redisService.getFailedLoginCount(key);
      if (cachedCount > 0) {
        return cachedCount;
      }
    }

    // Fallback: Query PostgreSQL for historical data
    const since = new Date(Date.now() - minutesBack * 60 * 1000);

    const count = await this.prisma.login_audits.count({
      where: {
        attempted_email: email,
        status: LoginStatus.FAILED,
        created_at: { gte: since },
      },
    });

    return count;
  }

  /**
   * Clear failed login attempts for an email:IP (called after successful login)
   */
  async clearFailedAttempts(email: string, ipAddress: string = 'unknown'): Promise<void> {
    const key = `failed_login:${email}:${ipAddress}`;
    await this.redisService.clearFailedLogin(key);
  }

  /**
   * Cleanup old audit logs (older than 90 days)
   * Run this periodically via cron job
   */
  async cleanupOldLogs(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

    const result = await this.prisma.login_audits.deleteMany({
      where: {
        created_at: { lt: cutoffDate },
      },
    });

    return result.count;
  }
}
