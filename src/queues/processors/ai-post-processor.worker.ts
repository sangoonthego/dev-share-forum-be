import { Processor, Process } from '@nestjs/bull';
import { Logger, Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from 'src/prisma/prisma.service';
import { GeminiService } from 'src/ai/services/gemini.service';
import { AiEmbeddingService } from 'src/ai/services/ai-embedding.service';
import * as Sentry from '@sentry/nestjs';

/**
 * PostProcessorWorker - Background processor for post.published event
 * * Tasks:
 * 1. Generate embeddings for semantic search (768 dimensions)
 * 2. Check content safety/toxicity with Gemini
 * 3. Auto-tag posts with AI suggestions
 * * Retry Strategy:
 * - Max 3 attempts with exponential backoff (2s, 4s, 8s)
 * - Failed jobs stored in Redis for manual review
 */

@Injectable()
@Processor('aiProcessor')
export class PostProcessorWorker {
  private readonly logger = new Logger(PostProcessorWorker.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly geminiService: GeminiService,
    private readonly embeddingService: AiEmbeddingService,
  ) {}

  /**
   * Task 1 & 2 & 3: Process newly published post
   * Orchestrates embedding, safety check, and tagging
   * Implements Sentry v8+ OpenTelemetry Root Span with nested child spans
   */
  @Process('processPublishedPost')
  async processPublishedPost(
    job: Job<{
      postId: number;
      title: string;
      content: string;
      authorId: number;
    }>,
  ): Promise<void> {
    const { postId, title, content, authorId } = job.data;

    // Root Span: Primary transaction for entire business logic flow
    return Sentry.startSpan(
      {
        name: 'processPublishedPost',
        op: 'queue.process',
        attributes: {
          'post.id': postId,
          'user.id': authorId,
          'queue.job.id': job.id?.toString(),
          'queue.name': 'aiProcessor',
          'queue.processor': 'processPublishedPost',
        },
      },
      async (rootSpan) => {
        try {
          this.logger.log(`Processing published post #${postId}`);

          // Run all AI tasks in parallel for efficiency
          const [embedding, isSafe, suggestedTags] = await Promise.all([
            this.processEmbedding(postId, title, content),
            this.processSafety(postId, content, authorId),
            this.processTagging(postId, content),
          ]);

          // Attach final results to root span
          rootSpan?.setAttributes({
            'result.embedding_generated': !!embedding,
            'result.is_safe': isSafe,
            'result.tags_count': suggestedTags.length,
            'result.tags': suggestedTags.join(','),
          });

          rootSpan?.setStatus({ code: 0 as any }); // 0 = Ok

          Sentry.captureMessage(
            `Post #${postId} processed: embedding=${!!embedding}, safe=${isSafe}, tags=${suggestedTags.length}`,
            'info',
          );

          this.logger.log(
            `Post #${postId} processed successfully. Tags: ${suggestedTags.join(', ')}`,
          );
        } catch (error: any) {
          // Set span status to error
          rootSpan?.setStatus({ code: 2 as any, message: error.message }); // 2 = Error

          // Capture exception and link to current span
          Sentry.captureException(error, {
            tags: {
              operation: 'process_published_post',
              postId: postId.toString(),
              authorId: authorId.toString(),
            },
            attributes: {
              'post.id': postId,
              'user.id': authorId,
              'error.phase': 'root_orchestration',
            },
          });

          this.logger.error(
            `Failed to process post #${postId}: ${error.message}`,
            error.stack,
          );

          // Retry logic handled by Bull
          throw error;
        }
      },
    );
  }

  /**
   * Task 1: Generate and save embedding
   * Child Span: Database write + Embedding API call
   */
  private async processEmbedding(
    postId: number,
    title: string,
    content: string,
  ): Promise<number[] | null> {
    return Sentry.startSpan(
      {
        name: 'processEmbedding',
        op: 'ai.embedding',
        attributes: {
          'post.id': postId,
          'content.length': content.length,
          'title.length': title.length,
        },
      },
      async (embeddingSpan) => {
        try {
          const embedding = await Sentry.startSpan(
            {
              name: 'generateAndSaveEmbedding',
              op: 'ai.api.call',
              attributes: {
                'post.id': postId,
                'service': 'ai-embedding-service',
              },
            },
            async (apiSpan) => {
              return this.embeddingService.generateAndSaveEmbedding(
                postId,
                title,
                content,
              );
            },
          );

          embeddingSpan?.setAttributes({
            'result.success': true,
            'result.dimension': embedding?.length || 0,
          });

          embeddingSpan?.setStatus({ code: 0 as any }); // 0 = Ok

          this.logger.debug(
            `Embedding generated for post #${postId}: 768 dimensions`,
          );

          return embedding;
        } catch (error: any) {
          embeddingSpan?.setStatus({
            code: 2 as any, // 2 = Error
            message: error.message,
          });

          Sentry.captureException(error, {
            tags: {
              task: 'embedding',
              postId: postId.toString(),
            },
            attributes: {
              'post.id': postId,
              'error.phase': 'embedding_generation',
              'error.recoverable': true,
            },
          });

          this.logger.error(
            `Embedding generation failed for post #${postId}: ${error.message}`,
          );

          // Don't throw - other tasks should continue
          return null;
        }
      },
    );
  }

  /**
   * Task 2: Check content safety/toxicity
   * If unsafe, archive post and notify admin
   * Child Spans: Gemini API call, Database update, Notification creation
   */
  private async processSafety(
    postId: number,
    content: string,
    authorId: number,
  ): Promise<boolean> {
    return Sentry.startSpan(
      {
        name: 'processSafety',
        op: 'ai.safety_check',
        attributes: {
          'post.id': postId,
          'user.id': authorId,
          'content.length': content.length,
        },
      },
      async (safetySpan) => {
        try {
          // Child Span: Gemini API Call
          const isSafe = await Sentry.startSpan(
            {
              name: 'checkSafety',
              op: 'ai.api.call',
              attributes: {
                'post.id': postId,
                'service': 'gemini',
                'operation': 'safety_check',
              },
            },
            async (geminiSpan) => {
              return this.geminiService.checkSafety(content);
            },
          );

          if (!isSafe) {
            safetySpan?.setAttributes({
              'result.is_safe': false,
              'action.taken': 'post_archived',
            });

            // Child Span: Archive Post (Database Update)
            await Sentry.startSpan(
              {
                name: 'archiveUnsafePost',
                op: 'db.write',
                attributes: {
                  'post.id': postId,
                  'database.operation': 'update',
                  'table': 'posts',
                },
              },
              async (archiveSpan) => {
                try {
                  await this.prismaService.posts.update({
                    where: { id: postId },
                    data: {
                      status: 'ARCHIVED',
                    },
                  });
                  archiveSpan?.setStatus({ code: 0 as any }); // 0 = Ok
                } catch (error: any) {
                  archiveSpan?.setStatus({
                    code: 2 as any, // 2 = Error
                    message: error.message,
                  });
                  throw error;
                }
              },
            );

            // Child Span: Notify Admins
            await Sentry.startSpan(
              {
                name: 'notifyAdmins',
                op: 'db.write',
                attributes: {
                  'post.id': postId,
                  'user.id': authorId,
                  'notification.type': 'safety_violation',
                },
              },
              async (notifySpan) => {
                try {
                  // Fetch admin users
                  const adminUsers = await Sentry.startSpan(
                    {
                      name: 'fetchAdminUsers',
                      op: 'db.read',
                      attributes: {
                        'query': 'find_admins',
                      },
                    },
                    async (fetchSpan) => {
                      return this.prismaService.users.findMany({
                        where: { role: 'ADMIN' },
                      });
                    },
                  );

                  notifySpan?.setAttributes({
                    'admins.count': adminUsers.length,
                  });

                  // Notify each admin
                  for (const admin of adminUsers) {
                    await this.prismaService.notifications.create({
                      data: {
                        user_id: admin.id,
                        title: 'Post Removed - Safety Policy',
                        message: `Post #${postId} from user #${authorId} was archived due to safety violations.`,
                        type: 'system',
                        is_read: false,
                      },
                    });
                  }
                  notifySpan?.setStatus({ code: 0 as any }); // 0 = Ok
                } catch (error: any) {
                  notifySpan?.setStatus({
                    code: 2 as any, // 2 = Error
                    message: error.message,
                  });
                  throw error;
                }
              },
            );

            Sentry.captureMessage(
              `Unsafe content detected in post #${postId}, archived and notified admins`,
              'warning',
            );
            this.logger.warn(
              `Post #${postId} archived due to safety violations`,
            );
          } else {
            safetySpan?.setAttributes({
              'result.is_safe': true,
            });
          }

          safetySpan?.setStatus({ code: 0 as any }); // 0 = Ok
          return isSafe;
        } catch (error: any) {
          safetySpan?.setStatus({
            code: 2 as any, // 2 = Error
            message: error.message,
          });

          Sentry.captureException(error, {
            tags: {
              task: 'safety_check',
              postId: postId.toString(),
              authorId: authorId.toString(),
            },
            attributes: {
              'post.id': postId,
              'user.id': authorId,
              'error.phase': 'safety_check',
              'error.recoverable': true,
            },
          });

          this.logger.error(
            `Safety check failed for post #${postId}: ${error.message}`,
          );

          // Default to safe on error to not block post
          return true;
        }
      },
    );
  }

  /**
   * Task 3: Auto-tag with AI suggestions
   * Suggests tags based on content and existing tags
   * Child Spans: Gemini API call, Database queries, Tag creation, Tag attachment
   */
  private async processTagging(
    postId: number,
    content: string,
  ): Promise<string[]> {
    return Sentry.startSpan(
      {
        name: 'processTagging',
        op: 'ai.tagging',
        attributes: {
          'post.id': postId,
          'content.length': content.length,
        },
      },
      async (taggingSpan) => {
        try {
          // Child Span: Fetch Existing Tags
          const existingTags = await Sentry.startSpan(
            {
              name: 'fetchExistingTags',
              op: 'db.read',
              attributes: {
                'post.id': postId,
                'query': 'find_all_tags',
              },
            },
            async (fetchSpan) => {
              return this.prismaService.tags.findMany({
                select: { name: true },
              });
            },
          );

          const existingTagNames = existingTags.map((t) => t.name);

          // Child Span: Gemini API Call - Get Tag Suggestions
          const suggestedTags = await Sentry.startSpan(
            {
              name: 'suggestTags',
              op: 'ai.api.call',
              attributes: {
                'post.id': postId,
                'service': 'gemini',
                'operation': 'tag_suggestion',
                'existing_tags_count': existingTagNames.length,
              },
            },
            async (geminiSpan) => {
              return this.geminiService.suggestTags(
                content,
                existingTagNames,
              );
            },
          );

          if (suggestedTags.length === 0) {
            taggingSpan?.setAttributes({
              'result.suggested_tags_count': 0,
              'result.tags_attached': 0,
            });
            taggingSpan?.setStatus({ code: 0 as any }); // 0 = Ok
            return [];
          }

          taggingSpan?.setAttributes({
            'result.suggested_tags_count': suggestedTags.length,
            'result.suggested_tags': suggestedTags.join(','),
          });

          // Child Span: Create or Upsert Tags
          const tagRecords = await Sentry.startSpan(
            {
              name: 'createOrUpsertTags',
              op: 'db.write',
              attributes: {
                'post.id': postId,
                'tags.count': suggestedTags.length,
                'database.operation': 'upsert',
                'table': 'tags',
              },
            },
            async (upsertSpan) => {
              return Promise.all(
                suggestedTags.map(async (tagName) => {
                  const slug = tagName.toLowerCase().replace(/\s+/g, '-');

                  // Upsert tag
                  const tag = await this.prismaService.tags.upsert({
                    where: { name: tagName },
                    update: {},
                    create: {
                      name: tagName,
                      slug,
                      description: `Suggested tag: ${tagName}`,
                    },
                  });

                  return tag;
                }),
              );
            },
          );

          // Child Span: Fetch Post with Existing Tags
          const post = await Sentry.startSpan(
            {
              name: 'fetchPostWithTags',
              op: 'db.read',
              attributes: {
                'post.id': postId,
                'query': 'find_unique_with_relations',
              },
            },
            async (fetchPostSpan) => {
              return this.prismaService.posts.findUnique({
                where: { id: postId },
                include: { posts_tags: { select: { tag_id: true } } },
              });
            },
          );

          if (!post) {
            throw new Error(`Post #${postId} not found`);
          }

          // Child Span: Attach Tags to Post
          await Sentry.startSpan(
            {
              name: 'attachTagsToPost',
              op: 'db.write',
              attributes: {
                'post.id': postId,
                'tags.to_attach': tagRecords.length,
                'database.operation': 'create',
                'table': 'posts_tags',
              },
            },
            async (attachSpan) => {
              try {
                // Add new tags (avoid duplicates)
                const existingTagIds = new Set(
                  post.posts_tags.map((pt) => pt.tag_id),
                );

                let attachedCount = 0;
                for (const tag of tagRecords) {
                  if (!existingTagIds.has(tag.id)) {
                    await this.prismaService.posts_tags.create({
                      data: {
                        post_id: postId,
                        tag_id: tag.id,
                      },
                    });
                    attachedCount++;
                  }
                }

                attachSpan?.setAttributes({
                  'tags.attached': attachedCount,
                  'tags.skipped': tagRecords.length - attachedCount,
                });
                attachSpan?.setStatus({ code: 0 as any }); // 0 = Ok
              } catch (error: any) {
                attachSpan?.setStatus({
                  code: 2 as any, // 2 = Error
                  message: error.message,
                });
                throw error;
              }
            },
          );

          taggingSpan?.setAttributes({
            'result.tags_attached': tagRecords.length,
          });
          taggingSpan?.setStatus({ code: 0 as any }); // 0 = Ok

          Sentry.captureMessage(
            `Post #${postId} tagged with: ${suggestedTags.join(', ')}`,
            'info',
          );

          this.logger.log(
            `Post #${postId} tagged successfully: ${suggestedTags.join(', ')}`,
          );

          return suggestedTags;
        } catch (error: any) {
          taggingSpan?.setStatus({
            code: 2 as any, // 2 = Error
            message: error.message,
          });

          Sentry.captureException(error, {
            tags: {
              task: 'auto_tagging',
              postId: postId.toString(),
            },
            attributes: {
              'post.id': postId,
              'error.phase': 'auto_tagging',
              'error.recoverable': true,
            },
          });

          this.logger.error(
            `Auto-tagging failed for post #${postId}: ${error.message}`,
          );

          // Don't throw - tagging failure shouldn't block post
          return [];
        }
      },
    );
  }
}