import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { RedisService } from "src/redis/redis.service";
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { JwtPayload, Tokens } from "../dto/auth.dto";

/**
 * TokenService - JWT & Refresh Token Management
 * 
 * Security features:
 * - Generate unique JTI (JWT ID) for each access token
 * - Store RT in Redis (fast, revocable)
 * - Support token version for password change revocation
 * 
 * Architecture:
 * - Access Token: 15 minutes, includes jti for blacklisting
 * - Refresh Token: 7 days, stored hashed in Redis with key `rt:{userId}`
 */
@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
  ) {}

  /**
   * Generate Access Token + Refresh Token pair
   * 
   * Access Token:
   * - Short-lived (15 minutes)
   * - Contains JTI for blacklist checking
   * - Used for API authorization
   * 
   * Refresh Token:
   * - Long-lived (7 days)
   * - Stored hashed in Redis
   * - Used to get new AT/RT pair
   * 
   * @param userId - User ID
   * @param email - User email
   * @param role - User role
   * @param tokenVersion - For password change detection
   */
  async getTokens(
    userId: number,
    email: string,
    role: string,
    tokenVersion: number = 1,
  ): Promise<Tokens> {
    // Generate unique JTI for access token (for blacklisting)
    const jti = uuidv4();
    
    // Calculate expiry times
    const atExpiresIn = 15 * 60; // 15 minutes
    const rtExpiresIn = 7 * 24 * 60 * 60; // 7 days

    const atPayload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion,
      jti, // Include JTI for blacklisting
    };

    const rtPayload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion,
    };

    const [accessToken, refreshToken] = await Promise.all([
      // Access Token - 15 minutes
      this.jwtService.signAsync(atPayload, {
        secret: process.env.JWT_AT_SECRET,
        expiresIn: `${atExpiresIn}s`,
      }),
      // Refresh Token - 7 days
      this.jwtService.signAsync(rtPayload, {
        secret: process.env.JWT_RT_SECRET,
        expiresIn: `${rtExpiresIn}s`,
      }),
    ]);

    // Hash and store RT in Redis (instead of PostgreSQL)
    await this.storeRefreshTokenInRedis(userId, refreshToken, rtExpiresIn);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  /**
   * Store refresh token in Redis (replaces PostgreSQL storage)
   * 
   * Design choice: One user = one active session
   * For multi-device: Use `rt:{userId}:{deviceId}` key format
   * 
   * @param userId - User ID
   * @param rt - Raw refresh token
   * @param expiresIn - Seconds until expiry
   */
  private async storeRefreshTokenInRedis(
    userId: number,
    rt: string,
    expiresIn: number,
  ): Promise<void> {
    // Hash RT with bcrypt before storing
    const hash = await bcrypt.hash(rt, 10);
    
    // Store in Redis with TTL = token expiry
    await this.redisService.storeRefreshToken(userId, hash, expiresIn);
  }

  /**
   * Get and verify RT hash from Redis
   * Returns the stored hash for comparison
   */
  async getRefreshTokenHashFromRedis(userId: number): Promise<string | null> {
    return await this.redisService.getRefreshTokenHash(userId);
  }

  /**
   * Verify RT validity
   * Compares provided RT against stored hash in Redis
   * 
   * @param userId - User ID
   * @param rt - Provided refresh token
   * @returns true if valid, false if invalid
   */
  async verifyRefreshToken(userId: number, rt: string): Promise<boolean> {
    const storedHash = await this.getRefreshTokenHashFromRedis(userId);
    
    if (!storedHash) {
      return false; // No RT stored (already revoked or first login)
    }

    // Compare provided RT against stored hash
    return await bcrypt.compare(rt, storedHash);
  }
}
