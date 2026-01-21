import {
  Controller,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AtGuard } from '../common/guards/at.guard';
import { User } from '../common/decorators/user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from './cloudinary.service';

@Controller('media')
export class MediaController {
  constructor(
    private cloudinaryService: CloudinaryService,
    private prisma: PrismaService,
  ) {}

  @Post('upload')
  @UseGuards(AtGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file: any,
    @User() user: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }

    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    try {
      const uploadResult = await this.cloudinaryService.uploadImage(file);

      const mediaAsset = await this.prisma.media_assets.create({
        data: {
          cloudinary_url: uploadResult.url,
          public_id: uploadResult.publicId,
          file_name: uploadResult.fileName,
          file_size: uploadResult.fileSize,
          mime_type: uploadResult.mimeType,
          user_id: user.sub,
        },
      });

      return {
        id: mediaAsset.id,
        url: mediaAsset.cloudinary_url,
        publicId: mediaAsset.public_id,
        fileName: mediaAsset.file_name,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Upload failed: ${error.message}`,
      );
    }
  }

  @Post(':mediaId/link-to-post/:postId')
  @UseGuards(AtGuard)
  async linkImageToPost(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Param('postId', ParseIntPipe) postId: number,
    @User() user: any,
  ) {
    const media = await this.prisma.media_assets.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new BadRequestException('Media not found');
    }

    if (media.user_id !== user.sub) {
      throw new ForbiddenException('Cannot manage other users media');
    }

    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new BadRequestException('Post not found');
    }

    if (post.author_id !== user.sub) {
      throw new ForbiddenException('Cannot link to other users posts');
    }

    const updated = await this.prisma.media_assets.update({
      where: { id: mediaId },
      data: { post_id: postId },
    });

    return updated;
  }

  @Delete(':mediaId')
  @UseGuards(AtGuard)
  async deleteImage(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @User() user: any,
  ) {
    const media = await this.prisma.media_assets.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new BadRequestException('Media not found');
    }

    if (media.user_id !== user.sub) {
      throw new ForbiddenException('Cannot delete other users media');
    }

    try {
      await this.cloudinaryService.deleteImage(media.public_id);

      await this.prisma.media_assets.delete({
        where: { id: mediaId },
      });

      return { message: 'Image deleted successfully' };
    } catch (error) {
      throw new InternalServerErrorException(
        `Deletion failed: ${error.message}`,
      );
    }
  }

  @Post('user/library')
  @UseGuards(AtGuard)
  async getUserMedia(@User() user: any) {
    const mediaAssets = await this.prisma.media_assets.findMany({
      where: { user_id: user.sub },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    return mediaAssets;
  }
}
