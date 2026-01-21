import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../dto/auth.dto';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private redisService: RedisService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Ensure secret is string to satisfy Passport
      secretOrKey: process.env.JWT_AT_SECRET || 'at-secret-fallback',
    });
  }

  async validate(payload: any): Promise<JwtPayload> {
    const jwtPayload = payload as JwtPayload;

    if (jwtPayload.jti) {
      const isBlacklisted = await this.redisService.isTokenBlacklisted(
        jwtPayload.jti,
      );

      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    return jwtPayload;
  }
}
