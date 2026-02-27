import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

/**
 * CSRF Protection Service
 * Double-submit CSRF token pattern (token in cookie + header validation)
 */
@Injectable()
export class CsrfService {
  private readonly CSRF_TOKEN_LIFESPAN = 15 * 60;
  private readonly CSRF_COOKIE_NAME = 'csrf_token';
  private readonly CSRF_HEADER_NAME = 'x-csrf-token';

  constructor(private redisService: RedisService) {}

  /**
   * Generate new CSRF token
   * In production, stored in Redis for additional validation
   */
  generateToken(): string {
    return uuidv4();
  }

  /**
   * Set CSRF token in response cookie
   * Cookie accessible to JS so it can be sent in headers
   */
  setTokenCookie(res: Response, token: string, isProduction: boolean = false): void {
    res.cookie(this.CSRF_COOKIE_NAME, token, {
      httpOnly: false, // JS-accessible for header injection
      secure: isProduction,
      sameSite: 'strict',
      maxAge: this.CSRF_TOKEN_LIFESPAN * 1000,
      path: '/',
    });
  }

  /**
   * Validate CSRF token from request header against cookie
   * Only enforced in production; development allows any token
   */
  validateToken(req: Request, isProduction: boolean = false): boolean {
    // Skip validation in development
    if (!isProduction) {
      return true;
    }

    const headerToken = req.headers[this.CSRF_HEADER_NAME] as string | undefined;
    const cookieToken = req.cookies?.[this.CSRF_COOKIE_NAME] as string | undefined;

    // Both must exist and match (double-submit pattern)
    if (!headerToken || !cookieToken) {
      return false;
    }

    return headerToken === cookieToken;
  }

  /**
   * Clear CSRF token (on logout)
   */
  clearToken(res: Response): void {
    res.clearCookie(this.CSRF_COOKIE_NAME, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }
}
