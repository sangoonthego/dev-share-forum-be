import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-github2';
import { AuthService } from '../services/auth.service';
import { OAuthProfile } from '../dto/auth.dto';

/**
 * GitHubStrategy - OAuth2 Authentication with GitHub
 *
 * Features:
 * - Uses GitHub OAuth2 flow
 * - Extracts user profile from GitHub API
 * - Delegates to AuthService for account linking & token generation
 *
 * Environment Variables Required:
 * - GITHUB_CLIENT_ID: OAuth App Client ID
 * - GITHUB_CLIENT_SECRET: OAuth App Client Secret
 * - GITHUB_CALLBACK_URL: Redirect URL (e.g., http://localhost:3000/auth/github/callback)
 *
 * Flow:
 * 1. User clicks "Sign in with GitHub"
 * 2. Frontend redirects to GET /auth/github
 * 3. Passport redirects to GitHub OAuth2 authorization screen
 * 4. User authorizes
 * 5. GitHub redirects to /auth/github/callback with authorization code
 * 6. Passport exchanges code for tokens and calls verify()
 * 7. verify() validates user and returns profile
 * 8. Auth controller handles token generation & cookie setup
 */
@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL,
      scope: ['user:email'], // Request email scope
    });
  }

  /**
   * Validate OAuth2 token and user profile
   *
   * Called after GitHub verifies the authorization code and returns user profile
   *
   * @param accessToken - GitHub access token (for API calls, stored in user.meta for future use)
   * @param refreshToken - GitHub refresh token (may not always be provided)
   * @param profile - User profile from GitHub
   * @param done - Callback function
   *
   * Returns: User object with OAuth info for account linking
   */
  async validate(
    accessToken: string,
    refreshToken: string | undefined,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      // Extract profile data from GitHub
      const { id: githubId, username, displayName, emails, photos } = profile;

      // GitHub might not return email in profile, need to request it
      const email = emails?.[0]?.value;
      const avatar = photos?.[0]?.value;

      if (!email) {
        return done(
          new Error(
            'GitHub profile does not contain email. Ensure "user:email" scope is requested.',
          ),
        );
      }

      // Prepare OAuth user data for account linking
      const oauthProfile: OAuthProfile = {
        provider: 'github',
        providerId: githubId,
        email,
        full_name: displayName || username || null,
        profile_avatar: avatar || null,
        githubId, // Explicit field for account linking
        githubUsername: username,
      };

      // Delegate to AuthService for account linking & token generation
      const userWithTokens = await this.authService.validateOAuthUser(
        oauthProfile,
      );

      // Pass user with tokens to controller
      done(null, userWithTokens);
    } catch (error) {
      done(error);
    }
  }
}
