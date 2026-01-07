import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '../dto/auth.dto';
import { RedisService } from 'src/redis/redis.service';

/**
 * AtStrategy (Access Token Strategy)
 * 
 * Security features:
 * 1. Extract JWT from Authorization Bearer token
 * 2. Verify signature using JWT_AT_SECRET
 * 3. Check if JTI is blacklisted (token revocation)
 * 4. Validate payload
 * 
 * Workflow:
 * - GET /auth/me (with Authorization: Bearer <token>)
 * - Extract token → Passport validates signature
 * - Check Redis blacklist with jti
 * - If found in blacklist → token is revoked (user logged out)
 * - If not in blacklist → token is valid, proceed
 */
@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private redisService: RedisService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Ensure secret is string to satisfy Passport
      secretOrKey: process.env.JWT_AT_SECRET || 'at-secret-fallback',
    });
  }

  /**
   * Validate JWT payload and check blacklist
   * Called after JWT signature verification by Passport
   * 
   * @param payload - Decoded JWT payload
   * @throws UnauthorizedException if token is blacklisted
   */
  async validate(payload: any): Promise<JwtPayload> {
    const jwtPayload = payload as JwtPayload;

    // Check if this token (by JTI) has been blacklisted
    // Blacklisting happens when:
    // 1. User logout
    // 2. User password changed
    // 3. Admin force logout
    if (jwtPayload.jti) {
      const isBlacklisted = await this.redisService.isTokenBlacklisted(
        jwtPayload.jti,
      );

      if (isBlacklisted) {
        // Token was previously revoked (user logged out)
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    return jwtPayload;
  }
}
