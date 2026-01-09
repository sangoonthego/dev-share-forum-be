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

/**
 * MediaController - Handle image uploads and management
 * 
 * - Only authenticated users can upload
 * - Images linked to posts if post_id provided
 * - User can only manage their own images
 * - Images cleaned up when post deleted
 */
@Controller('media')
export class MediaController {
  constructor(
    private cloudinaryService: CloudinaryService,
    private prisma: PrismaService,
  ) {}

  /**
   * Upload an image
   * POST /media/upload
   * 
   * Query params:
   * - post_id (optional): Link image to a post
   */
  @Post('upload')
  @UseGuards(AtGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @UploadedFile() file: any,
    @User() user: any,
  ) {
    // Validation
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Only allow image files
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('File must be an image');
    }

    // Max file size: 10MB
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 10MB limit');
    }

    try {
      // Upload to Cloudinary
      const uploadResult = await this.cloudinaryService.uploadImage(file);

      // Save to database
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

  /**
   * Link an uploaded image to a post
   * POST /media/:mediaId/link-to-post/:postId
   */
  @Post(':mediaId/link-to-post/:postId')
  @UseGuards(AtGuard)
  async linkImageToPost(
    @Param('mediaId', ParseIntPipe) mediaId: number,
    @Param('postId', ParseIntPipe) postId: number,
    @User() user: any,
  ) {
    // Check media ownership
    const media = await this.prisma.media_assets.findUnique({
      where: { id: mediaId },
    });

    if (!media) {
      throw new BadRequestException('Media not found');
    }

    if (media.user_id !== user.sub) {
      throw new ForbiddenException('Cannot manage other users media');
    }

    // Check post ownership
    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new BadRequestException('Post not found');
    }

    if (post.author_id !== user.sub) {
      throw new ForbiddenException('Cannot link to other users posts');
    }

    // Update media
    const updated = await this.prisma.media_assets.update({
      where: { id: mediaId },
      data: { post_id: postId },
    });

    return updated;
  }

  /**
   * Delete an image
   * DELETE /media/:mediaId
   * 
   * - Only owner can delete
   * - Removes from Cloudinary and database
   */
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
      // Delete from Cloudinary
      await this.cloudinaryService.deleteImage(media.public_id);

      // Delete from database
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

  /**
   * Get user's media library
   * GET /media/user/library
   */
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
