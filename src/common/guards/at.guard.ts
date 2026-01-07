import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

/**
 * Access Token Guard with @Public() support
 * 
 * Features:
 * - Validates JWT access token via Passport JWT strategy
 * - Checks Redis blacklist via AtStrategy
 * - Allows @Public() routes to bypass authentication
 * - Can be applied globally to all routes
 * 
 * Usage:
 * - Global: app.useGlobalGuards(new AtGuard(reflector))
 * - Route: @UseGuards(AtGuard)
 * - Bypass: @Public() for public routes
 */
@Injectable()
export class AtGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  /**
   * Check if route is marked as @Public()
   * If yes, skip authentication
   */
  canActivate(context: any) {
    const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}