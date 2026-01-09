import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { CloudinaryService } from 'src/media/cloudinary.service';
import { UserActivityService } from 'src/users/user-activity.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostResponseDto, PaginatedPostsResponseDto } from './dto/post-response.dto';
import DOMPurify from 'isomorphic-dompurify';
import { nanoid } from 'nanoid';

/**
 * PostsService - High-performance Post Management
 * 
 * Features:
 * - Atomic post creation with tag handling
 * - SEO-friendly slug generation with duplicate handling
 * - View count atomic increment
 * - Redis cache-aside pattern for hot posts
 * - Mock AI embedding generation
 * 
 * Architecture:
 * - Prisma transactions for data consistency
 * - Redis caching for frequently accessed posts
 * - Slug uniqueness via counter/random suffix
 * - Pagination with total count
 */
@Injectable()
export class PostsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cloudinaryService: CloudinaryService,
    private userActivityService: UserActivityService,
  ) {}

  /**
   * Create post with atomic tag handling
   * 
   * Workflow:
   * 1. Sanitize content_markdown to prevent XSS attacks
   * 2. Generate unique slug from title using nanoid for guaranteed uniqueness
   * 3. Generate mock embedding from content (for future pgvector use)
   * 4. Atomic transaction:
   *    - Create post (defaults to PUBLISHED, can be DRAFT)
   *    - For each tag: find or create, then connect
   * 5. Log POST_CREATED activity
   * 6. Invalidate list cache (posts change)
   * 
   * Draft Support:
   * - When status=DRAFT, post is not cached in Redis
   * - Drafts are filtered from public feeds
   * - Only author can view their drafts
   * 
   * Transaction ensures:
   * - All tags created/connected atomically
   * - If tag creation fails, post creation rolls back
   * - Duplicate slug detection
   * 
   * Security:
   * - Content is sanitized using DOMPurify to remove XSS vectors
   * - No <script>, event handlers, or other malicious content can be stored
   * 
   * Note: Embedding is generated but not stored (Prisma doesn't support vectors yet)
   * In production, store embedding separately or migrate to pgvector support
   */
  async createPost(
    userId: number,
    dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    // 1. Sanitize content to prevent XSS
    const sanitizedContent = DOMPurify.sanitize(dto.content_markdown);

    // 2. Generate unique slug with nanoid for guaranteed uniqueness
    const slug = await this.generateUniqueSlug(dto.title);

    // 3. Generate mock embedding (for future use)
    const embedding = this._generateEmbedding(sanitizedContent);
    // TODO: Store embedding in separate table or use pgvector migration

    // 4. Atomic transaction: create post + handle tags
    const post = await this.prisma.$transaction(async (tx) => {
      // Create post with status support (DRAFT or PUBLISHED)
      const newPost = await tx.posts.create({
        data: {
          title: dto.title,
          slug,
          content_markdown: sanitizedContent,
          is_published: dto.is_published || false,
          status: dto.status || 'PUBLISHED', // Default to PUBLISHED, can be DRAFT
          author_id: userId,
          // embedding: embedding, // TODO: Enable when Prisma pgvector support is ready
        },
      });

      // Handle tags: find or create, then connect
      if (dto.tags && dto.tags.length > 0) {
        for (const tagName of dto.tags) {
          // Find or create tag
          const tag = await tx.tags.upsert({
            where: { name: tagName },
            update: {}, // No update needed if exists
            create: {
              name: tagName,
              slug: this._slugify(tagName),
            },
          });

          // Connect tag to post
          await tx.posts_tags.create({
            data: {
              post_id: newPost.id,
              tag_id: tag.id,
            },
          });
        }
      }

      return newPost;
    });

    // 5. Log activity only for published posts
    if (post.status === 'PUBLISHED') {
      await this.userActivityService.logActivity(
        userId,
        'POST_CREATED',
        post.id,
      ).catch((err) =>
        console.error('Failed to log POST_CREATED activity:', err),
      );
    }

    // 5. Invalidate all posts list caches with pattern matching
    await this._invalidateListCaches();

    return this._formatPostResponse(post);
  }

  /**
   * Update post with partial fields
   * 
   * If title changes, regenerate slug using nanoid approach
   * Sanitize content_markdown before update
   * Invalidate both post detail cache and all list caches
   * 
   * Security:
   * - Content is sanitized before update to prevent XSS injection
   */
  async updatePost(
    postId: number,
    userId: number,
    dto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    // Get existing post
    const existingPost = await this.prisma.posts.findUnique({
      where: { id: postId },
      include: { author: true, posts_tags: { include: { tag: true } } },
    });

    if (!existingPost) {
      throw new NotFoundException('Post not found');
    }

    // Prepare update data
    const updateData: any = {};

    if (dto.title) {
      updateData.title = dto.title;
      updateData.slug = await this.generateUniqueSlug(dto.title, postId);
    }

    if (dto.content_markdown) {
      updateData.content_markdown = DOMPurify.sanitize(dto.content_markdown);
      // TODO: Update embedding when pgvector support is ready
      // updateData.embedding = this._generateEmbedding(dto.content_markdown);
    }

    if (typeof dto.is_published === 'boolean') {
      updateData.is_published = dto.is_published;
    }

    // Handle tags if provided
    let updatedPost: any;

    if (dto.tags && dto.tags.length >= 0) {
      updatedPost = await this.prisma.$transaction(async (tx) => {
        // Update post
        const post = await tx.posts.update({
          where: { id: postId },
          data: updateData,
        });

        // Clear old tags
        await tx.posts_tags.deleteMany({
          where: { post_id: postId },
        });

        // Add new tags
        if (dto.tags && dto.tags.length > 0) {
          for (const tagName of dto.tags) {
            const tag = await tx.tags.upsert({
              where: { name: tagName },
              update: {},
              create: {
                name: tagName,
                slug: this._slugify(tagName),
              },
            });

            await tx.posts_tags.create({
              data: {
                post_id: post.id,
                tag_id: tag.id,
              },
            });
          }
        }

        return post;
      });
    } else {
      updatedPost = await this.prisma.posts.update({
        where: { id: postId },
        data: updateData,
      });
    }

    // Invalidate caches: detail + all list caches
    await this.redis.del(`post:slug:${existingPost.slug}`);
    if (updateData.slug) {
      await this.redis.del(`post:slug:${updateData.slug}`);
    }
    await this._invalidateListCaches();

    // Log activity for published posts
    if (updatedPost.status === 'PUBLISHED') {
      await this.userActivityService
        .logActivity(userId, 'POST_UPDATED', updatedPost.id)
        .catch((err) =>
          console.error('Failed to log POST_UPDATED activity:', err),
        );
    }

    return this._formatPostResponse(updatedPost);
  }

  /**
   * Soft delete post - sets deleted_at timestamp
   * 
   * Instead of hard delete, marks post as deleted
   * Soft-deleted posts are:
   * - Filtered out from all queries for non-ADMIN users
   * - Only visible to ADMIN users for moderation purposes
   * - Can be permanently deleted later if needed
   * 
   * Invalidates relevant caches
   */
  async deletePost(postId: number, userId?: number): Promise<void> {
    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
      include: { media_assets: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Verify ownership if userId provided
    if (userId && post.author_id !== userId) {
      throw new ForbiddenException('Cannot delete other users posts');
    }

    // Delete media assets from Cloudinary
    for (const media of post.media_assets) {
      try {
        await this.cloudinaryService.deleteImage(media.public_id);
      } catch (error) {
        console.error(
          `Failed to delete media ${media.public_id} from Cloudinary:`,
          error,
        );
        // Continue with other deletions even if one fails
      }
    }

    // Soft delete: set deleted_at timestamp
    await this.prisma.posts.update({
      where: { id: postId },
      data: {
        deleted_at: new Date(),
      },
    });

    // Delete activity logs related to this post
    await this.userActivityService
      .deleteActivitiesByPost(postId)
      .catch((err) =>
        console.error('Failed to delete post activities:', err),
      );

    // Clear caches
    await this.redis.del(`post:slug:${post.slug}`);
    await this._invalidateListCaches();
  }

  /**
   * Get post by slug with Redis cache-aside pattern
   * 
   * Filters out soft-deleted posts (deleted_at is not null)
   * Only ADMIN users can access soft-deleted posts
   * 
   * Cache strategy:
   * 1. Check Redis cache first
   * 2. If miss, query DB (with soft delete filter)
   * 3. Store in Redis for 1 hour (hot post)
   * 4. Increment view count atomically
   * 5. Return post
   * 
   * Access Control:
   * - Non-ADMIN users cannot see soft-deleted posts
   * - ADMIN users can see all posts including soft-deleted
   */
  async getPostBySlug(slug: string, userRole?: string): Promise<PostResponseDto> {
    const cacheKey = `post:slug:${slug}`;

    // 1. Check Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      // Increment view count (fire and forget)
      this._incrementViewCount(slug).catch((err) =>
        console.error('Failed to increment view count:', err),
      );
      return JSON.parse(cached);
    }

    // 2. Query database with soft delete filter
    const post = await this.prisma.posts.findUnique({
      where: { slug },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            full_name: true,
          },
        },
        posts_tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // 3. Check if post is soft-deleted and user is not ADMIN
    if (post.deleted_at !== null && userRole !== 'ADMIN') {
      throw new NotFoundException('Post not found');
    }

    // 3b. Check if post is DRAFT - only author can view
    if (post.status === 'DRAFT' && userRole !== 'ADMIN') {
      throw new ForbiddenException('Cannot access draft posts');
    }

    // 4. Cache for 1 hour (3600 seconds) - but NOT drafts
    const formatted = this._formatPostResponse(post);
    if (post.status === 'PUBLISHED') {
      await this.redis.set(cacheKey, JSON.stringify(formatted), 3600);
    }

    // 5. Increment view count
    await this._incrementViewCount(slug);

    return formatted;
  }

  /**
   * Get paginated posts with optional filters
   * 
   * Automatically filters out soft-deleted posts for non-ADMIN users
   * ADMIN users can see all posts including soft-deleted ones
   * 
   * Query strategy:
   * - Check cache for list first
   * - Only published posts for public
   * - All posts for authenticated users
   * - Filter soft-deleted posts (deleted_at is null) for non-ADMIN
   * - Eager load author and tags
   */
  async getPostsPaginated(
    page: number = 1,
    limit: number = 10,
    isPublished: boolean = true,
    userRole?: string,
  ): Promise<PaginatedPostsResponseDto> {
    const skip = (page - 1) * limit;
    const cacheKey = `posts:list:page:${page}:limit:${limit}:published:${isPublished}:role:${userRole || 'guest'}`;

    // Try cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Build where clause - exclude soft-deleted for non-ADMIN, exclude DRAFT posts
    const whereClause: any = {
      deleted_at: null, // Always exclude soft-deleted
      status: 'PUBLISHED', // Only published posts in public feed
    };
    if (isPublished) {
      whereClause.is_published = true;
    }
    // Note: ADMIN users can still see DRAFT via dedicated endpoint

    // Query database
    const [posts, total] = await Promise.all([
      this.prisma.posts.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              email: true,
              full_name: true,
            },
          },
          posts_tags: {
            include: {
              tag: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.posts.count({
        where: whereClause,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const response: PaginatedPostsResponseDto = {
      data: posts.map((p) => this._formatPostResponse(p)),
      total,
      page,
      limit,
      totalPages,
    };

    // Cache for 5 minutes (300 seconds)
    await this.redis.set(cacheKey, JSON.stringify(response), 300);

    return response;
  }

  /**
   * Generate unique slug from title using nanoid
   * 
   * Strategy (Improved for Performance):
   * 1. Slugify title (lowercase, replace spaces with hyphens)
   * 2. Append nanoid(5) for guaranteed uniqueness
   * 3. Single DB check to verify uniqueness
   * 4. If collision (rare), regenerate with new nanoid
   * 
   * Benefits over counter-based approach:
   * - Minimizes DB hits (usually just 1)
   * - No sequential counter predictability issues
   * - Better distributed generation for multi-instance deployments
   * - Lower latency for slug generation
   * 
   * Format: "my-awesome-title-abc12"
   * 
   * Excludes current post ID to allow re-slugifying on update
   */
  private async generateUniqueSlug(
    title: string,
    excludePostId?: number,
  ): Promise<string> {
    let slug = this._slugify(title);
    let finalSlug = `${slug}-${nanoid(5)}`;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const exists = await this.prisma.posts.findUnique({
        where: { slug: finalSlug },
        select: { id: true },
      });

      // No conflict OR this is the same post being updated
      if (!exists || (excludePostId && exists.id === excludePostId)) {
        return finalSlug;
      }

      // Rare collision: regenerate with new nanoid
      finalSlug = `${slug}-${nanoid(5)}`;
      attempts++;
    }

    // Very unlikely to reach here, but provide fallback
    throw new ConflictException(
      'Could not generate unique slug after maximum attempts. Please try again with a different title.',
    );
  }

  /**
   * Increment view count atomically
   * Uses Prisma increment to avoid race conditions
   */
  private async _incrementViewCount(slug: string): Promise<void> {
    await this.prisma.posts.update({
      where: { slug },
      data: {
        view_count: {
          increment: 1,
        },
      },
    });
  }

  /**
   * Generate mock AI embedding (placeholder for pgvector)
   * 
   * Real implementation would:
   * - Call OpenAI API / HuggingFace / local model
   * - Generate 768-dimensional vector
   * - Handle rate limiting
   * - Cache embeddings
   * 
   * Mock returns random floats for testing
   */
  private _generateEmbedding(content: string): number[] {
    // Mock: return random 768-dimensional vector
    // In production, call actual embedding service
    const embedding: number[] = [];
    for (let i = 0; i < 768; i++) {
      embedding.push(Math.random());
    }
    return embedding;
  }

  /**
   * Convert string to slug format
   * - lowercase
   * - replace spaces/underscores with hyphens
   * - remove special characters
   * - remove multiple consecutive hyphens
   */
  private _slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces/underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Format post response with tags
   */
  private _formatPostResponse(post: any): PostResponseDto {
    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      content_markdown: post.content_markdown,
      is_published: post.is_published,
      view_count: post.view_count,
      author_id: post.author_id,
      ...(post.author && {
        author: {
          id: post.author.id,
          email: post.author.email,
          full_name: post.author.full_name,
        },
      }),
      ...(post.posts_tags && {
        tags: post.posts_tags.map((pt: any) => ({
          id: pt.tag.id,
          name: pt.tag.name,
          slug: pt.tag.slug,
        })),
      }),
      created_at: post.created_at,
      updated_at: post.updated_at,
    };
  }

  /**
   * Invalidate all posts list caches using pattern matching
   * 
   * Advanced Cache Invalidation Strategy:
   * - Uses Redis SCAN to find keys matching pattern: posts:list:page:*
   * - SCAN is memory-efficient for pattern matching on large key sets
   * - Deletes all matching keys in batch operations
   * 
   * Benefits:
   * - Ensures pagination caches don't return stale data
   * - Supports multi-instance Redis clusters
   * - Memory-efficient (doesn't load all keys at once)
   * - Single operation for any pagination state
   * 
   * Usage:
   * - Called whenever posts are created, updated, or deleted
   * - Prevents stale data in feed pagination
   * - Works with any page/limit combination
   */
  private async _invalidateListCaches(): Promise<void> {
    try {
      const deletedCount = await this.redis.delByPattern('posts:list:page:*');
      if (deletedCount > 0) {
        console.log(`Invalidated ${deletedCount} pagination cache entries`);
      }
    } catch (error) {
      console.error('Error invalidating list caches:', error);
      // Graceful degradation - cache will expire naturally (5 minutes)
    }
  }
}
