import { Injectable, Inject } from '@nestjs/common';
import type { Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { Logger } from '@nestjs/common';

/**
 * PostPublishingService - Helper to coordinate post publishing with AI processing
 * 
 * When a post is published:
 * 1. Emit post.published event
 * 2. Queue AI processor job for embedding, moderation, tagging
 */
@Injectable()
export class PostPublishingService {
  private readonly logger = new Logger(PostPublishingService.name);

  constructor(
    @InjectQueue('aiProcessor') private aiProcessorQueue: Queue,
  ) {}

  /**
   * Trigger AI processing for published post
   */
  async processPublishedPost(
    postId: number,
    title: string,
    content: string,
    authorId: number,
  ): Promise<void> {
    try {
      await this.aiProcessorQueue.add('processPublishedPost', {
        postId,
        title,
        content,
        authorId,
      });

      this.logger.log(`AI processor queued for post #${postId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to queue AI processor for post #${postId}: ${error.message}`,
      );
      throw error;
    }
  }
}
