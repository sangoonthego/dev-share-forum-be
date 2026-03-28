import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from '../services/auth.service';
import { OAuthProfile } from '../dto/auth.dto';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ['profile', 'email'],
      state: true, 
      passReqToCallback: true, 
    });
  }

  async validate(
    req: any, 
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const { id: googleId, emails, displayName, photos } = profile;

      const email = emails?.[0]?.value;
      const avatar = photos?.[0]?.value;

      if (!email) {
        return done(new Error('Google profile does not contain email'));
      }

      const oauthProfile: OAuthProfile = {
        provider: 'google',
        providerId: googleId,
        email,
        full_name: displayName || null,
        profile_avatar: avatar || null,
        googleId, 
      };

      const userWithTokens = await this.authService.validateOAuthUser(
        oauthProfile,
      );

      done(null, userWithTokens);
    } catch (error) {
      done(error);
    }
  }
}

