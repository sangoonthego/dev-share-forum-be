import { Injectable, ForbiddenException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { RedisService } from "src/redis/redis.service";
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { JwtPayload, Tokens } from "../dto/auth.dto";
import { LoggerService } from "src/common/logger/logger.service";
import { AuthErrorCode, AuthException } from "../dto/auth-error.dto";

export interface TokensWithCsrf extends Tokens {
  csrf_token: string;
}

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private redisService: RedisService,
    private logger: LoggerService,
  ) { }

  async getTokens(
    userId: number,
    email: string,
    role: string,
    tokenVersion: number = 1,
    tokenFamily?: string,
  ): Promise<TokensWithCsrf> {
    const jti = uuidv4();
    const csrfToken = uuidv4(); // CSRF token for double-submit pattern

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
      csrf_token: csrfToken,
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
      csrf_token: csrfToken, // Add CSRF token to response
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

  /**
   * TRUE Atomic token rotation verification using Lua script
   * Prevents TOCTOU Race Conditions by enforcing a "Check-and-Consume" lock.
   */
  async verifyRefreshTokenAtomic(
    userId: number,
    rt: string,
    decodedFamily: string,
  ): Promise<{ valid: boolean; shouldRotate: boolean; reuseDetected: boolean }> {
    const familyKey = `rt:${userId}:${decodedFamily}`;
    const currentFamilyKey = `rt_family:${userId}`;

    // read current hash
    const storedHash = await this.redisService.get(familyKey);

    // check pass by bcrypt (Tốn CPU ~100ms)
    // Lúc này Node.js thoải mái nhường Event Loop. Ta không block Redis.
    if (storedHash) {
      const hashValid = await bcrypt.compare(rt, storedHash);
      if (!hashValid) {
        this.logger.logSecurityEvent('Refresh token hash mismatch - possible token tampering', userId);
        return { valid: false, shouldRotate: false, reuseDetected: false };
      }
    }

    // (Atomic Check-and-Consume)
    // Chỉ những request vượt qua được Bcrypt mới vào tới đây.
    const script = `
      local familyKey = KEYS[1]
      local currentFamilyKey = KEYS[2]
      local decodedFamily = ARGV[1]
      local expectedHash = ARGV[2] -- Có thể rỗng nếu storedHash ban đầu là null

      local currentFamily = redis.call('GET', currentFamilyKey)
      local currentHash = redis.call('GET', familyKey)

      -- 1. Family bị thay đổi -> Kẻ gian đang dùng Token cũ của một nhánh (Family) khác
      if currentFamily and currentFamily ~= decodedFamily then
        redis.call('DEL', familyKey)
        return 0 -- REUSE DETECTED
      end

      -- 2. Race Condition (TOCTOU) Caught!
      -- Phát hiện có kẻ "nẫng tay trên": Lúc đầu get có Hash, giờ Hash đã biến mất hoặc bị đổi 
      -- do một request chạy song song vừa Consume nó.
      if currentHash ~= expectedHash then
        return 0 -- REUSE DETECTED
      end

      -- 3. Hợp lệ & Trúng đích (Winner of the race)
      -- NGAY LẬP TỨC XÓA HASH để các request song song đến sau bị dính vào Case 2.
      -- Hàm getTokens() sau đó sẽ tự động set lại Hash mới vào Redis.
      if currentHash then
        redis.call('DEL', familyKey)
        return 1 -- SUCCESS
      end

      -- 4. Expired/Invalid (Không có hash từ đầu, nhưng không vi phạm reuse)
      return 2
    `;

    try {
      const redisClient = this.redisService.getClient();
      // Truyền storedHash vào ARGV[2]. Dùng || '' để tránh lỗi khi storedHash null
      const result = await redisClient.eval(
        script,
        2,
        familyKey,
        currentFamilyKey,
        decodedFamily,
        storedHash || ''
      ) as number;

      if (result === 0) {
        this.logger.logSecurityEvent(
          'Token reuse detected or Race Condition caught - triggering revocation',
          userId,
          { providedFamily: decodedFamily },
        );
        await this.revokeAllTokens(userId);
        return {
          valid: false,
          shouldRotate: false,
          reuseDetected: true,
        };
      }

      if (result === 2 || !storedHash) {
        return {
          valid: false,
          shouldRotate: false,
          reuseDetected: false,
        };
      }

      // result === 1 (Trường hợp duy nhất hợp lệ)
      return {
        valid: true,
        shouldRotate: true,
        reuseDetected: false,
      };
    } catch (error) {
      this.logger.error('Atomic token verification failed', error);
      throw new AuthException(
        AuthErrorCode.REFRESH_FAILED,
        403,
        'Token verification failed',
      );
    }
  }

  async verifyRefreshToken(
    userId: number,
    rt: string,
    decodedFamily: string,
  ): Promise<{ valid: boolean; shouldRotate: boolean; reuseDetected: boolean }> {
    // Delegate to atomic version for consistency
    return this.verifyRefreshTokenAtomic(userId, rt, decodedFamily);
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
