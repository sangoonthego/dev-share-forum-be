import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt';
import type { Request } from 'express';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload } from '../dto/auth.dto';

@Injectable()
export class RtStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor() {
    const options: StrategyOptionsWithRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        // Priority 1: Extract từ httpOnly cookie
        (req: Request) => {
          const token = req?.cookies?.refresh_token;
          if (!token) return null;
          return token;
        },
        // Priority 2: Extract từ Authorization header
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: process.env.JWT_RT_SECRET || 'rt-secret-fallback',
      passReqToCallback: true,
    };

    super(options);
  }

  /**
   * Validate refresh token payload
   * - Attach original RT để so sánh hash trong service
   * - Throw error nếu không tìm thấy RT
   */
  validate(req: Request, payload: any): JwtPayload & { refreshToken: string } {
    // Extract RT từ các nguồn
    const refreshToken =
      req?.cookies?.refresh_token ||
      req.get('authorization')?.replace('Bearer', '').trim();

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    return {
      ...(payload as JwtPayload),
      refreshToken,
    };
  }
}