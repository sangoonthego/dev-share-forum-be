import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostResponseDto, PaginatedPostsResponseDto } from './dto/post-response.dto';
import { AtGuard } from 'src/common/guards/at.guard';
import { OwnershipGuard } from './guards/ownership.guard';
import { User } from 'src/common/decorators/user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * PostsController - High-performance Forum Post Management
 * 
 * Features:
 * - Public read endpoints (GET)
 * - Authenticated write endpoints (POST, PATCH, DELETE)
 * - Owner verification (OwnershipGuard)
 * - Admin override for moderation
 * - Pagination with caching
 * 
 * Security:
 * - @Public() for read operations
 * - @UseGuards(AtGuard) for authenticated operations
 * - @UseGuards(OwnershipGuard) for ownership verification
 * 
 * Endpoints:
 * POST   /posts              - Create post
 * GET    /posts              - List posts (paginated)
 * GET    /posts/:slug        - Get post detail
 * PATCH  /posts/:id          - Update post
 * DELETE /posts/:id          - Delete post
 */
@Controller('posts')
export class PostsController {
  constructor(private postsService: PostsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AtGuard)
  @Throttle({ default: { limit: 10, ttl: 3600 } }) // 10 posts per hour
  async createPost(
    @User('sub') userId: number,
    @Body() dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    return this.postsService.createPost(userId, dto);
  }

  @Get()
  @Public()
  @UseGuards(AtGuard) // Soft guard - @Public() bypasses it
  async getPostsPaginated(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('all') all?: string,
    @User('sub') userId?: number,
    @User('role') userRole?: string,
  ): Promise<PaginatedPostsResponseDto> {
    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '10', 10)));

    // If authenticated AND requesting all, show unpublished
    const isPublished = !(all === 'true' && userId);

    return this.postsService.getPostsPaginated(pageNum, limitNum, isPublished, userRole);
  }

  @Get('search/semantic')
  @Public()
  @Throttle({ default: { limit: 100, ttl: 3600 } })
  async searchPostsSemantic(
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @User('role') userRole?: string,
    @User('sub') userId?: number,
  ): Promise<PostResponseDto[]> {
    const limitNum = Math.min(10, Math.max(1, parseInt(limit || '5', 10)));
    return this.postsService.searchPosts(query, userRole, userId, limitNum);
  }

  @Get(':slug')
  @Public()
  @UseGuards(AtGuard)
  async getPostBySlug(
    @Param('slug') slug: string,
    @User('role') userRole?: string,
  ): Promise<PostResponseDto> {
    return this.postsService.getPostBySlug(slug, userRole);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AtGuard, OwnershipGuard)
  @Throttle({ default: { limit: 20, ttl: 3600 } }) 
  async updatePost(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @User('sub') userId: number,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePost(Number(id), userId, dto);
  }

  @Post('embeddings/backfill')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AtGuard)
  async backfillEmbeddings(
    @User('role') userRole?: string,
  ): Promise<{
    total: number;
    processed: number;
    failed: number;
    errors: Array<{ postId: number; error: string }>;
  }> {
    // Admin-only check
    if (userRole !== 'ADMIN') {
      throw new ForbiddenException('Only ADMIN users can backfill embeddings');
    }

    return this.postsService.backfillEmbeddingsForAllPosts();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AtGuard, OwnershipGuard)
  async deletePost(@Param('id') id: string): Promise<void> {
    await this.postsService.deletePost(Number(id));
  }
}
