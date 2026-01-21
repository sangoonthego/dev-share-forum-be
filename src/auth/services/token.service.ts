import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { RedisService } from "src/redis/redis.service";
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { JwtPayload, Tokens } from "../dto/auth.dto";
import { LoggerService } from "src/common/logger/logger.service";

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private logger: LoggerService,
  ) {}

  async getTokens(
    userId: number,
    email: string,
    role: string,
    tokenVersion: number = 1,
    tokenFamily?: string,
  ): Promise<Tokens> {
    const jti = uuidv4();
    
    // Generate token family if not provided (first login)
    const family = tokenFamily || uuidv4();
    
    // Calculate expiry times
    const atExpiresIn = 15 * 60; 
    const rtExpiresIn = 7 * 24 * 60 * 60; 

    const atPayload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion,
      jti, 
      family, 
    };

    const rtPayload: JwtPayload = {
      sub: userId,
      email,
      role,
      version: tokenVersion,
      family, 
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(atPayload, {
        secret: process.env.JWT_AT_SECRET,
        expiresIn: `${atExpiresIn}s`,
      }),
      this.jwtService.signAsync(rtPayload, {
        secret: process.env.JWT_RT_SECRET,
        expiresIn: `${rtExpiresIn}s`,
      }),
    ]);

    await this.storeRefreshTokenInRedis(userId, refreshToken, rtExpiresIn, family);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private async storeRefreshTokenInRedis(
    userId: number,
    rt: string,
    expiresIn: number,
    family: string,
  ): Promise<void> {
    const hash = await bcrypt.hash(rt, 10);
    
    const familyKey = `rt:${userId}:${family}`;
    const currentFamilyKey = `rt_family:${userId}`;

    // Store RT hash with family
    await this.redisService.set(familyKey, hash, expiresIn);
    
    // Track current family (for reuse detection)
    await this.redisService.set(currentFamilyKey, family, expiresIn);

    this.logger.debug(`Refresh token stored with family ${family} for user ${userId}`);
  }

  async getRefreshTokenHashFromRedis(
    userId: number,
    family: string,
  ): Promise<string | null> {
    const familyKey = `rt:${userId}:${family}`;
    return await this.redisService.get(familyKey);
  }

  async verifyRefreshToken(
    userId: number,
    rt: string,
    decodedFamily: string,
  ): Promise<{ valid: boolean; shouldRotate: boolean; reuseDetected: boolean }> {
    const storedHash = await this.getRefreshTokenHashFromRedis(userId, decodedFamily);
    const currentFamily = await this.redisService.get(`rt_family:${userId}`);

    if (!storedHash) {
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

    if (currentFamily && currentFamily !== decodedFamily) {
      this.logger.logSecurityEvent(
        'Token family mismatch - refresh token reuse detected',
        userId,
        { providedFamily: decodedFamily, currentFamily },
      );

      await this.revokeAllTokens(userId);

      return {
        valid: false,
        shouldRotate: false,
        reuseDetected: true,
      };
    }

    return {
      valid: true,
      shouldRotate: true,
      reuseDetected: false,
    };
  }

  async invalidateRefreshToken(userId: number, oldFamily: string): Promise<void> {
    const familyKey = `rt:${userId}:${oldFamily}`;
    await this.redisService.del(familyKey);

    this.logger.debug(`Invalidated refresh token for user ${userId}, family ${oldFamily}`);
  }

  async getRefreshTokenHashFromRedisLegacy(userId: number): Promise<string | null> {
    const key = `rt:${userId}`;
    return await this.redisService.get(key);
  }

  async verifyRefreshTokenLegacy(userId: number, rt: string): Promise<boolean> {
    const storedHash = await this.getRefreshTokenHashFromRedisLegacy(userId);
    
    if (!storedHash) {
      return false;
    }

    return await bcrypt.compare(rt, storedHash);
  }

  async revokeAllTokens(userId: number): Promise<void> {
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

  async blacklistAccessToken(jti: string, expiresIn: number): Promise<void> {
    await this.redisService.blacklistToken(jti, expiresIn);
  }

  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    return await this.redisService.isTokenBlacklisted(jti);
  }
}
