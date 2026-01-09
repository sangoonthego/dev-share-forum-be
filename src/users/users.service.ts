import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserActivityService } from './user-activity.service';

export interface UserProfileStats {
  postCount: number;
  commentCount: number;
  karma: number;
}

export interface UserProfileWithActivity {
  id: number;
  email: string;
  full_name: string | null;
  profile_avatar: string | null;
  karma: number;
  created_at: Date;
  stats: UserProfileStats;
  activityChart: Array<{ date: string; count: number }>;
}

/**
 * UsersService - Enhanced user profile and stats
 * 
 * Responsibilities:
 * - Get user profile by username/email
 * - Calculate user stats (posts, comments, karma)
 * - Provide 365-day activity data
 * - Update user profile
 */
@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private userActivityService: UserActivityService,
  ) {}

  /**
   * Get complete profile with stats and activity chart
   * GET /users/:username/profile
   */
  async getProfileWithActivity(
    username: string,
  ): Promise<UserProfileWithActivity> {
    // Find user by email (using email as identifier)
    const user = await this.prisma.users.findUnique({
      where: { email: username },
      select: {
        id: true,
        email: true,
        full_name: true,
        profile_avatar: true,
        karma: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get stats in parallel
    const [postCount, commentCount, activityChart] = await Promise.all([
      // Count published posts
      this.prisma.posts.count({
        where: {
          author_id: user.id,
          deleted_at: null,
          status: 'PUBLISHED',
        },
      }),
      // Count comments (not deleted)
      this.prisma.comments.count({
        where: {
          author_id: user.id,
          deleted_at: null,
        },
      }),
      // Get 365-day activity
      this.userActivityService.get365DayActivity(user.id),
    ]);

    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      profile_avatar: user.profile_avatar,
      karma: user.karma,
      created_at: user.created_at,
      stats: {
        postCount,
        commentCount,
        karma: user.karma,
      },
      activityChart,
    };
  }

  /**
   * Get user profile by ID (internal use)
   */
  async getUserById(userId: number) {
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

    return user;
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: number,
    data: {
      full_name?: string;
      phone?: string;
      profile_avatar?: string;
    },
  ) {
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

    return user;
  }

  /**
   * Add karma to user (for upvotes, achievements, etc.)
   */
  async addKarma(userId: number, points: number): Promise<number> {
    const user = await this.prisma.users.update({
      where: { id: userId },
      data: {
        karma: { increment: points },
      },
    });
    return user.karma;
  }

  /**
   * Check if user exists by email
   */
  async userExists(email: string): Promise<boolean> {
    const user = await this.prisma.users.findUnique({
      where: { email },
    });
    return !!user;
  }
}
