import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserProfileResponse, OAuthProfile } from '../dto/auth.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async getUserProfile(userId: number): Promise<UserProfileResponse> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone: true,
        profile_avatar: true,
        role: true,
        karma: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user as UserProfileResponse;
  }

  async updateUserProfile(
    userId: number,
    data: {
      full_name?: string;
      phone?: string;
      profile_avatar?: string;
    },
  ): Promise<UserProfileResponse> {
    const user = await this.prisma.users.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        full_name: true,
        phone: true,
        profile_avatar: true,
        role: true,
        karma: true,
        created_at: true,
        updated_at: true,
      },
    });

    return user as UserProfileResponse;
  }

  async addKarma(userId: number, points: number): Promise<number> {
    const user = await this.prisma.users.update({
      where: { id: userId },
      data: {
        karma: {
          increment: points,
        },
      },
      select: { karma: true },
    });

    return user.karma;
  }

  async findByEmail(email: string) {
    return this.prisma.users.findUnique({
      where: { email },
      include: {
        refresh_tokens: {
          select: {
            id: true,
            expires_at: true,
            is_revoked: true,
          },
        },
      },
    });
  }

  async updateOAuthProfile(
    userId: number,
    oauthProfile: OAuthProfile,
  ) {
    const currentUser = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { meta: true, full_name: true },
    });

    const updateData: any = {};

    if (oauthProfile.profile_avatar) {
      updateData.profile_avatar = oauthProfile.profile_avatar;
    }

    if (oauthProfile.full_name && !currentUser?.full_name) {
      updateData.full_name = oauthProfile.full_name;
    }

    const meta = (currentUser?.meta as Record<string, any>) || {};

    if (oauthProfile.provider === 'google' && oauthProfile.googleId) {
      meta.google_id = oauthProfile.googleId;
    }

    if (oauthProfile.provider === 'github' && oauthProfile.githubId) {
      meta.github_id = oauthProfile.githubId;
      if (oauthProfile.githubUsername) {
        meta.github_username = oauthProfile.githubUsername;
      }
    }

    updateData.meta = meta;

    return this.prisma.users.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        full_name: true,
        phone: true,
        profile_avatar: true,
        role: true,
        karma: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  async createOAuthUser(oauthProfile: OAuthProfile) {
    const randomPassword = require('crypto')
      .randomBytes(16)
      .toString('hex')
      .substring(0, 32);

    const meta: Record<string, any> = {
      oauth_provider: oauthProfile.provider,
      created_via_oauth: true,
    };

    if (oauthProfile.provider === 'google' && oauthProfile.googleId) {
      meta.google_id = oauthProfile.googleId;
    }

    if (oauthProfile.provider === 'github' && oauthProfile.githubId) {
      meta.github_id = oauthProfile.githubId;
      if (oauthProfile.githubUsername) {
        meta.github_username = oauthProfile.githubUsername;
      }
    }

    return this.prisma.users.create({
      data: {
        email: oauthProfile.email,
        password_hash: await this.hashPassword(randomPassword),
        full_name: oauthProfile.full_name || null,
        profile_avatar: oauthProfile.profile_avatar || null,
        role: 'USER',
        meta,
        token_version: 1,
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone: true,
        profile_avatar: true,
        role: true,
        karma: true,
        created_at: true,
        updated_at: true,
      },
    });
  }

  private async hashPassword(password: string): Promise<string> {
    const bcrypt = await import('bcrypt');
    return bcrypt.hash(password, 10);
  }
}
