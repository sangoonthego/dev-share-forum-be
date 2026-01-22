import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { GeminiService } from './gemini.service';
import * as Sentry from '@sentry/nestjs';

/**
 * AiEmbeddingService - Generate and manage embeddings for semantic search
 * 
 * Features:
 * - Generate 768-dimensional embeddings using Gemini text-embedding-004
 * - Store embeddings in PostgreSQL with pgvector extension
 * - Cache embedding vectors in Redis for quick retrieval
 * - Atomic batch updates with error handling
 * - Similarity search using pgvector (<=> operator)
 */
@Injectable()
export class AiEmbeddingService {
  private readonly logger = new Logger(AiEmbeddingService.name);
  private readonly embeddingCacheTTL = 86400; // 24 hours

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * Generate embedding for post content
   * Returns vector and stores in cache
   */
  async generatePostEmbedding(
    postId: number,
    title: string,
    content: string,
  ): Promise<number[]> {
    try {
      // Combine title and content for richer context
      const textToEmbed = `Title: ${title}\n\nContent: ${content}`.substring(
        0,
        8000,
      );

      // Generate embedding
      const embedding = await this.geminiService.generateEmbedding(textToEmbed);

      // Cache embedding in Redis
      const cacheKey = `embedding:post:${postId}`;
      await this.redisService.set(
        cacheKey,
        JSON.stringify(embedding),
        this.embeddingCacheTTL,
      );


      Sentry.captureMessage(
        `Embedding generated for post ${postId} (768 dimensions)`,
        'info',
      );

      return embedding;
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: {
          operation: 'generate_post_embedding',
          postId,
        },
      });
      this.logger.error(
        `Failed to generate embedding for post ${postId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Save embedding vector to database
   * Uses atomic update to prevent race conditions
   */
  async savePostEmbedding(
    postId: number,
    embedding: number[],
  ): Promise<void> {
    try {
      // Convert array to PostgreSQL vector format
      const vectorString = `[${embedding.join(',')}]`;

      // Use raw SQL for atomic update with pgvector
      await this.prismaService.$executeRawUnsafe(
        `UPDATE posts SET embedding = $1::vector(768) WHERE id = $2`,
        vectorString,
        postId,
      );


      this.logger.debug(
        `Embedding saved to database for post ${postId}`,
      );
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: {
          operation: 'save_post_embedding',
          postId,
        },
      });
      this.logger.error(
        `Failed to save embedding for post ${postId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Generate and save embedding in one atomic operation
   */
  async generateAndSaveEmbedding(
    postId: number,
    title: string,
    content: string,
  ): Promise<number[]> {
    const embedding = await this.generatePostEmbedding(
      postId,
      title,
      content,
    );
    await this.savePostEmbedding(postId, embedding);
    return embedding;
  }

  /**
   * Retrieve similar posts using pgvector similarity search
   * Returns top 5 posts with similarity > 0.7 threshold
   */
  async findSimilarPosts(
    queryEmbedding: number[],
    limit: number = 5,
    similarityThreshold: number = 0.7,
  ): Promise<
    Array<{
      id: number;
      title: string;
      slug: string;
      content_markdown: string;
      embedding_similarity: number;
    }>
  > {

    try {
      const vectorString = `[${queryEmbedding.join(',')}]`;

      // Use pgvector <=> operator for fast cosine similarity search
      // Distance ranges from 0 (identical) to 2 (opposite)
      // Similarity = 1 - distance/2, so threshold 0.7 means distance <= 0.6
      const maxDistance = 2 * (1 - similarityThreshold);

      const results = await this.prismaService.$queryRawUnsafe<
        Array<{
          id: number;
          title: string;
          slug: string;
          content_markdown: string;
          similarity: number;
        }>
      >(
        `
        SELECT 
          p.id,
          p.title,
          p.slug,
          p.content_markdown,
          ROUND((1 - (p.embedding <=> $1::vector(768)) / 2)::numeric, 3) AS similarity
        FROM posts p
        WHERE 
          p.embedding IS NOT NULL 
          AND p.status = 'PUBLISHED'
          AND p.deleted_at IS NULL
          AND (p.embedding <=> $1::vector(768)) <= $2
        ORDER BY p.embedding <=> $1::vector(768) ASC
        LIMIT $3
        `,
        vectorString,
        2 * (1 - similarityThreshold),
        limit,
      );

      const formattedResults = results.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        content_markdown: r.content_markdown,
        embedding_similarity: r.similarity,
      }));


      Sentry.captureMessage(
        `Found ${formattedResults.length} similar posts`,
        'info',
      );

      return formattedResults;
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: {
          operation: 'find_similar_posts',
        },
      });
      this.logger.error(
        `Failed to find similar posts: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get embedding from cache or generate if not found
   */
  async getOrGenerateEmbedding(
    postId: number,
    title: string,
    content: string,
  ): Promise<number[]> {
    // Try cache first
    const cacheKey = `embedding:post:${postId}`;
    const cached = await this.redisService.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (error) {
        this.logger.warn(
          `Failed to parse cached embedding for post ${postId}`,
        );
      }
    }

    // Generate if not in cache
    return this.generatePostEmbedding(postId, title, content);
  }

  /**
   * Delete embedding from cache and database
   */
  async deletePostEmbedding(postId: number): Promise<void> {
    try {
      // Delete from cache
      const cacheKey = `embedding:post:${postId}`;
      await this.redisService.del(cacheKey);

      // Delete from database
      await this.prismaService.$executeRawUnsafe(
        `UPDATE posts SET embedding = NULL WHERE id = $1`,
        postId,
      );


      this.logger.debug(`Embedding deleted for post ${postId}`);
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: {
          operation: 'delete_post_embedding',
          postId,
        },
      });
      throw error;
    }
  }

  /**
   * Batch process embeddings for multiple posts
   * Useful for bulk operations
   */
  async batchGenerateEmbeddings(
    posts: Array<{ id: number; title: string; content_markdown: string }>,
  ): Promise<Map<number, number[]>> {
    const results = new Map<number, number[]>();
    const errors: Array<{ postId: number; error: string }> = [];

    try {
      for (const post of posts) {
        try {
          const embedding = await this.generateAndSaveEmbedding(
            post.id,
            post.title,
            post.content_markdown,
          );
          results.set(post.id, embedding);
        } catch (error: any) {
          errors.push({
            postId: post.id,
            error: error.message,
          });
          this.logger.error(
            `Failed to generate embedding for post ${post.id}: ${error.message}`,
          );
        }
      }


      if (errors.length > 0) {
        Sentry.captureMessage(
          `Batch embedding generation completed with ${errors.length} errors`,
          'warning',
        );
      }

      return results;
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: {
          operation: 'batch_generate_embeddings',
        },
      });
      throw error;
    }
  }
}
