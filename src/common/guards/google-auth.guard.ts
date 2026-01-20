import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * GoogleAuthGuard - Passport guard for Google OAuth2 strategy
 * 
 * Usage:
 * @UseGuards(GoogleAuthGuard)
 * 
 * Automatically triggers Google OAuth2 flow when applied to a route
 * Passport will redirect to Google consent screen
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {}
