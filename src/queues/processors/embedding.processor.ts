import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable, BadRequestException } from '@nestjs/common';
import { LoggerService } from 'src/common/logger/logger.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { GeminiService } from 'src/ai/services/gemini.service';
import { EmbeddingJobData } from '../queue.service';
import * as Sentry from '@sentry/nestjs';

// ========================================
// CRITICAL FIX #1: Real Embedding Engine
// ========================================
// Replaced mock random embeddings with real Gemini API
// Added dimension validation to catch model upgrades
// Added metadata tracking for ghost post debugging
// ========================================

// Expected dimensions for text-embedding-004
const EMBEDDING_EXPECTED_DIMENSIONS = 768;
const EMBEDDING_MODEL = 'text-embedding-004';

@Processor('embedding')
@Injectable()
export class EmbeddingProcessor {
  constructor(
    private logger: LoggerService,
    private prisma: PrismaService,
    private geminiService: GeminiService, // ADDED: Real Gemini service
  ) {}

  @Process()
  async handleEmbeddingJob(job: Job<EmbeddingJobData>) {
    const { postId, title, content } = job.data;

    // Root span for job execution
    return Sentry.startSpan(
      {
        name: 'embedding_job',
        op: 'queue.process',
        attributes: {
          'post.id': postId,
          'job.id': job.id?.toString(),
          'job.attempt': job.attemptsMade,
        },
      },
      async (rootSpan) => {
        try {
          this.logger.log(
            `Processing embedding job: ${job.id} for post ${postId}`,
            'EMBEDDING_PROCESSOR',
          );

          // FIXED: Use real Gemini embedding generation
          const embedding = await this.generateEmbeddingWithValidation(
            `${title}. ${content}`,
            postId,
          );

          // Validate dimensions before saving to database
          if (embedding.length !== EMBEDDING_EXPECTED_DIMENSIONS) {
            throw new BadRequestException(
              `Embedding dimension mismatch: expected ${EMBEDDING_EXPECTED_DIMENSIONS}, got ${embedding.length}. ` +
              `This may indicate the Gemini model was updated. Please verify with the API.`,
            );
          }

          // Save to database with vector type cast
          const embeddingString = `[${embedding.join(',')}]`;
          await this.prisma.$executeRaw`
            UPDATE "posts" 
            SET embedding = ${embeddingString}::vector(${EMBEDDING_EXPECTED_DIMENSIONS})
            WHERE id = ${postId}
          `;

          rootSpan?.setAttributes({
            'result.success': true,
            'embedding.dimensions': embedding.length,
            'embedding.model': EMBEDDING_MODEL,
          });

          rootSpan?.setStatus({ code: 0 as any }); // OK

          this.logger.log(
            `Embedding generated and saved for post ${postId} (${embedding.length} dimensions)`,
            'EMBEDDING_PROCESSOR',
            { jobId: job.id, dimensions: embedding.length, model: EMBEDDING_MODEL },
          );

          Sentry.captureMessage(
            `Embedding successfully generated for post #${postId} using ${EMBEDDING_MODEL}`,
            'info',
          );

          return {
            success: true,
            postId,
            dimensions: embedding.length,
            model: EMBEDDING_MODEL,
          };
        } catch (error) {
          rootSpan?.setStatus({ code: 2 as any, message: (error as any).message });

          this.logger.error(
            `Failed to generate embedding for post ${postId}`,
            error,
            'EMBEDDING_PROCESSOR',
          );

          // Track embedding failure for ghost post debugging
          Sentry.captureException(error, {
            tags: {
              operation: 'embedding_generation',
              postId: postId.toString(),
              jobId: job.id?.toString(),
              jobAttempt: job.attemptsMade.toString(),
            },
            attributes: {
              'post.id': postId,
              'error.phase': 'embedding_generation',
              'error.recoverable': true, // Can retry
              'job.attempt': job.attemptsMade,
            },
          });

          throw error;
        }
      },
    );
  }

  /**
   * Generate embedding using real Gemini service with dimension validation
   * CRITICAL FIX: Validates embedding dimensions to catch model changes
   */
  private async generateEmbeddingWithValidation(
    text: string,
    postId: number,
  ): Promise<number[]> {
    return Sentry.startSpan(
      {
        name: 'gemini_embedding_generation',
        op: 'ai.api.call',
        attributes: {
          'post.id': postId,
          'text.length': text.length,
          'expected_dimensions': EMBEDDING_EXPECTED_DIMENSIONS,
        },
      },
      async (span) => {
        try {
          // Generate real embedding from Gemini
          const embedding = await this.geminiService.generateEmbedding(text);

          // CRITICAL: Validate dimensions match expected
          if (!embedding || !Array.isArray(embedding)) {
            throw new BadRequestException('Gemini returned invalid embedding format');
          }

          if (embedding.length !== EMBEDDING_EXPECTED_DIMENSIONS) {
            // ALARM: Model may have changed
            const error = new BadRequestException(
              `[DIMENSION_MISMATCH_ALERT] Expected ${EMBEDDING_EXPECTED_DIMENSIONS} dimensions from ${EMBEDDING_MODEL}, ` +
              `but got ${embedding.length}. This suggests the Gemini model or embedding service was updated. ` +
              `Immediate action required: Update EMBEDDING_EXPECTED_DIMENSIONS constant and pgvector schema.`,
            );

            // High-severity alert for engineering
            Sentry.captureException(error, {
              tags: {
                alert_type: 'dimension_mismatch',
                postId: postId.toString(),
                expectedDimensions: EMBEDDING_EXPECTED_DIMENSIONS.toString(),
                actualDimensions: embedding.length.toString(),
              },
              level: 'fatal',
              attributes: {
                'post.id': postId,
                'error.phase': 'embedding_dimension_validation',
                'error.recoverable': false, // Requires manual intervention
                'alert.severity': 'critical',
              },
            });

            throw error;
          }

          span?.setAttributes({
            'embedding.dimensions_valid': true,
            'embedding.dimensions': embedding.length,
            'embedding.model': EMBEDDING_MODEL,
          });

          return embedding;
        } catch (error) {
          span?.setStatus({ code: 2 as any, message: (error as any).message });
          throw error;
        }
      },
    );
  }

  @OnQueueCompleted()
  onEmbeddingJobCompleted(job: Job, result: any) {
    this.logger.log(
      `Embedding job completed: ${job.id}`,
      'EMBEDDING_PROCESSOR',
      result,
    );
  }

  @OnQueueFailed()
  onEmbeddingJobFailed(job: Job, error: Error) {
    this.logger.error(
      `Embedding job failed: ${job.id} after ${job.attemptsMade} attempts`,
      error,
      'EMBEDDING_PROCESSOR',
    );
  }
}
