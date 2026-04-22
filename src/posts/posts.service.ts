import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { CloudinaryService } from 'src/media/cloudinary.service';
import { UserActivityService } from 'src/users/user-activity.service';
import { EmbeddingService } from './services/embedding.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostResponseDto, PaginatedPostsResponseDto } from './dto/post-response.dto';
import DOMPurify from 'isomorphic-dompurify';
import { nanoid } from 'nanoid';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cloudinaryService: CloudinaryService,
    private userActivityService: UserActivityService,
    private embeddingService: EmbeddingService,
  ) { }

  async createPost(
    userId: number,
    dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    const sanitizedContent = DOMPurify.sanitize(dto.content_markdown);
    let slug = await this.generateUniqueSlug(dto.title);

    let embedding: number[] = [];
    try {
      const embeddingText = `${dto.title}. ${sanitizedContent}`.substring(0, 8000);
      embedding = await this.embeddingService.generateEmbedding(embeddingText);
      this.logger.debug(
        `[POSTS] Generated embedding for post (${embedding.length} dimensions)`,
      );
    } catch (error) {
      this.logger.error(
        `[POSTS] Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}. Post creation will continue without embedding.`,
      );
    }

    let post: any;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        post = await this.prisma.$transaction(async (tx) => {
          const newPost = await tx.posts.create({
            data: {
              title: dto.title,
              slug,
              content_markdown: sanitizedContent,
              is_published: dto.is_published || false,
              status: dto.status || 'PUBLISHED', // Default to PUBLISHED, can be DRAFT
              author_id: userId,
              // Note: embedding saved separately after transaction (see step 5)
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
        break; // Successful transaction
      } catch (error: any) {
        // Feature 2: Race condition fix
        if (error.code === 'P2002' && error.meta?.target?.includes('slug')) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new ConflictException('Could not generate unique slug automatically.');
          }
          slug = `${this._slugify(dto.title)}-${nanoid(10)}`;
          continue; // Retry block
        }

        // Feature 3: Orphaned Media fallback cleanup
        if ((dto as any).media_assets && Array.isArray((dto as any).media_assets)) {
          for (const media of (dto as any).media_assets) {
            // Delete image fire and forget
            const publicId = typeof media === 'string' ? media : media.public_id;
            if (publicId) this.cloudinaryService.deleteImage(publicId).catch(console.error);
          }
        }

        throw error;
      }
    }

    if (embedding.length > 0) {
      try {
        const embeddingString = JSON.stringify(embedding);
        await this.prisma.$executeRaw`
          UPDATE "posts" 
          SET embedding = ${embeddingString}::vector(768)
          WHERE id = ${post.id}
        `;
        this.logger.debug(`[POSTS] Saved embedding for post ${post.id}`);
      } catch (error) {
        this.logger.error(
          `[POSTS] Failed to save embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue - post exists without embedding
      }
    }

    // 6. Log activity only for published posts
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

    // Check if content changed (triggers embedding regeneration)
    const contentChanged = !!dto.content_markdown;
    const titleChanged = !!dto.title;
    const shouldRegenerateEmbedding = contentChanged || titleChanged;

    // Prepare update data
    const updateData: any = {};
    let newEmbedding: number[] = [];

    if (dto.title) {
      updateData.title = dto.title;
      updateData.slug = await this.generateUniqueSlug(dto.title, postId);
    }

    if (dto.content_markdown) {
      updateData.content_markdown = DOMPurify.sanitize(dto.content_markdown);
    }

    if (typeof dto.is_published === 'boolean') {
      updateData.is_published = dto.is_published;
    }

    // Regenerate embedding if content changed
    if (shouldRegenerateEmbedding) {
      try {
        const titleForEmbedding = dto.title || existingPost.title;
        const contentForEmbedding =
          dto.content_markdown ||
          existingPost.content_markdown;
        const embeddingText = `${titleForEmbedding}. ${contentForEmbedding}`.substring(0, 8000);

        newEmbedding = await this.embeddingService.generateEmbedding(embeddingText);
        this.logger.debug(
          `[POSTS] Regenerated embedding for post ${postId} (${newEmbedding.length} dimensions)`,
        );
      } catch (error) {
        this.logger.error(
          `[POSTS] Failed to regenerate embedding: ${error instanceof Error ? error.message : 'Unknown error'}. Post update will continue.`,
        );
      }
    }

    // Handle tags if provided
    let updatedPost: any;

    try {
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
    } catch (error: any) {
      // Feature 3: Orphaned Media fallback cleanup
      if ((dto as any).media_assets && Array.isArray((dto as any).media_assets)) {
        for (const media of (dto as any).media_assets) {
          const publicId = typeof media === 'string' ? media : media.public_id;
          if (publicId) this.cloudinaryService.deleteImage(publicId).catch(console.error);
        }
      }
      throw error;
    }

    // Save new embedding if regenerated
    // IMPORTANT: Convert array to JSON string literal, then cast to vector(768)
    if (shouldRegenerateEmbedding && newEmbedding.length > 0) {
      try {
        const embeddingString = JSON.stringify(newEmbedding);
        await this.prisma.$executeRaw`
          UPDATE "posts" 
          SET embedding = ${embeddingString}::vector(768)
          WHERE id = ${postId}
        `;
        this.logger.debug(`[POSTS] Updated embedding for post ${postId}`);
      } catch (error) {
        this.logger.error(
          `[POSTS] Failed to save updated embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        // Continue - post updated without new embedding
      }
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

  async restorePost(postId: number, userId: number): Promise<PostResponseDto> {
    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        posts_tags: {
          include: { tag: true }
        }
      }
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.author_id !== userId) {
      throw new ForbiddenException('Cannot restore other users posts');
    }

    if (post.deleted_at === null) {
      throw new BadRequestException('Post is not deleted');
    }

    const restoredPost = await this.prisma.posts.update({
      where: { id: postId },
      data: { deleted_at: null },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        posts_tags: {
          include: { tag: true }
        }
      }
    });

    await this._invalidateListCaches();
    return this._formatPostResponse(restoredPost);
  }

  async autoSavePost(postId: number, userId: number, dto: Partial<UpdatePostDto>): Promise<{ success: boolean; updatedAt: Date }> {
    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
      select: { id: true, author_id: true }
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.author_id !== userId) {
      throw new ForbiddenException('Cannot modify other users posts');
    }

    const updateData: any = {};
    if (dto.title) updateData.title = dto.title;
    if (dto.content_markdown) updateData.content_markdown = DOMPurify.sanitize(dto.content_markdown);

    if (Object.keys(updateData).length === 0) {
      return { success: true, updatedAt: new Date() };
    }

    const updatedPost = await this.prisma.posts.update({
      where: { id: postId },
      data: updateData,
      select: { updated_at: true }
    });

    return {
      success: true,
      updatedAt: updatedPost.updated_at
    };
  }

  async getPostBySlug(slug: string, userRole?: string): Promise<PostResponseDto> {
    const cacheKey = `post:slug:${slug}`;

    // 1. Check Redis cache (Bypass for ADMIN)
    if (userRole !== 'ADMIN') {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        // Increment view count (fire and forget)
        this._incrementViewCount(slug).catch((err) =>
          console.error('Failed to increment view count:', err),
        );
        return JSON.parse(cached);
      }
    }

    // 2. Query database
    const post = await this.prisma.posts.findUnique({
      where: { slug },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
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

    // 3. Access Control
    if (userRole !== 'ADMIN') {
      if (post.status !== 'PUBLISHED' || post.deleted_at !== null) {
        // Obscure the exact reason (soft-deleted or draft) from non-admins
        throw new NotFoundException('Post not found');
      }
    }

    const formatted = this._formatPostResponse(post);

    // 4. Secure Cache Writing: Only cache if public and not soft-deleted
    if (post.status === 'PUBLISHED' && post.deleted_at === null) {
      await this.redis.set(cacheKey, JSON.stringify(formatted), 3600);
    }

    // 5. Increment view count
    await this._incrementViewCount(slug);

    return formatted;
  }

  async getPostsPaginated(
    page: number = 1,
    limit: number = 10,
    isPublished: boolean = true,
    userRole?: string,
    tag?: string,
    authorId?: number,
  ): Promise<PaginatedPostsResponseDto> {
    const skip = (page - 1) * limit;
    const cacheKey = `posts:list:page:${page}:limit:${limit}:published:${isPublished}:role:${userRole || 'guest'}:tag:${tag || 'all'}:author:${authorId || 'all'}`;

    // Try cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Build where clause - exclude soft-deleted for non-ADMIN, exclude DRAFT posts
    const whereClause: any = {
      deleted_at: null,
      status: 'PUBLISHED',
    };
    if (isPublished) {
      whereClause.is_published = true;
    }
    if (tag) {
      whereClause.posts_tags = {
        some: {
          tag: {
            slug: tag,
          },
        },
      };
    }
    if (authorId) {
      whereClause.author_id = authorId;
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
              profile: { select: { fullName: true } },
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

  async getMyPosts(userId: number, page: number = 1, limit: number = 10): Promise<PaginatedPostsResponseDto> {
    const skip = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      this.prisma.posts.findMany({
        where: { author_id: userId },
        skip,
        take: limit,
        include: {
          author: {
            select: {
              id: true,
              email: true,
              profile: { select: { fullName: true } },
            },
          },
          posts_tags: {
            include: { tag: true },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.posts.count({
        where: { author_id: userId },
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data: posts.map((p) => this._formatPostResponse(p)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getMyPostById(postId: number, userId: number): Promise<PostResponseDto> {
    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        posts_tags: {
          include: { tag: true },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.author_id !== userId) {
      throw new ForbiddenException('Cannot access other users posts');
    }

    return this._formatPostResponse(post);
  }

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
   * Increment view count using Redis for performance
   */
  private async _incrementViewCount(slug: string): Promise<void> {
    await this.redis.hIncrBy('posts:pending_views', slug, 1);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async flushViewCounts(): Promise<void> {
    const views = await this.redis.hGetAll('posts:pending_views');
    if (!views || Object.keys(views).length === 0) {
      return;
    }

    // Clear hash immediately
    await this.redis.unlink('posts:pending_views');

    const updatePromises = Object.entries(views).map(([slug, countStr]) => {
      const count = parseInt(countStr as string, 10);
      if (isNaN(count)) return null;
      return this.prisma.posts.update({
        where: { slug },
        data: { view_count: { increment: count } },
      });
    });

    await Promise.allSettled(updatePromises.filter(p => p !== null));
    this.logger.debug(`[CRON] Flushed ${updatePromises.length} pending view counts to database.`);
  }

  private _generateEmbedding(content: string): number[] {
    const embedding: number[] = [];
    for (let i = 0; i < 768; i++) {
      embedding.push(Math.random());
    }
    return embedding;
  }

  private _slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

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
          full_name: post.author.profile?.fullName || null,
        },
      }),
      ...(post.posts_tags && {
        tags: post.posts_tags.map((pt: any) => ({
          id: pt.tag.id,
          name: pt.tag.name,
          slug: pt.tag.slug,
        })),
      }),
      created_at: post.createdAt,
      updated_at: post.updatedAt,
    };
  }

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

  async searchPosts(
    query: string,
    userRole?: string,
    userId?: number,
    limit: number = 5,
    similarityThreshold: number = 1.0,
  ): Promise<PostResponseDto[]> {
    // Validate query
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query cannot be empty');
    }

    if (query.trim().length > 500) {
      throw new BadRequestException('Search query exceeds 500 characters');
    }

    // Validate similarity threshold (0.0 to 2.0 range for cosine distance)
    if (similarityThreshold < 0 || similarityThreshold > 2.0) {
      throw new BadRequestException('Similarity threshold must be between 0 and 2.0');
    }

    // 1. Check Redis cache first (includes threshold in key for multi-level caching)
    const cacheKey = `search:${query.toLowerCase()}:threshold:${similarityThreshold}:role:${userRole || 'guest'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`[SEARCH] Cache hit for query: "${query}"`, 'POSTS');
      return JSON.parse(cached);
    }

    // 2. Generate embedding for the query
    const queryEmbedding = await this.generateEmbedding(query);

    // 3. Execute vector search using pgvector cosine distance with threshold filter
    const embeddingString = JSON.stringify(queryEmbedding);
    const limitInt = Math.max(1, Math.min(limit, 100)); // Clamp between 1-100 for safety

    const sql = `
      SELECT 
        p.id,
        p.title,
        p.slug,
        p.content_markdown,
        p.is_published,
        p.status,
        p.view_count,
        p.author_id,
        p.deleted_at,
        p.created_at,
        p.updated_at,
        (p.embedding <=> $1::vector) AS distance
      FROM "posts" p
      WHERE 
        p.deleted_at IS NULL
        AND p.status = 'PUBLISHED'
        AND (p.embedding <=> $1::vector) < $3::float -- SIMILARITY THRESHOLD FILTER
      ORDER BY 
        p.embedding <=> $1::vector ASC -- Sort by distance (lower = more relevant)
      LIMIT $2::bigint
    `;

    const vectorResults = await this.prisma.$queryRawUnsafe<any[]>(
      sql,
      embeddingString,
      limitInt,
      similarityThreshold,
    );

    if (!vectorResults || vectorResults.length === 0) {
      this.logger.debug(
        `[SEARCH] No results for query: "${query}" with threshold ${similarityThreshold}`,
        'POSTS',
      );
      return [];
    }

    // 4. Fetch full post details with author and tags
    const postIds = vectorResults.map((r) => r.id);
    const posts = await this.prisma.posts.findMany({
      where: {
        id: { in: postIds },
        deleted_at: null,
        status: 'PUBLISHED',
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
        posts_tags: {
          include: {
            tag: true,
          },
        },
      },
    });

    // 5. Filter out drafts for non-ADMIN users
    const filtered = posts.filter((post) => {
      if (post.status === 'DRAFT' && userRole !== 'ADMIN') {
        return false; // Non-ADMIN can't see drafts
      }
      return true;
    });

    // 6. Format and cache results
    const formattedResults = filtered.map((p) => this._formatPostResponse(p));
    await this.redis.set(cacheKey, JSON.stringify(formattedResults), 1800); // 30 min cache

    this.logger.log(
      `[SEARCH] Found ${formattedResults.length} results for query: "${query}" (threshold: ${similarityThreshold})`,
      'POSTS',
    );
    return formattedResults;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Delegate to EmbeddingService (Gemini API)
    return this.embeddingService.generateEmbedding(text);
  }

  private _generateMockEmbedding(text: string): number[] {
    // Deterministic: use text hash as seed
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Keep as 32-bit integer
    }

    // Generate deterministic pseudo-random vector
    const embedding: number[] = [];
    let seed = Math.abs(hash);

    for (let i = 0; i < 1536; i++) {
      // Seeded pseudo-random number generator (LCG)
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // Normalize to [-1, 1]
      embedding.push((seed % 2000) / 1000 - 1);
    }

    // Normalize to unit vector (L2 normalization)
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0),
    );
    return magnitude > 0
      ? embedding.map((val) => val / magnitude)
      : embedding;
  }

  async updatePostEmbedding(postId: number, content: string): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(content);

      await this.prisma.$executeRaw`
        UPDATE "posts" 
        SET embedding = ${embedding}::vector(1536)
        WHERE id = ${postId}
      `;

      console.log(`[EMBEDDING] Updated embedding for post ${postId}`);
    } catch (error) {
      console.error(
        `[EMBEDDING] Failed to update embedding for post ${postId}:`,
        error,
      );
      // Don't throw - post update succeeds even if embedding fails
    }
  }

  async backfillEmbeddingsForAllPosts(batchSize: number = 10): Promise<{
    total: number;
    processed: number;
    failed: number;
    errors: Array<{ postId: number; error: string }>;
  }> {
    console.log(
      '[EMBEDDING] Starting dimension migration: 1536 → 768 (Gemini)',
    );

    // Get ALL posts (including those with existing embeddings)
    // Need to regenerate all due to dimension change
    const allPosts = await this.prisma.posts.findMany({
      select: {
        id: true,
        title: true,
        content_markdown: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    const total = allPosts.length;
    let processed = 0;
    let failed = 0;
    const errors: Array<{ postId: number; error: string }> = [];

    console.log(
      `[EMBEDDING] Found ${total} posts to backfill with new 768-dimensional embeddings`,
    );

    if (total === 0) {
      console.log('[EMBEDDING] No posts to backfill');
      return { total, processed, failed, errors };
    }

    // Process in batches
    for (let i = 0; i < allPosts.length; i += batchSize) {
      const batch = allPosts.slice(i, i + batchSize);

      for (const post of batch) {
        try {
          // Generate new 768-dimensional embedding
          const embeddingText = `${post.title}. ${post.content_markdown}`.substring(
            0,
            8000,
          );
          const embedding = await this.embeddingService.generateEmbedding(
            embeddingText,
          );

          // Update embedding in database
          const embeddingString = JSON.stringify(embedding);
          await this.prisma.$executeRawUnsafe(`
            UPDATE "posts" 
            SET embedding = $1::vector(768)
            WHERE id = $2
          `, embeddingString, post.id);

          processed++;
          console.log(
            `[EMBEDDING] Backfilled post ${post.id} with 768-dim embedding`,
          );
        } catch (error) {
          failed++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push({ postId: post.id, error: errorMsg });
          console.error(
            `[EMBEDDING] Failed to backfill post ${post.id}: ${errorMsg}`,
          );
        }

        // Rate limiting: 100ms between requests to respect API limits
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const progress = Math.round(((i + batch.length) / total) * 100);
      console.log(
        `[EMBEDDING] Backfill progress: ${i + batch.length}/${total} (${progress}%)`,
      );
    }

    console.log(
      `[EMBEDDING] Dimension migration complete. Processed: ${processed}/${total}, Failed: ${failed}`,
    );

    if (failed > 0) {
      console.warn(`[EMBEDDING] ${failed} posts failed to backfill. See errors array for details.`);
    }

    return { total, processed, failed, errors };
  }

  async generateEmbeddingsForAllPosts(batchSize: number = 10): Promise<{
    total: number;
    processed: number;
    failed: number;
  }> {
    console.log('[EMBEDDING] Starting batch embedding generation...');

    // Get all posts without embeddings using raw SQL
    // Prisma can't filter Unsupported("vector") fields, so use raw query
    const postsWithoutEmbeddings = await this.prisma.$queryRaw<
      Array<{ id: number; content_markdown: string }>
    >`
      SELECT id, content_markdown 
      FROM "posts" 
      WHERE embedding IS NULL
      ORDER BY created_at DESC
    `;

    const total = postsWithoutEmbeddings.length;
    let processed = 0;
    let failed = 0;

    if (total === 0) {
      console.log('[EMBEDDING] All posts already have embeddings');
      return { total, processed, failed };
    }

    // Process in batches
    for (let i = 0; i < postsWithoutEmbeddings.length; i += batchSize) {
      const batch = postsWithoutEmbeddings.slice(i, i + batchSize);

      for (const post of batch) {
        try {
          await this.updatePostEmbedding(post.id, post.content_markdown);
          processed++;
        } catch (error) {
          failed++;
          console.error(`[EMBEDDING] Failed to embed post ${post.id}:`, error);
        }

        // Rate limiting: 100ms between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      console.log(
        `[EMBEDDING] Processed ${processed}/${total} posts (${Math.round((processed / total) * 100)}%)`,
      );
    }

    console.log(
      `[EMBEDDING] Batch embedding complete. Processed: ${processed}, Failed: ${failed}`,
    );
    return { total, processed, failed };
  }
}
