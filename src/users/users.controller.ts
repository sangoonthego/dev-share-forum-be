import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { AtGuard } from '../common/guards/at.guard';
import { User } from '../common/decorators/user.decorator';
import { UsersService, UserProfileWithActivity } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get(':username/profile')
  async getProfile(
    @Param('username') username: string,
  ): Promise<UserProfileWithActivity> {
    return this.usersService.getProfileWithActivity(username);
  }

  @Get('me/profile')
  @UseGuards(AtGuard)
  async getCurrentUserProfile(@User() user: any) {
    return this.usersService.getUserById(user.sub);
  }

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
