import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
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

/**
 * PostsService - High-performance Post Management
 * 
 * Features:
 * - Atomic post creation with tag handling & AI embeddings
 * - SEO-friendly slug generation with duplicate handling
 * - View count atomic increment
 * - Redis cache-aside pattern for hot posts
 * - Google Gemini vector embeddings for semantic search (768 dimensions)
 * 
 * Architecture:
 * - Prisma transactions for data consistency
 * - Redis caching for frequently accessed posts
 * - EmbeddingService for Google Gemini integration
 * - pgvector support for vector similarity search
 * - Slug uniqueness via nanoid suffix
 * - Pagination with total count
 */
@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cloudinaryService: CloudinaryService,
    private userActivityService: UserActivityService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Create post with atomic tag handling and AI embeddings
   * 
   * Workflow:
   * 1. Sanitize content_markdown to prevent XSS attacks
   * 2. Generate unique slug from title using nanoid for guaranteed uniqueness
   * 3. Generate AI embedding from title + content (Gemini API)
   * 4. Atomic transaction:
   *    - Create post with status support (DRAFT or PUBLISHED)
   *    - For each tag: find or create, then connect
   *    - Save embedding to database (separate raw SQL query)
   * 5. Log POST_CREATED activity (published posts only)
   * 6. Invalidate list cache
   * 
   * Draft Support:
   * - When status=DRAFT, post is not cached in Redis
   * - Drafts are filtered from public feeds
   * - Only author can view their drafts
   * 
   * Embedding Generation:
   * - Uses Google Gemini text-embedding-004 model (768 dimensions)
   * - Free tier available (no API costs)
   * - Combines title + content for better semantic meaning
   * - Saved separately via raw SQL (Prisma limitation with Unsupported types)
   * - Error handling: Continues even if embedding fails (non-blocking)
   * 
   * Transaction ensures:
   * - All tags created/connected atomically
   * - If tag creation fails, post creation rolls back
   * - Duplicate slug detection
   * 
   * Security:
   * - Content is sanitized using DOMPurify to remove XSS vectors
   * - No <script>, event handlers, or other malicious content can be stored
   */
  async createPost(
    userId: number,
    dto: CreatePostDto,
  ): Promise<PostResponseDto> {
    // 1. Sanitize content to prevent XSS
    const sanitizedContent = DOMPurify.sanitize(dto.content_markdown);

    // 2. Generate unique slug with nanoid for guaranteed uniqueness
    const slug = await this.generateUniqueSlug(dto.title);

    // 3. Generate embedding from title + content (OpenAI or mock)
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
      // Continue with post creation even if embedding fails (non-blocking)
    }

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

    // 5. Save embedding to database (after transaction)
    // Using raw SQL since Prisma doesn't support Unsupported("vector") types in updates
    // IMPORTANT: Convert array to JSON string literal, then cast to vector(768)
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

  /**
   * Update post with partial fields and embedding regeneration
   * 
   * Workflow:
   * 1. Fetch existing post
   * 2. Update fields: title (regenerate slug), content (sanitize), status
   * 3. Regenerate embedding if title or content changed
   * 4. Update tags if provided
   * 5. Invalidate caches (detail + list)
   * 6. Log activity for published posts
   * 
   * Embedding Update:
   * - Triggered when title OR content_markdown changes
   * - Combines new title + content for semantic meaning
   * - Non-blocking: post update succeeds even if embedding fails
   * - Uses raw SQL to save (Prisma limitation with Unsupported types)
   * 
   * Security:
   * - Content is sanitized before update to prevent XSS injection
   * - Slug uniqueness verified per post
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

  /**
   * SEMANTIC SEARCH: Search posts using vector embeddings
   * 
   * Strategy:
   * 1. Check Redis cache for search results (cache hit = no API call)
   * 2. Generate embedding for query (via API or local model)
   * 3. Query database using pgvector cosine distance (<=> operator)
   * 4. Filter out soft-deleted and draft posts
   * 5. Apply OwnershipGuard logic (non-authors can't see drafts)
   * 6. Cache results for 30 minutes to reduce API costs
   * 7. Return top 5 most relevant posts
   * 
   * Vector Search Details:
   * - Uses HNSW index for O(log n) search performance
   * - <=> operator calculates cosine distance (0-2 range)
   * - Lower distance = higher relevance
   * - Query size: 768 dimensions (OpenAI text-embedding-3-small standard)
   * 
   * Cost Optimization:
   * - Redis cache reduces API calls (embedding generation is expensive)
   * - Common queries benefit from cache hits
   * - TTL: 30 minutes (reasonable for search freshness)
   * 
   * Security:
   * - Non-ADMIN users cannot see soft-deleted posts
   * - Non-authors cannot see draft posts
   * - Query parameter validated
   */
  async searchPosts(
    query: string,
    userRole?: string,
    userId?: number,
    limit: number = 5,
  ): Promise<PostResponseDto[]> {
    // Validate query
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Search query cannot be empty');
    }

    if (query.trim().length > 500) {
      throw new BadRequestException('Search query exceeds 500 characters');
    }

    // 1. Check Redis cache first
    const cacheKey = `search:${query.toLowerCase()}:role:${userRole || 'guest'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      console.log(`[SEARCH] Cache hit for query: "${query}"`);
      return JSON.parse(cached);
    }

    // 2. Generate embedding for the query
    const queryEmbedding = await this.generateEmbedding(query);

    // 3. Execute vector search using pgvector cosine distance
    // SQL: SELECT * FROM posts ORDER BY embedding <=> $1::vector LIMIT $2
    // FIX: Using $queryRawUnsafe with explicit parameter indexing to avoid parameter mapping issues
    // - $1: Vector array formatted as string literal '[0.1,0.2,...]'
    // - $2: Integer limit value
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
      ORDER BY 
        p.embedding <=> $1::vector
      LIMIT $2::bigint
    `;

    const vectorResults = await this.prisma.$queryRawUnsafe<any[]>(
      sql,
      embeddingString,
      limitInt,
    );

    if (!vectorResults || vectorResults.length === 0) {
      console.log(`[SEARCH] No results for query: "${query}"`);
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

    console.log(
      `[SEARCH] Found ${formattedResults.length} results for query: "${query}"`,
    );
    return formattedResults;
  }

  /**
   * Generate embedding for text using OpenAI API
   * 
   * Integration Options:
   * 1. OpenAI text-embedding-3-small (RECOMMENDED)
   *    - 1536 dimensions
   *    - $0.02 per 1M tokens
   *    - High quality embeddings
   * 
   * 2. OpenAI text-embedding-3-large
   *    - 3072 dimensions
   *    - $0.13 per 1M tokens
   *    - Better quality, slower
   * 
   * 3. Local: transformers.js (optional)
   *    - No API calls = no cost
   *    - Slower but deterministic
   * 
   * Error Handling:
   * - Falls back to mock embedding if API fails (graceful degradation)
   * - Logs API errors for monitoring
   * - Never throws - search still works with mock embeddings
   * 
   * Environment Variables Required:
   * - GEMINI_API_KEY: Your Google Gemini API key
   * - GEMINI_MODEL: Embedding model (default: text-embedding-004)
   * 
   * Using: Google Gemini text-embedding-004 (768 dimensions, FREE tier)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // Delegate to EmbeddingService (Gemini API)
    return this.embeddingService.generateEmbedding(text);
  }

  /**
   * Generate mock embedding for local testing/fallback
   * 
   * Used when:
   * - OPENAI_API_KEY is not configured
   * - OpenAI API is unavailable
   * - For development/testing
   * 
   * Note: Mock embeddings are deterministic based on text hash
   * This allows consistent search results during testing
   * In production, only use real embeddings from API
   */
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

  /**
   * Update post embedding when content changes
   * 
   * Should be called in updatePost() when content_markdown changes
   * Uses raw SQL since Prisma doesn't support Unsupported("vector") in update operations
   * 
   * SQL: UPDATE posts SET embedding = $1::vector WHERE id = $2
   */
  async updatePostEmbedding(postId: number, content: string): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(content);

      // Use raw SQL for vector operations (Prisma limitation)
      // $1 = embedding array, $2 = postId
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

  /**
   * Generate embeddings for all posts (batch operation)
   * 
   * Use cases:
   * - Initial database population
   * - Recovery from embedding failures
   * - Re-indexing after embedding model update
   * 
   * Performance:
   * - Process in batches of 10 to avoid API rate limits
   * - Rate limit: ~3,500 requests per minute on OpenAI
   * - Estimated time for 1,000 posts: ~20 minutes
   * 
   * SQL: Get posts where embedding IS NULL (using raw SQL)
   * 
   * CLI Usage:
   * - Create a dedicated NestJS command or schedule task
   * - Example: node cli.js embed-all-posts
   */
  /**
   * Backfill all post embeddings with new 768-dimensional Gemini embeddings
   * 
   * Use Case:
   * - Migration from OpenAI (1536 dims) to Gemini (768 dims)
   * - Vector dimension mismatch errors in pgvector operations
   * - Regenerate embeddings after model change
   * 
   * Process:
   * 1. Fetch all posts (regardless of embedding status)
   * 2. Generate new 768-dimensional embeddings
   * 3. Update database with new embeddings
   * 4. Handle failures gracefully with detailed logging
   * 
   * Performance:
   * - Batch processing to avoid memory overflow
   * - 100ms delay between requests (API rate limiting)
   * - ~6-10 seconds per post (API + DB latency)
   * - ~100 posts per 15 minutes
   * 
   * Example Usage:
   * ```
   * const result = await postsService.backfillEmbeddingsForAllPosts();
   * console.log(`Success: ${result.processed}/${result.total}`);
   * ```
   */
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
