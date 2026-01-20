import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserProfileResponse, OAuthProfile } from '../dto/auth.dto';

/**
 * UserService - Quản lý user profile
 * 
 * Responsibilities:
 * - Get user profile by ID
 * - Get user with full details
 * - Update user profile
 * - OAuth account linking (find/create/update users)
 */
@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get user profile by ID
   * @param userId - User ID from JWT
   * @returns User profile without sensitive data
   */
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
        // NOT selecting password_hash, token_version, meta (sensitive)
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user as UserProfileResponse;
  }

  /**
   * Update user profile (avatar, full_name, phone)
   */
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

  /**
   * Increment karma (for upvotes, helpful comments, etc.)
   */
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

  /**
   * Find user by email
   * Used for OAuth account linking - check if user already exists
   * 
   * @param email - User email
   * @returns User with full details or null if not found
   */
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

  /**
   * Update user's OAuth provider ID and avatar
   * 
   * Used when OAuth user logs in again:
   * 1. Check if email exists
   * 2. Update google_id or github_id field (stored in meta)
   * 3. Update profile_avatar if provided
   * 
   * @param userId - User ID
   * @param oauthProfile - OAuth profile with provider info
   * @returns Updated user
   */
  async updateOAuthProfile(
    userId: number,
    oauthProfile: OAuthProfile,
  ) {
    // Get current user to check if full_name already set
    const currentUser = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { meta: true, full_name: true },
    });

    // Prepare meta data for OAuth fields
    const updateData: any = {};

    // Only update avatar if provided from OAuth
    if (oauthProfile.profile_avatar) {
      updateData.profile_avatar = oauthProfile.profile_avatar;
    }

    // Update full_name only if not already set by user (preserve user's custom name)
    if (oauthProfile.full_name && !currentUser?.full_name) {
      updateData.full_name = oauthProfile.full_name;
    }

    // Store OAuth provider IDs in meta JSON field
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

  /**
   * Create new user from OAuth profile
   * 
   * Used when OAuth user logs in for the first time:
   * 1. Generate random secure password (won't be used)
   * 2. Create user with OAuth provider ID in meta
   * 3. Store avatar from OAuth provider
   * 
   * @param oauthProfile - OAuth profile from Passport strategy
   * @returns Created user
   */
  async createOAuthUser(oauthProfile: OAuthProfile) {
    // Generate random secure password (not used, OAuth only)
    // Using 32 random characters ensures strong password
    const randomPassword = require('crypto')
      .randomBytes(16)
      .toString('hex')
      .substring(0, 32);

    // Store OAuth provider IDs in meta JSON field
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

  /**
   * Hash password using bcrypt
   * @param password - Plain text password
   * @returns Hashed password
   */
  private async hashPassword(password: string): Promise<string> {
    const bcrypt = await import('bcrypt');
    return bcrypt.hash(password, 10);
  }
}
