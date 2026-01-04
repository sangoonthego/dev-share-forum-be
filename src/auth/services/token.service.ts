import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "src/prisma/prisma.service";
import * as bcrypt from 'bcrypt';
import { JwtPayload, Tokens } from "../dto/auth.dto";

@Injectable()
export class TokenService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /**
   * Generate Access Token + Refresh Token
   * 
   * @param userId - User ID
   * @param email - User email
   * @param role - User role (ADMIN / USER)
   * @param tokenVersion - Token version (for invalidation on password change)
   * @returns { access_token, refresh_token }
   */
  async getTokens(
    userId: number,
    email: string,
    role: string,
    tokenVersion: number = 1,
  ): Promise<Tokens> {
    const payload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion, // Include version to detect password changes
    };

    const [at, rt] = await Promise.all([
      // Access Token: 15 minutes (short-lived)
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_AT_SECRET,
        expiresIn: '15m',
      }),
      // Refresh Token: 7 days (long-lived, but can be revoked)
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_RT_SECRET,
        expiresIn: '7d',
      }),
    ]);

    return { access_token: at, refresh_token: rt };
  }

  /**
   * Update or create refresh token hash in database
   * One user = one active session (for simplicity)
   * If multi-device needed, modify to use session_id instead of user_id @unique
   */
  async updateRtHash(userId: number, rt: string) {
    const salt = 10;
    const hash = await bcrypt.hash(rt, salt);

    await this.prisma.refresh_tokens.upsert({
      where: { user_id: userId },
      update: {
        token: hash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        is_revoked: false,
      },
      create: {
        user_id: userId,
        token: hash,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
}