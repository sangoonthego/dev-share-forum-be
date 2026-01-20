import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { RedisService } from "src/redis/redis.service";
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { JwtPayload, Tokens } from "../dto/auth.dto";
import { LoggerService } from "src/common/logger/logger.service";

/**
 * TokenService - JWT & Refresh Token Management with Rotation
 * 
 * Security features:
 * - Generate unique JTI (JWT ID) for each access token
 * - Store RT in Redis (fast, revocable)
 * - Support token version for password change revocation
 * - **REFRESH TOKEN ROTATION**: Issue new RT on every refresh
 * - **TOKEN FAMILY REUSE DETECTION**: Detect and revoke if old RT reused
 * 
 * Architecture:
 * - Access Token: 15 minutes, includes jti for blacklisting
 * - Refresh Token: 7 days, stored hashed in Redis with key `rt:{userId}:{tokenFamily}`
 * - Token Family: Chain of RT generations for reuse detection
 * 
 * Refresh Token Rotation Flow:
 * 1. User calls /auth/refresh with old RT
 * 2. Verify old RT is valid (not revoked, not reused)
 * 3. Generate new AT + new RT (with new family ID)
 * 4. Invalidate old RT immediately
 * 5. Return new AT + new RT
 * 6. If old RT reused again, revoke ALL tokens (security breach)
 * 
 * Token Family Reuse Detection:
 * - Each RT has a tokenFamily ID (stored in Redis)
 * - If RT from old family is used, indicate token reuse attack
 * - Revoke all tokens for that user immediately
 * - Force re-authentication
 */
@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private logger: LoggerService,
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
   * - Stored hashed in Redis with token family for reuse detection
   * - Used to get new AT/RT pair
   * 
   * @param userId - User ID
   * @param email - User email
   * @param role - User role
   * @param tokenVersion - For password change detection
   * @param tokenFamily - Token family ID (for RT rotation tracking)
   */
  async getTokens(
    userId: number,
    email: string,
    role: string,
    tokenVersion: number = 1,
    tokenFamily?: string,
  ): Promise<Tokens> {
    // Generate unique JTI for access token (for blacklisting)
    const jti = uuidv4();
    
    // Generate token family if not provided (first login)
    const family = tokenFamily || uuidv4();
    
    // Calculate expiry times
    const atExpiresIn = 15 * 60; // 15 minutes
    const rtExpiresIn = 7 * 24 * 60 * 60; // 7 days

    const atPayload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion,
      jti, // Include JTI for blacklisting
      family, // Include family for token tracking
    };

    const rtPayload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion,
      family, // Token family for reuse detection
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

    // Hash and store RT in Redis with token family
    await this.storeRefreshTokenInRedis(userId, refreshToken, rtExpiresIn, family);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  /**
   * Store refresh token in Redis with token family tracking
   * 
   * Redis Key Structure:
   * - rt:{userId}:{family} = hashed RT (for verification)
   * - rt_family:{userId} = current family (for reuse detection)
   * 
   * @param userId - User ID
   * @param rt - Raw refresh token
   * @param expiresIn - Seconds until expiry
   * @param family - Token family ID
   */
  private async storeRefreshTokenInRedis(
    userId: number,
    rt: string,
    expiresIn: number,
    family: string,
  ): Promise<void> {
    // Hash RT with bcrypt before storing
    const hash = await bcrypt.hash(rt, 10);
    
    const familyKey = `rt:${userId}:${family}`;
    const currentFamilyKey = `rt_family:${userId}`;

    // Store RT hash with family
    await this.redisService.set(familyKey, hash, expiresIn);
    
    // Track current family (for reuse detection)
    await this.redisService.set(currentFamilyKey, family, expiresIn);

    this.logger.debug(`Refresh token stored with family ${family} for user ${userId}`);
  }

  /**
   * Get stored refresh token hash by family
   * @param userId - User ID
   * @param family - Token family ID
   */
  async getRefreshTokenHashFromRedis(
    userId: number,
    family: string,
  ): Promise<string | null> {
    const familyKey = `rt:${userId}:${family}`;
    return await this.redisService.get(familyKey);
  }

  /**
   * Verify RT validity and detect reuse
   * 
   * Checks:
   * 1. RT hash is valid (not expired, exists in Redis)
   * 2. Token family matches current family (not reused)
   * 3. If mismatch detected, trigger security alert
   * 
   * @param userId - User ID
   * @param rt - Provided refresh token
   * @param decodedFamily - Family from JWT payload
   * @returns { valid: boolean, shouldRotate: boolean, reuseDetected: boolean }
   */
  async verifyRefreshToken(
    userId: number,
    rt: string,
    decodedFamily: string,
  ): Promise<{ valid: boolean; shouldRotate: boolean; reuseDetected: boolean }> {
    const storedHash = await this.getRefreshTokenHashFromRedis(userId, decodedFamily);
    const currentFamily = await this.redisService.get(`rt_family:${userId}`);

    // Check 1: Hash exists and matches
    if (!storedHash) {
      // Old family token - possible reuse attack
      this.logger.logSecurityEvent(
        'Refresh token from old family attempted - possible reuse attack',
        userId,
        { family: decodedFamily },
      );

      return {
        valid: false,
        shouldRotate: false,
        reuseDetected: true,
      };
    }

    // Check 2: Hash comparison
    const hashValid = await bcrypt.compare(rt, storedHash);
    if (!hashValid) {
      this.logger.logSecurityEvent(
        'Refresh token hash mismatch - possible token tampering',
        userId,
      );

      return {
        valid: false,
        shouldRotate: false,
        reuseDetected: false,
      };
    }

    // Check 3: Family matches current family
    if (currentFamily && currentFamily !== decodedFamily) {
      // Token from old family - reuse detected
      this.logger.logSecurityEvent(
        'Token family mismatch - refresh token reuse detected',
        userId,
        { providedFamily: decodedFamily, currentFamily },
      );

      // Revoke all sessions immediately
      await this.revokeAllTokens(userId);

      return {
        valid: false,
        shouldRotate: false,
        reuseDetected: true,
      };
    }

    // Token is valid and ready for rotation
    return {
      valid: true,
      shouldRotate: true,
      reuseDetected: false,
    };
  }

  /**
   * Invalidate old refresh token (called after issuing new one)
   * 
   * Removes the old RT from Redis so it cannot be reused
   * New RT has a new family ID, so even if old RT is compromised,
   * using it will trigger reuse detection
   * 
   * @param userId - User ID
   * @param oldFamily - Old token family to invalidate
   */
  async invalidateRefreshToken(userId: number, oldFamily: string): Promise<void> {
    const familyKey = `rt:${userId}:${oldFamily}`;
    await this.redisService.del(familyKey);

    this.logger.debug(`Invalidated refresh token for user ${userId}, family ${oldFamily}`);
  }

  /**
   * Get stored refresh token hash (deprecated - kept for compatibility)
   * Use getRefreshTokenHashFromRedis with family parameter instead
   */
  async getRefreshTokenHashFromRedisLegacy(userId: number): Promise<string | null> {
    const key = `rt:${userId}`;
    return await this.redisService.get(key);
  }

  /**
   * Verify RT validity (deprecated - kept for compatibility)
   * Use verifyRefreshToken with family parameter instead
   */
  async verifyRefreshTokenLegacy(userId: number, rt: string): Promise<boolean> {
    const storedHash = await this.getRefreshTokenHashFromRedisLegacy(userId);
    
    if (!storedHash) {
      return false;
    }

    return await bcrypt.compare(rt, storedHash);
  }

  /**
   * Revoke all tokens for a user (security event)
   * 
   * Called when:
   * - User changes password
   * - Token reuse detected
   * - Suspicious activity detected
   * - User explicitly logs out from all devices
   * 
   * Clears all RT families to force re-authentication
   * 
   * @param userId - User ID
   */
  async revokeAllTokens(userId: number): Promise<void> {
    // Clear all token families for this user
    // Get all keys starting with rt:{userId}
    let cursor = '0';

    try {
      do {
        const [newCursor, keys] = await (this.redisService as any).redis.scan(
          cursor,
          'MATCH',
          `rt:${userId}:*`,
        );
        cursor = newCursor;

        if (keys && keys.length > 0) {
          for (const key of keys) {
            await this.redisService.del(key);
          }
        }
      } while (cursor !== '0');

      // Clear current family pointer
      await this.redisService.del(`rt_family:${userId}`);

      this.logger.logSecurityEvent(
        'All tokens revoked for user',
        userId,
        { reason: 'Security event' },
      );
    } catch (error) {
      this.logger.error('Failed to revoke all tokens', error);
      throw error;
    }
  }

  /**
   * Blacklist access token (on logout or when revoked)
   * @param jti - JWT ID (unique identifier)
   * @param expiresIn - Seconds until token expiry
   */
  async blacklistAccessToken(jti: string, expiresIn: number): Promise<void> {
    await this.redisService.blacklistToken(jti, expiresIn);
  }

  /**
   * Check if access token is blacklisted
   * @param jti - JWT ID
   */
  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    return await this.redisService.isTokenBlacklisted(jti);
  }
}
