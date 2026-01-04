import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

interface RateLimitStore {
  [key: string]: { attempts: number; resetTime: number };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  // In-memory store (for production use Redis)
  private store: RateLimitStore = {};

  // Config
  private readonly MAX_ATTEMPTS = 5;
  private readonly WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const email = request.body?.email || '';
    const ip = this.getClientIp(request);

    if (!email) {
      return true; // Allow if email not provided (let validation handle it)
    }

    // Create unique key for rate limiting
    const key = `${email}:${ip}`;

    // Get or initialize rate limit entry
    const now = Date.now();
    const entry = this.store[key];

    if (!entry || now > entry.resetTime) {
      // Window expired, reset
      this.store[key] = { attempts: 1, resetTime: now + this.WINDOW_MS };
      return true;
    }

    // Within window
    if (entry.attempts < this.MAX_ATTEMPTS) {
      entry.attempts++;
      return true;
    }

    // Exceeded limit
    const remainingTime = Math.ceil((entry.resetTime - now) / 1000);
    throw new HttpException(
      `Too many login attempts. Try again in ${remainingTime} seconds.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private getClientIp(request: Request): string {
    const forwarded = request.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return (request.socket?.remoteAddress || '0.0.0.0').split(':').pop() || '0.0.0.0';
  }

  resetLimit(email: string, ip: string): void {
    const key = `${email}:${ip}`;
    delete this.store[key];
  }

  cleanup(): void {
    const now = Date.now();
    Object.keys(this.store).forEach((key) => {
      if (now > this.store[key].resetTime) {
        delete this.store[key];
      }
    });
  }
}
