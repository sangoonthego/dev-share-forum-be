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

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private userActivityService: UserActivityService,
  ) {}

  async getProfileWithActivity(
    username: string,
  ): Promise<UserProfileWithActivity> {
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

    const [postCount, commentCount, activityChart] = await Promise.all([

      this.prisma.posts.count({
        where: {
          author_id: user.id,
          deleted_at: null,
          status: 'PUBLISHED',
        },
      }),
      this.prisma.comments.count({
        where: {
          author_id: user.id,
          deleted_at: null,
        },
      }),
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

  async addKarma(userId: number, points: number): Promise<number> {
    const user = await this.prisma.users.update({
      where: { id: userId },
      data: {
        karma: { increment: points },
      },
    });
    return user.karma;
  }

  async userExists(email: string): Promise<boolean> {
    const user = await this.prisma.users.findUnique({
      where: { email },
    });
    return !!user;
  }
}
