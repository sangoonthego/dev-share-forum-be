import {
    Injectable,
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { AuthService } from 'src/auth/services/auth.service';

@Injectable()
export class RefreshRateLimitGuard implements CanActivate {
    private readonly logger = new Logger(RefreshRateLimitGuard.name);

    constructor(
        private redisService: RedisService,
        private authService: AuthService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const forwarded = request.get('x-forwarded-for');
        const ipAddress = forwarded
            ? forwarded.split(',')[0].trim()
            : request.socket?.remoteAddress || '0.0.0.0';

        const key = `rate_limit:refresh:${ipAddress}`;

        const currentCountStr = await this.redisService.get(key);
        let count = currentCountStr ? parseInt(currentCountStr, 10) : 0;
        count++;

        if (count === 1) {
            await this.redisService.set(key, count.toString(), 60);
        } else {
            await this.redisService.set(key, count.toString(), 60);
        }

        if (count > 20) {
            this.logger.warn(`[Security] IP ${ipAddress} exceeded absolute abuse threshold for /refresh.`);

            const refreshToken = request.cookies?.refresh_token;
            if (refreshToken) {
                try {
                    const decoded = this.authService.decodeToken(refreshToken);
                    if (decoded && decoded.sub) {
                        await this.authService.forceLogoutAllSessions(decoded.sub);
                        this.logger.warn(`[Security] Revoked all sessions for user #${decoded.sub} due to refresh spam.`);
                    }
                } catch (e) {
                    this.logger.error('Failed to decode token during abuse mitigation', e);
                }
            }
            throw new ForbiddenException('Suspicious activity detected. Session revoked.');
        }

        if (count > 5) {
            throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
        }

        return true;
    }
}
