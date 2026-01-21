import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { LoginStatus } from '@prisma/client';

@Injectable()
export class LoginAuditService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

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

      if (status === LoginStatus.FAILED && attemptedEmail) {
        const key = `failed_login:${attemptedEmail}:${ipAddress || 'unknown'}`;
        await this.redisService.incrementFailedLogin(key, 900); 
      }

      if (status === LoginStatus.SUCCESS && userId) {
        const key = `last_login:${userId}`;
        await this.redisService.setLastLogin(key, new Date().toISOString(), 2592000); 
      }
    } catch (error) {
      console.error('Failed to log login attempt:', error);
    }
  }

  async isRateLimited(email: string, ipAddress: string = 'unknown', threshold: number = 5): Promise<boolean> {
    const key = `failed_login:${email}:${ipAddress}`;
    const failedCount = await this.redisService.getFailedLoginCount(key);
    return failedCount >= threshold;
  }

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

  async getFailedLoginAttempts(
    email: string,
    minutesBack: number = 15,
    ipAddress?: string,
  ): Promise<number> {
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

  async clearFailedAttempts(email: string, ipAddress: string = 'unknown'): Promise<void> {
    const key = `failed_login:${email}:${ipAddress}`;
    await this.redisService.clearFailedLogin(key);
  }

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
