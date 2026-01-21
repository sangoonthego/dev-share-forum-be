import { Injectable, ForbiddenException, UnauthorizedException, Logger } from "@nestjs/common";
import { JwtService } from '@nestjs/jwt';
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
  ) {}

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

    // Get stored RT hash from Redis using family
    const storedHash = await this.tokenService.getRefreshTokenHashFromRedis(
      userId,
      decodedRt.family,
    );

    if (!storedHash) {
      throw new ForbiddenException('Refresh token expired or revoked');
    }

    const rtVerification = await this.tokenService.verifyRefreshToken(
      userId,
      rt,
      decodedRt.family,
    );

    if (rtVerification.reuseDetected) {
      await this.tokenService.revokeAllTokens(userId);

      throw new ForbiddenException(
        'Token reuse detected - all sessions revoked. Please login again.',
      );
    }

    if (!rtVerification.valid) {
      throw new ForbiddenException('Invalid refresh token');
    }

    const tokens = await this.tokenService.getTokens(userId, '', '', 1, decodedRt.family);

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
  ): Promise<OAuthUserResponse> {
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
        1, 
      );

      this.logger.debug(
        `[OAuth] Generated tokens for user #${user.id} (${oauthProfile.provider})`,
      );

      // set cookies
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