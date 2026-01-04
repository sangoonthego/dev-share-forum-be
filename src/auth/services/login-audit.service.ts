import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LoginStatus } from '@prisma/client';

/**
 * LoginAuditService - Track login attempts và history
 * 
 * Features:
 * - Log successful login
 * - Log failed login attempts
 * - Log rate-limited attempts
 * - Get login history
 */
@Injectable()
export class LoginAuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * Log login attempt
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
      await this.prisma.login_audits.create({
        data: {
          user_id: userId,
          status,
          ip_address: ipAddress,
          user_agent: userAgent,
          attempted_email: attemptedEmail,
        },
      });
    } catch (error) {
      // Log but don't throw - audit failure shouldn't break auth
      console.error('Failed to log login attempt:', error);
    }
  }

  /**
   * Get recent login history for a user (last 10)
   */
  async getLoginHistory(userId: number, limit: number = 10) {
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
   * Used for rate limiting detection
   */
  async getFailedLoginAttempts(
    email: string,
    minutesBack: number = 15,
  ): Promise<number> {
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
   * Clear old audit logs (older than 90 days)
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
