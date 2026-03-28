import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt';
import type { Request } from 'express';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload } from '../dto/auth.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RtStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private prisma: PrismaService) {
    const options: StrategyOptionsWithRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          const token = req?.cookies?.refresh_token;
          if (!token) return null;
          return token;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      secretOrKey: process.env.JWT_RT_SECRET || 'rt-secret-fallback',
      passReqToCallback: true,
    };

    super(options);
  }

  async validate(req: Request, payload: any): Promise<JwtPayload & { refreshToken: string }> {
    const refreshToken =
      req?.cookies?.refresh_token ||
      req.get('authorization')?.replace('Bearer', '').trim();

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    const jwtPayload = payload as JwtPayload;

    const user = await this.prisma.user.findUnique({
      where: { id: jwtPayload.sub },
      select: { token_version: true },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (user.token_version !== jwtPayload.version) {
      throw new UnauthorizedException('Session invalidated due to security changes');
    }

    return {
      ...jwtPayload,
      refreshToken,
    };
  }
}
