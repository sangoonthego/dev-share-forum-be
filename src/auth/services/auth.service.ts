import { Injectable, ForbiddenException, UnauthorizedException, Logger, BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';
import { TokenService } from "./token.service";
import { JwtPayload, Tokens, OAuthProfile, OAuthUserResponse } from "../dto/auth.dto";
import { RedisService } from "src/redis/redis.service";
import { UserService } from "./user.service";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class AuthService {
  private logger = new Logger(AuthService.name);

  constructor(
    private tokenService: TokenService,
    private redisService: RedisService,
    private jwtService: JwtService,
    private userService: UserService,
    private prisma: PrismaService,
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

  async verifyEmail(token: string): Promise<{ message: string }> {
    const redisKey = `verify_email:${token}`;
    const userIdStr = await this.redisService.get(redisKey);

    if (!userIdStr) {
      throw new BadRequestException('Invalid or expired token');
    }

    const userId = parseInt(userIdStr, 10);

    await this.prisma.users.update({
      where: { id: userId },
      data: { is_verified: true },
    });

    await this.redisService.del(redisKey);
    return { message: 'Email verified successfully. You can now login.' };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const successMessage = 'If your account exists and is unverified, a new link has been sent';

    const user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!user || user.is_verified) {
      return { message: successMessage };
    }

    const rateLimitKey = `resend_cooldown:${user.id}`;
    const rateLimit = await this.redisService.get(rateLimitKey);

    if (rateLimit) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    await this.redisService.set(rateLimitKey, "1", 60); // 1 minute TTL

    const verificationToken = uuidv4();
    const redisKey = `verify_email:${verificationToken}`;

    // Store in Redis (TTL = 24 hours)
    await this.redisService.set(redisKey, user.id.toString(), 86400);

    const verificationLink = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
    this.logger.log(`Sending email to: ${user.email} Link: /auth/verify-email?token=${verificationToken}`);

    return { message: successMessage };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const successMessage = 'If your email is registered, a reset link has been sent.';

    const user = await this.prisma.users.findUnique({
      where: { email },
    });

    if (!user) {
      return { message: successMessage };
    }

    // Rate limiting to prevent email bombing
    const rateLimitKey = `forgot_password_limit:${user.id}`;
    const rateLimit = await this.redisService.get(rateLimitKey);

    if (rateLimit) {
      // Return success message even if rate limited to prevent enumeration via rate limits
      // Or throw an exception. The instruction says "ALWAYS return the exact same success message... Do not leak whether the user exists."
      // If we throw exception for existing users but not non-existing users, we leak.
      // So we just silently don't send the email if rate limited, or we apply rate limit by email/IP.
      // Applying rate limit silently is safer.
      return { message: successMessage };
    }

    await this.redisService.set(rateLimitKey, "1", 60);

    const resetToken = uuidv4();
    const redisKey = `reset_password:${resetToken}`;

    await this.redisService.set(redisKey, user.id.toString(), 3600); // 1 hour TTL

    const resetLink = `${process.env.FRONTEND_URL}/auth/reset-password?token=${resetToken}`;
    this.logger.log(`[Mock Email] Sending password reset email to ${user.email}: ${resetLink}`);

    return { message: successMessage };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const redisKey = `reset_password:${token}`;
    const userIdStr = await this.redisService.get(redisKey);

    if (!userIdStr) {
      throw new ForbiddenException('Invalid or expired reset token');
    }

    const userId = parseInt(userIdStr, 10);
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: passwordHash,
        token_version: { increment: 1 } // revoke all existing sessions
      },
    });

    await this.redisService.del(redisKey);
    // Revoke family sessions on redis
    await this.redisService.revokeAllTokens(userId);

    return { message: 'Password has been successfully reset. You can now login.' };
  }
}