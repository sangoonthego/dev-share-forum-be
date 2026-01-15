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

  /**
   * POST /posts - Create new post
   * 
   * Rate Limiting: 10 requests per hour per user
   * (Prevents spam/automated abuse)
   * 
   * Requires: Authentication (JWT)
   * Body: CreatePostDto
   * 
   * Returns: Created post with ID, slug, tags
   * 
   * Business Logic:
   * - Sanitizes content_markdown to prevent XSS
   * - Atomic creation with tags (find or create)
   * - Generates unique slug from title using nanoid
   * - Creates mock AI embedding
   * - Invalidates pagination caches
   * 
   * Security:
   * - XSS prevention via sanitization
   * - Rate limiting to prevent spam
   * - Authentication required
   */
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

  /**
   * GET /posts - List posts with pagination
   * 
   * Query params:
   * - page: number (default: 1)
   * - limit: number (default: 10, max: 50)
   * - all: boolean (show unpublished if authenticated)
   * 
   * Returns: Paginated posts with total count
   * 
   * Caching:
   * - Cached for 5 minutes (300s)
   * - Cache key includes page, limit, published status, user role
   * - Invalidated on create/update/delete
   * 
   * Filtering:
   * - Soft-deleted posts excluded for non-ADMIN users
   * - Only published posts shown to public by default
   * - Authenticated users can request unpublished if owner
   * 
   * Access Control:
   * - @Public() - Anyone can access
   * - Shows only published posts by default
   * - Authenticated users can request unpublished if owner
   */
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

  /**
   * GET /posts/search/semantic - Semantic search using vector embeddings
   * 
   * Query params:
   * - query: string (required, 1-500 characters)
   * - limit: number (optional, default: 5, max: 10)
   * 
   * Returns: Top 5 most relevant posts based on semantic similarity
   * 
   * Features:
   * - Vector embeddings using OpenAI text-embedding-3-small API
   * - Cosine distance similarity search via pgvector
   * - Redis caching (30 minutes) to reduce API costs
   * - HNSW indexing for O(log n) search performance
   * - Filters out soft-deleted and draft posts
   * - OwnershipGuard logic applies (non-authors can't see drafts)
   * 
   * Performance:
   * - Cache hit: <10ms response
   * - Cache miss: ~500ms-1s (includes API call)
   * - Subsequent identical queries: instant from cache
   * 
   * Cost Optimization:
   * - ~$0.00001 per search (text-embedding-3-small)
   * - With caching, most common searches cost ~$0.00001 total
   * 
   * Error Handling:
   * - If OpenAI API unavailable, falls back to mock embeddings
   * - Search still works, quality degraded
   * - Never blocks user request
   * 
   * Use Cases:
   * - Full-text semantic search (not keyword-based)
   * - Find posts by meaning/intent rather than exact words
   * - Example: "How do I debug React?" finds posts about debugging JavaScript
   * 
   * Security:
   * - @Public() - Anyone can use (rate-limited)
   * - Respects OwnershipGuard logic
   * - Query sanitized/validated
   * - Rate limit: 100 requests per hour per IP
   */
  @Get('search/semantic')
  @Public()
  @Throttle({ default: { limit: 100, ttl: 3600 } }) // 100 searches per hour
  async searchPostsSemantic(
    @Query('query') query: string,
    @Query('limit') limit?: string,
    @User('role') userRole?: string,
    @User('sub') userId?: number,
  ): Promise<PostResponseDto[]> {
    const limitNum = Math.min(10, Math.max(1, parseInt(limit || '5', 10)));
    return this.postsService.searchPosts(query, userRole, userId, limitNum);
  }

  /**
   * GET /posts/:slug - Get post detail by slug
   * 
   * Params: slug (string)
   * 
   * Returns: Full post with author, tags, view count
   * 
   * Performance:
   * - Cache-aside pattern with Redis
   * - Cached for 1 hour
   * - View count incremented atomically
   * - Atomic increment happens in background (fire and forget)
   * 
   * Filtering:
   * - Soft-deleted posts excluded for non-ADMIN users
   * - ADMIN users can access any post for moderation
   * 
   * Access Control:
   * - @Public() - Anyone can view published posts
   * - Soft-deleted posts hidden from non-ADMIN users
   */
  @Get(':slug')
  @Public()
  @UseGuards(AtGuard)
  async getPostBySlug(
    @Param('slug') slug: string,
    @User('role') userRole?: string,
  ): Promise<PostResponseDto> {
    return this.postsService.getPostBySlug(slug, userRole);
  }

  /**
   * PATCH /posts/:id - Update post
   * 
   * Rate Limiting: 20 requests per hour per user
   * (More lenient than create since updates are less spammy)
   * 
   * Params: id (post ID)
   * Body: UpdatePostDto (partial)
   * 
   * Returns: Updated post
   * 
   * Authorization:
   * - @UseGuards(AtGuard) - Must be authenticated
   * - @UseGuards(OwnershipGuard) - Must own post or be ADMIN
   * 
   * Business Logic:
   * - Sanitizes content_markdown to prevent XSS
   * - Regenerates slug if title changes using nanoid
   * - Regenerates embedding if content changes
   * - Updates tags if provided
   * - Invalidates both post detail and list caches
   * 
   * Atomic Operations:
   * - Tags update wrapped in transaction
   * - Old tags deleted, new tags created/connected
   * 
   * Security:
   * - Ownership verified via guard
   * - Content sanitized for XSS prevention
   * - Rate limiting to prevent abuse
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AtGuard, OwnershipGuard)
  @Throttle({ default: { limit: 20, ttl: 3600 } }) // 20 updates per hour
  async updatePost(
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
    @User('sub') userId: number,
  ): Promise<PostResponseDto> {
    return this.postsService.updatePost(Number(id), userId, dto);
  }

  /**
   * POST /posts/embeddings/backfill - Backfill all embeddings with new 768-dim vectors
   * 
   * Admin-only endpoint for dimension migration
   * 
   * Use Case:
   * - Migrate from OpenAI (1536 dims) to Gemini (768 dims)
   * - Fix pgvector dimension mismatch errors
   * - Regenerate embeddings after model change
   * 
   * Process:
   * - Fetches all posts
   * - Generates new 768-dimensional embeddings
   * - Batch processing with rate limiting
   * - Returns progress and error details
   * 
   * Response:
   * ```json
   * {
   *   "total": 45,
   *   "processed": 43,
   *   "failed": 2,
   *   "errors": [
   *     { "postId": 5, "error": "API rate limit exceeded" },
   *     { "postId": 12, "error": "Connection timeout" }
   *   ]
   * }
   * ```
   * 
   * Duration: ~6-10 seconds per post (API latency)
   * - 10 posts: ~1-2 minutes
   * - 100 posts: ~15-20 minutes
   * - 1000+ posts: Consider scheduled background job
   * 
   * Note: ADMIN only - requires authentication & admin role
   */
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

  /**
   * DELETE /posts/:id - Delete post
   * 
   * Params: id (post ID)
   * 
   * Returns: 204 No Content
   * 
   * Authorization:
   * - @UseGuards(AtGuard) - Must be authenticated
   * - @UseGuards(OwnershipGuard) - Must own post or be ADMIN
   * 
   * Business Logic:
   * - Cascades delete to posts_tags (Prisma config)
   * - Clears Redis caches (detail + list)
   * - Returns 204 No Content
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AtGuard, OwnershipGuard)
  async deletePost(@Param('id') id: string): Promise<void> {
    await this.postsService.deletePost(Number(id));
  }
}
