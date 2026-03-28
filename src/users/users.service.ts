import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserActivityService } from './user-activity.service';
import { ProviderUserDto } from './dto/provider-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

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
  ) { }

  async getProfileWithActivity(
    username: string,
  ): Promise<UserProfileWithActivity> {
    const user = await this.prisma.user.findUnique({
      where: { email: username },
      select: {
        id: true,
        email: true,
        karma: true,
        createdAt: true,
        profile: {
          select: {
            fullName: true,
            avatarUrl: true,
          }
        }
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
      full_name: user.profile?.fullName || null,
      profile_avatar: user.profile?.avatarUrl || null,
      karma: user.karma,
      created_at: user.createdAt,
      stats: {
        postCount,
        commentCount,
        karma: user.karma,
      },
      activityChart,
    };
  }

  async findById(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId }
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
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

  async addKarma(userId: number, points: number): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        karma: { increment: points },
      },
    });
    return user.karma;
  }

  async userExists(email: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    return !!user;
  }

  async updateOAuthProfile(userId: number, oauthProfile: ProviderUserDto) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { meta: true, profile: { select: { fullName: true } } },
    });

    const updateProfileData: any = {};
    if (oauthProfile.profile_avatar) {
      updateProfileData.avatarUrl = oauthProfile.profile_avatar;
    }
    if (oauthProfile.full_name && !currentUser?.profile?.fullName) {
      updateProfileData.fullName = oauthProfile.full_name;
    }

    if (Object.keys(updateProfileData).length > 0) {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...updateProfileData,
        },
        update: updateProfileData,
      });
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

    await this.prisma.user.update({
      where: { id: userId },
      data: { meta },
    });

    const updatedUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        karma: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            fullName: true,
            phone: true,
            avatarUrl: true,
          }
        },
      }
    });

    return {
      id: updatedUser?.id,
      email: updatedUser?.email,
      full_name: updatedUser?.profile?.fullName || null,
      phone: updatedUser?.profile?.phone || null,
      profile_avatar: updatedUser?.profile?.avatarUrl || null,
      role: updatedUser?.role,
      karma: updatedUser?.karma,
      created_at: updatedUser?.createdAt,
      updated_at: updatedUser?.updatedAt,
    };
  }

  async createOAuthUser(oauthProfile: ProviderUserDto) {
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

    const user = await this.prisma.user.create({
      data: {
        email: oauthProfile.email,
        password_hash: await this.hashPassword(randomPassword),
        role: 'USER',
        meta,
        token_version: 1,
        profile: {
          create: {
            fullName: oauthProfile.full_name || null,
            avatarUrl: oauthProfile.profile_avatar || null,
          }
        }
      },
      select: {
        id: true,
        email: true,
        role: true,
        karma: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            fullName: true,
            phone: true,
            avatarUrl: true,
          }
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      full_name: user.profile?.fullName || null,
      phone: user.profile?.phone || null,
      profile_avatar: user.profile?.avatarUrl || null,
      role: user.role,
      karma: user.karma,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
    };
  }

  private async hashPassword(password: string): Promise<string> {
    const bcrypt = await import('bcrypt');
    return bcrypt.hash(password, 10);
  }

  async findAll(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [total, users] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          role: true,
          karma: true,
          createdAt: true,
          is_verified: true,
          profile: {
            select: {
              fullName: true,
              avatarUrl: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async updateStatus(userId: number, updateDto: UpdateUserStatusDto) {
    const data: any = {};
    if (updateDto.is_banned !== undefined) {
      data.meta = { is_banned: updateDto.is_banned };
    }
    if (updateDto.role !== undefined) {
      data.role = updateDto.role;
    }

    // fetch current meta first if updating banner
    if (updateDto.is_banned !== undefined) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      data.meta = { ...(user.meta as Record<string, any>), is_banned: updateDto.is_banned };
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        meta: true
      }
    });
    return user;
  }
}
