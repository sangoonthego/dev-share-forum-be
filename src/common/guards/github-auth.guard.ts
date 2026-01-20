import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * GitHubAuthGuard - Passport guard for GitHub OAuth2 strategy
 * 
 * Usage:
 * @UseGuards(GitHubAuthGuard)
 * 
 * Automatically triggers GitHub OAuth2 flow when applied to a route
 * Passport will redirect to GitHub authorization screen
 */
@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {}
