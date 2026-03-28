import { Controller, Get, Patch, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from '../common/decorators/user.decorator';
import { AtGuard } from '../common/guards/at.guard';
import { Public } from '../common/decorators/public.decorator';

@Controller('users')
@UseGuards(AtGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me/profile')
  async getMyProfile(@User('sub') userId: number) {
    return this.profilesService.getProfileByUserId(userId);
  }

  @Patch('me/profile')
  async updateMyProfile(
    @User('sub') userId: number,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profilesService.updateProfile(userId, updateProfileDto);
  }

  @Public()
  @Get(':id/profile')
  async getUserProfile(@Param('id', ParseIntPipe) id: number) {
    return this.profilesService.getProfileByUserId(id);
  }
}

