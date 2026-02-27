import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { Request } from 'express';

@Injectable()
export class GlobalRateLimitGuard implements CanActivate {
  constructor(private redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user?.sub) {
      return true;
    }

    const userId = user.sub;
    const endpoint = request.path;
    const limits = this.getLimitConfig(endpoint);

    const key = `ratelimit:${endpoint}:user:${userId}`;
    
    try {
      const current = await this.redisService.incr(key);

      if (current === 1) {
        await this.redisService.expire(key, limits.windowSeconds);
      }

      if (current > limits.maxRequests) {
        const ttl = await this.redisService.ttl(key);
        throw new HttpException(
          {
            status: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests. Try again in ${ttl || limits.windowSeconds} seconds.`,
            error: 'TOO_MANY_REQUESTS',
            retryAfter: ttl || limits.windowSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error(`Rate limit check failed for user ${userId}:`, error);
      return true;
    }
  }

  private getLimitConfig(endpoint: string): { maxRequests: number; windowSeconds: number } {
    // Normalize path (remove /api/v1 prefix if present)
    const normalizedPath = endpoint.replace(/^\/api\/v\d+/, '');

    const configMap: Record<string, { maxRequests: number; windowSeconds: number }> = {
      '/auth/refresh': { maxRequests: 10, windowSeconds: 60 },
      '/auth/logout': { maxRequests: 5, windowSeconds: 60 },
      '/auth/change-password': { maxRequests: 3, windowSeconds: 60 },
    };

    return configMap[normalizedPath] || { maxRequests: 60, windowSeconds: 60 };
  }
  
  async resetUserLimit(userId: number, endpoint: string): Promise<void> {
    const key = `ratelimit:${endpoint}:user:${userId}`;
    await this.redisService.del(key);
  }
}

