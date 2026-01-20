import { Injectable, ForbiddenException, UnauthorizedException, Logger } from "@nestjs/common";
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { TokenService } from "./token.service";
import { JwtPayload, Tokens, OAuthProfile, OAuthUserResponse } from "../dto/auth.dto";
import { RedisService } from "src/redis/redis.service";
import { UserService } from "./user.service";

/**
 * AuthService - Core authentication logic
 * 
 * Security features:
 * 1. Token verification with Redis blacklist
 * 2. Token reuse detection (revokes all tokens)
 * 3. JWT logout (immediate blacklisting)
 * 4. Redis storage instead of DB for RT
 * 5. OAuth2 account linking and validation
 */
@Injectable()
export class AuthService {
  private logger = new Logger(AuthService.name);

  constructor(
    private tokenService: TokenService,
    private redisService: RedisService,
    private jwtService: JwtService,
    private userService: UserService,
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

  /**
   * OAuth2 User Validation & Account Linking
   *
   * This is the core OAuth2 flow after Passport validates the user with Google/GitHub:
   *
   * Flow:
   * 1. Check if user exists by email
   * 2. If exists:
   *    - Update google_id or github_id in user.meta
   *    - Update profile_avatar if provided
   *    - Generate new tokens
   * 3. If not exists:
   *    - Create new user with random secure password
   *    - Store oauth_provider in meta
   *    - Generate initial tokens
   * 4. Return user + tokens to frontend
   *
   * Security:
   * - OAuth users don't have a password they can login with
   * - Password is random (crypto-secure) and never disclosed
   * - OAuth provider ID is stored in meta for future verifications
   * - Tokens follow same security model as local auth (JWT + Redis RT)
   *
   * @param oauthProfile - User profile from Passport strategy
   * @returns User data + tokens for immediate login
   */
  async validateOAuthUser(
    oauthProfile: OAuthProfile,
  ): Promise<OAuthUserResponse> {
    try {
      this.logger.debug(
        `[OAuth] Validating ${oauthProfile.provider} user: ${oauthProfile.email}`,
      );

      // Step 1: Check if user already exists by email
      const existingUser = await this.userService.findByEmail(
        oauthProfile.email,
      );

      let user;

      if (existingUser) {
        // Step 2: User exists - account linking
        this.logger.debug(
          `[OAuth] Linking ${oauthProfile.provider} to existing user #${existingUser.id}`,
        );

        // Update OAuth provider ID and avatar
        user = await this.userService.updateOAuthProfile(
          existingUser.id,
          oauthProfile,
        );

        // Check if password_hash exists (might be NULL for pure OAuth users)
        // For account linking, existing password is preserved
      } else {
        // Step 3: First-time OAuth login - create new user
        this.logger.debug(
          `[OAuth] Creating new user from ${oauthProfile.provider}`,
        );

        user = await this.userService.createOAuthUser(oauthProfile);
      }

      // Step 4: Generate JWT tokens
      const tokens = await this.tokenService.getTokens(
        user.id,
        user.email,
        user.role || 'USER',
        1, // token_version
      );

      this.logger.debug(
        `[OAuth] Generated tokens for user #${user.id} (${oauthProfile.provider})`,
      );

      // Step 5: Return user + tokens for controller to set cookie
      return {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        profile_avatar: user.profile_avatar,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      };
    } catch (error) {
      this.logger.error(
        `[OAuth] Validation failed for ${oauthProfile.provider}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}