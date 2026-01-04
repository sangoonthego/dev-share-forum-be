import { Injectable, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import * as bcrypt from 'bcrypt';
import { TokenService } from "./token.service";
import { JwtPayload, Tokens } from "../dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  async hashData(data: string) {
    return bcrypt.hash(data, 10);
  }

  /**
   * Refresh tokens with:
   * 1. Check if user exists
   * 2. Find stored refresh token
   * 3. Check if token was revoked
   * 4. Compare token hashes (detect reuse)
   * 5. Check if token_version matches (detect password change)
   * 6. Generate new tokens
   */
  async refreshTokens(userId: number, rt: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });
    
    if (!user) throw new ForbiddenException('Access Denied');

    // Find stored RT hash
    const storedToken = await this.prisma.refresh_tokens.findFirst({
      where: { user_id: userId, is_revoked: false },
    });

    if (!storedToken) throw new ForbiddenException('Access Denied');

    // Check if RT token is expired
    if (new Date() > storedToken.expires_at) {
      throw new ForbiddenException('Refresh token expired');
    }

    // Compare RT: if mismatch => token reuse attack detected => revoke all
    const rtMatches = await bcrypt.compare(rt, storedToken.token);
    if (!rtMatches) {
      // Revoke all tokens for this user (possible attack)
      await this.prisma.refresh_tokens.updateMany({
        where: { user_id: userId },
        data: { is_revoked: true },
      });
      throw new ForbiddenException('Token reuse detected - all sessions revoked');
    }

    // Generate new tokens with current token_version
    const tokens = await this.tokenService.getTokens(
      user.id,
      user.email,
      user.role,
      user.token_version,
    );

    await this.tokenService.updateRtHash(user.id, tokens.refresh_token);
    
    return tokens;
  }
}