import { Injectable } from '@nestjs/common';
import type { Queue, Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { LoggerService } from 'src/common/logger/logger.service';

export interface EmailJobData {
  userId: number;
  email: string;
  subject: string;
  template: string;
  variables?: Record<string, any>;
}

export interface EmbeddingJobData {
  postId: number;
  title: string;
  content: string;
}

export interface ViewCountJobData {
  slug: string;
  increment?: number;
}

/**
 * QueueService - Background job management using BullMQ + Redis
 * 
 * Responsibilities:
 * - Add jobs to queues
 * - Track job status
 * - Provide statistics
 * 
 * Architecture:
 * - Email queue: High priority for user notifications
 * - Embedding queue: Medium priority for AI processing
 * - View count queue: Low priority, can be batch processed
 */
@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('email') private emailQueue: Queue<EmailJobData>,
    @InjectQueue('embedding') private embeddingQueue: Queue<EmbeddingJobData>,
    @InjectQueue('viewCount') private viewCountQueue: Queue<ViewCountJobData>,
    private logger: LoggerService,
  ) {}

  /**
   * Add email job to queue
   * Used for: User notifications, password reset, email verification
   */
  async queueEmail(data: EmailJobData): Promise<Job<EmailJobData>> {
    try {
      const job = await this.emailQueue.add(data, {
        priority: 10, // Higher priority
        jobId: `email-${data.userId}-${Date.now()}`,
      });

      this.logger.debug(`Email job queued: ${job.id}`, 'QUEUE');
      return job;
    } catch (error) {
      this.logger.error('Failed to queue email job', error, 'QUEUE');
      throw error;
    }
  }

  /**
   * Add embedding job to queue
   * Used for: Post creation, post updates, batch processing
   */
  async queueEmbedding(data: EmbeddingJobData): Promise<Job<EmbeddingJobData>> {
    try {
      const job = await this.embeddingQueue.add(data, {
        priority: 5,
        jobId: `embedding-${data.postId}-${Date.now()}`,
      });

      this.logger.debug(`Embedding job queued: ${job.id}`, 'QUEUE');
      return job;
    } catch (error) {
      this.logger.error('Failed to queue embedding job', error, 'QUEUE');
      throw error;
    }
  }

  /**
   * Add view count increment job to queue
   * Used for: Post view tracking (batched for performance)
   */
  async queueViewCountIncrement(slug: string): Promise<Job<ViewCountJobData>> {
    try {
      const job = await this.viewCountQueue.add(
        { slug, increment: 1 },
        {
          priority: 1, // Lowest priority
          jobId: `viewcount-${slug}-${Date.now()}`,
        },
      );

      this.logger.debug(`View count job queued: ${job.id}`, 'QUEUE');
      return job;
    } catch (error) {
      this.logger.error('Failed to queue view count job', error, 'QUEUE');
      throw error;
    }
  }

  /**
   * Get queue statistics for monitoring
   */
  async getQueueStats() {
    try {
      const [emailStats, embeddingStats, viewCountStats] = await Promise.all([
        this.emailQueue.getJobCounts(),
        this.embeddingQueue.getJobCounts(),
        this.viewCountQueue.getJobCounts(),
      ]);

      return {
        email: emailStats,
        embedding: embeddingStats,
        viewCount: viewCountStats,
      };
    } catch (error) {
      this.logger.error('Failed to get queue stats', error, 'QUEUE');
      return null;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(queueName: string, jobId: string) {
    try {
      const queue =
        queueName === 'email'
          ? this.emailQueue
          : queueName === 'embedding'
            ? this.embeddingQueue
            : this.viewCountQueue;

      const job = await queue.getJob(jobId);
      if (!job) return null;

      return {
        id: job.id,
        state: await job.getState(),
        progress: job.progress(),
        attempts: job.attemptsMade,
        failedReason: job.failedReason,
      };
    } catch (error) {
      this.logger.error('Failed to get job status', error, 'QUEUE');
      return null;
    }
  }

  /**
   * Clear all jobs from a queue (use with caution)
   */
  async clearQueue(queueName: string): Promise<void> {
    try {
      const queue =
        queueName === 'email'
          ? this.emailQueue
          : queueName === 'embedding'
            ? this.embeddingQueue
            : this.viewCountQueue;

      await queue.clean(0, 'failed');
      await queue.empty();

      this.logger.warn(`Queue cleared: ${queueName}`, 'QUEUE');
    } catch (error) {
      this.logger.error('Failed to clear queue', error, 'QUEUE');
      throw error;
    }
  }
}
