import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from '../services/auth.service';
import { OAuthProfile } from '../dto/auth.dto';

/**
 * GoogleStrategy - OAuth2 Authentication with Google
 *
 * Features:
 * - Uses Google OAuth2 flow
 * - Extracts user profile from Google API
 * - Delegates to AuthService for account linking & token generation
 *
 * Environment Variables Required:
 * - GOOGLE_CLIENT_ID: OAuth App Client ID
 * - GOOGLE_CLIENT_SECRET: OAuth App Client Secret
 * - GOOGLE_CALLBACK_URL: Redirect URL (e.g., http://localhost:3000/auth/google/callback)
 *
 * Flow:
 * 1. User clicks "Sign in with Google"
 * 2. Frontend redirects to GET /auth/google
 * 3. Passport redirects to Google OAuth2 consent screen
 * 4. User authorizes
 * 5. Google redirects to /auth/google/callback with authorization code
 * 6. Passport exchanges code for tokens and calls verify()
 * 7. verify() validates user and returns profile
 * 8. Auth controller handles token generation & cookie setup
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ['profile', 'email'], // Request profile & email scopes
    });
  }

  /**
   * Validate OAuth2 token and user profile
   *
   * Called after Google verifies the authorization code and returns user profile
   *
   * @param accessToken - Google access token (for API calls, not stored)
   * @param refreshToken - Google refresh token (long-lived, for refreshing access)
   * @param profile - User profile from Google
   * @param done - Callback function
   *
   * Returns: User object with OAuth info for account linking
   */
  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      // Extract profile data from Google
      const { id: googleId, emails, displayName, photos } = profile;

      const email = emails?.[0]?.value;
      const avatar = photos?.[0]?.value;

      if (!email) {
        return done(new Error('Google profile does not contain email'));
      }

      // Prepare OAuth user data for account linking
      const oauthProfile: OAuthProfile = {
        provider: 'google',
        providerId: googleId,
        email,
        full_name: displayName || null,
        profile_avatar: avatar || null,
        googleId, // Explicit field for account linking
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
