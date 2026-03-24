import { Injectable, ForbiddenException, UnauthorizedException, Logger } from "@nestjs/common";
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { TokenService } from "./token.service";
import { JwtPayload, Tokens, OAuthProfile, OAuthUserResponse } from "../dto/auth.dto";
import { RedisService } from "src/redis/redis.service";
import { UserService } from "./user.service";

@Injectable()
export class AuthService {
  private logger = new Logger(AuthService.name);

  constructor(
    private tokenService: TokenService,
    private redisService: RedisService,
    private jwtService: JwtService,
    private userService: UserService,
  ) { }

  async hashData(data: string) {
    return bcrypt.hash(data, 10);
  }

  async refreshTokens(userId: number, rt: string): Promise<Tokens> {
    // Decode RT to extract family
    let decodedRt: any;
    try {
      decodedRt = this.jwtService.decode(rt) as { family?: string; sub?: number };
    } catch (e) {
      throw new ForbiddenException('Invalid refresh token format');
    }

    if (!decodedRt || !decodedRt.family) {
      throw new ForbiddenException('Refresh token missing family identifier');
    }

    const rtVerification = await this.tokenService.verifyRefreshToken(
      userId,
      rt,
      decodedRt.family,
    );

    if (rtVerification.reuseDetected) {
      await this.tokenService.invalidateRefreshToken(userId, decodedRt.family);
      throw new ForbiddenException(
        'Token reuse detected - Family session revoked. Please login again.',
      );
    }

    if (!rtVerification.valid) {
      throw new UnauthorizedException('Refresh token missing or expired');
    }

    const user = await this.userService.findById(userId);

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const tokens = await this.tokenService.getTokens(
      userId,
      user.email,
      user.role,
      user.token_version,
      decodedRt.family // Pass the exact same family string
    );

    return tokens;
  }

  async logout(jti: string, userId: number, expiresIn: number): Promise<void> {
    await this.redisService.blacklistToken(jti, expiresIn);

    await this.redisService.revokeAllTokens(userId);
  }

  async forceLogoutAllSessions(userId: number): Promise<void> {
    await this.redisService.revokeAllTokens(userId);
  }

  decodeToken(token: string): any {
    return this.jwtService.decode(token);
  }

  async validateOAuthUser(
    oauthProfile: OAuthProfile,
  ): Promise<{ authorizationCode: string }> {
    try {
      this.logger.debug(
        `[OAuth] Validating ${oauthProfile.provider} user: ${oauthProfile.email}`,
      );

      const existingUser = await this.userService.findByEmail(
        oauthProfile.email,
      );

      let user;

      if (existingUser) {
        this.logger.debug(
          `[OAuth] Linking ${oauthProfile.provider} to existing user #${existingUser.id}`,
        );

        user = await this.userService.updateOAuthProfile(
          existingUser.id,
          oauthProfile,
        );

      } else {
        this.logger.debug(
          `[OAuth] Creating new user from ${oauthProfile.provider}`,
        );

        user = await this.userService.createOAuthUser(oauthProfile);
      }

      const tokens = await this.tokenService.getTokens(
        user.id,
        user.email,
        user.role || 'USER',
        user.token_version,
      );

      this.logger.debug(
        `[OAuth] Generated tokens for user #${user.id} (${oauthProfile.provider})`,
      );

      // Generate authorization code for secure code exchange
      const authorizationCode = uuidv4();
      const redisKey = `oauth_code:${authorizationCode}`;

      // Store tokens in Redis with 5 minute TTL (300 seconds)
      const oauthCodeData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        csrf_token: tokens.csrf_token,
        userId: user.id,
        email: user.email,
      };

      await this.redisService.set(
        redisKey,
        JSON.stringify(oauthCodeData),
        300, // 5 minutes TTL
      );

      this.logger.debug(
        `[OAuth] Generated authorization code for user #${user.id}`,
      );

      return { authorizationCode };
    } catch (error) {
      this.logger.error(
        `[OAuth] Validation failed for ${oauthProfile.provider}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async exchangeOAuthCode(authorizationCode: string): Promise<Tokens | null> {
    try {
      const redisKey = `oauth_code:${authorizationCode}`;

      // Get tokens from Redis
      const storedData = await this.redisService.get(redisKey);

      if (!storedData) {
        this.logger.warn(
          `[OAuth] Authorization code exchange failed: invalid or expired code`,
        );
        return null;
      }

      // Parse the stored data
      const oauthCodeData = JSON.parse(storedData);

      // Delete the code immediately (single-use constraint)
      await this.redisService.del(redisKey);

      this.logger.debug(
        `[OAuth] Successfully exchanged authorization code for user #${oauthCodeData.userId}`,
      );

      return {
        access_token: oauthCodeData.access_token,
        refresh_token: oauthCodeData.refresh_token,
        csrf_token: oauthCodeData.csrf_token,
      };
    } catch (error) {
      this.logger.error(
        `[OAuth] Code exchange failed: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }
}