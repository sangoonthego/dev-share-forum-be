import { Controller, Get, Patch, Post, Body, Param, ParseIntPipe, UseGuards, UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { User } from '../common/decorators/user.decorator';
import { AtGuard } from '../common/guards/at.guard';
import { Public } from '../common/decorators/public.decorator';
import { CustomImageValidator } from 'src/common/validators/custom-image.validator';

@Controller('profiles')
@UseGuards(AtGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) { }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  async uploadMyAvatar(
    @User('sub') userId: number,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new CustomImageValidator({}),
        ],
      }),
    )
    avatar: Express.Multer.File,
  ) {
    return this.profilesService.uploadAvatar(userId, avatar);
  }

  @Get('me')
  async getMyProfile(@User('sub') userId: number) {
    return this.profilesService.getProfileByUserId(userId);
  }

  @Patch('me')
  async updateMyProfile(
    @User('sub') userId: number,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.profilesService.updateProfile(userId, updateProfileDto);
  }

  @Public()
  @Get(':id')
  async getUserProfile(@Param('id', ParseIntPipe) id: number) {
    return this.profilesService.getPublicProfile(id);
  }
}

