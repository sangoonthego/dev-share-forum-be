import { Injectable, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { TokenService } from "./token.service";
import { JwtPayload, Tokens } from "../dto/auth.dto";
import { RedisService } from "src/redis/redis.service";

/**
 * AuthService - Core authentication logic
 * 
 * Security features:
 * 1. Token verification with Redis blacklist
 * 2. Token reuse detection (revokes all tokens)
 * 3. JWT logout (immediate blacklisting)
 * 4. Redis storage instead of DB for RT
 */
@Injectable()
export class AuthService {
  constructor(
    private tokenService: TokenService,
    private redisService: RedisService,
    private jwtService: JwtService,
  ) {}

  async hashData(data: string) {
    return bcrypt.hash(data, 10);
  }

  /**
   * Refresh tokens with advanced security checks
   * 
   * Flow:
   * 1. Get RT hash from Redis
   * 2. Verify RT against hash (detect reuse)
   * 3. If reuse detected → revoke ALL tokens
   * 4. Generate new AT/RT pair
   * 5. Store in Redis
   * 
   * @param userId - User ID
   * @param rt - Provided refresh token
   * @throws ForbiddenException if RT invalid or reuse detected
   */
  async refreshTokens(userId: number, rt: string): Promise<Tokens> {
    // Get stored RT hash from Redis
    const storedHash = await this.tokenService.getRefreshTokenHashFromRedis(
      userId,
    );

    if (!storedHash) {
      // No RT found - already revoked or session expired
      throw new ForbiddenException('Refresh token expired or revoked');
    }

    // Verify RT against stored hash
    const rtValid = await this.tokenService.verifyRefreshToken(userId, rt);

    if (!rtValid) {
      // SECURITY: Token reuse detected!
      // This suggests account compromise (token stolen)
      // Immediately revoke all tokens
      await this.redisService.revokeAllTokens(userId);

      throw new ForbiddenException(
        'Token reuse detected - all sessions revoked. Please login again.',
      );
    }

    // RT is valid, generate new tokens
    // NOTE: In real scenario, would fetch user to get token_version
    // For now, we trust the stored data
    const tokens = await this.tokenService.getTokens(userId, '', '', 1);

    return tokens;
  }

  /**
   * Logout - Immediate token blacklisting
   * 
   * Actions:
   * 1. Blacklist current AT (by JTI) in Redis
   * 2. Revoke all RT for this user
   * 3. Clear session data
   * 
   * Result: Token cannot be used immediately, even if it hasn't expired
   * 
   * @param jti - JWT ID of access token
   * @param userId - User ID
   * @param expiresIn - Seconds until token natural expiry
   */
  async logout(jti: string, userId: number, expiresIn: number): Promise<void> {
    // Add JTI to blacklist with TTL = token expiry time
    // After TTL, key auto-deletes (no need to manually clean)
    await this.redisService.blacklistToken(jti, expiresIn);

    // Revoke all RT for this user
    await this.redisService.revokeAllTokens(userId);
  }

  /**
   * Force logout all sessions (password change, admin action, etc.)
   * 
   * @param userId - User ID
   */
  async forceLogoutAllSessions(userId: number): Promise<void> {
    await this.redisService.revokeAllTokens(userId);
    // Note: AT will expire naturally, but could be blacklisted if needed
    // This would require storing all JTIs per user
  }

  /**
   * Decode JWT without verification (for getting claims)
   * Use with caution - only for non-critical operations
   */
  decodeToken(token: string): any {
    return this.jwtService.decode(token);
  }
}