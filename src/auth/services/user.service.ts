import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserProfileResponse } from '../dto/auth.dto';

/**
 * UserService - Quản lý user profile
 * 
 * Responsibilities:
 * - Get user profile by ID
 * - Get user with full details
 * - Update user profile
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
}
