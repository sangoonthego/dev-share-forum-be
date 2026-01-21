import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-github2';
import { AuthService } from '../services/auth.service';
import { OAuthProfile } from '../dto/auth.dto';

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
