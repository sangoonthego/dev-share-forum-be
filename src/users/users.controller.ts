import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { AtGuard } from '../common/guards/at.guard';
import { User } from '../common/decorators/user.decorator';
import { UsersService, UserProfileWithActivity } from './users.service';

/**
 * UsersController - User profile endpoints
 * 
 * Public endpoints:
 * - GET /users/:username/profile - Get public profile with stats and activity chart
 * 
 * Protected endpoints:
 * - PUT /users/profile - Update current user's profile
 */
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  /**
   * Get public user profile with stats and 365-day activity
   * GET /users/:username/profile
   * 
   * Returns:
   * {
   *   id: number,
   *   email: string,
   *   full_name: string | null,
   *   profile_avatar: string | null,
   *   karma: number,
   *   created_at: Date,
   *   stats: {
   *     postCount: number,
   *     commentCount: number,
   *     karma: number
   *   },
   *   activityChart: [
   *     { date: "2025-01-09", count: 5 },
   *     { date: "2025-01-10", count: 3 },
   *     ...
   *   ]
   * }
   */
  @Get(':username/profile')
  async getProfile(
    @Param('username') username: string,
  ): Promise<UserProfileWithActivity> {
    return this.usersService.getProfileWithActivity(username);
  }

  /**
   * Get current user's profile (requires auth)
   * GET /users/me/profile
   */
  @Get('me/profile')
  @UseGuards(AtGuard)
  async getCurrentUserProfile(@User() user: any) {
    return this.usersService.getUserById(user.sub);
  }

  /**
   * Update current user's profile (requires auth)
   * PUT /users/profile
   */
  @Put('profile')
  @UseGuards(AtGuard)
  async updateProfile(
    @User() user: any,
    @Body()
    data: {
      full_name?: string;
      phone?: string;
      profile_avatar?: string;
    },
  ) {
    return this.usersService.updateProfile(user.sub, data);
  }
}
