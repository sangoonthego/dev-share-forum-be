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

export interface AiProcessorJobData {
  postId: number;
  title: string;
  content: string;
  authorId: number;
}

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('email') private emailQueue: Queue<EmailJobData>,
    @InjectQueue('embedding') private embeddingQueue: Queue<EmbeddingJobData>,
    @InjectQueue('viewCount') private viewCountQueue: Queue<ViewCountJobData>,
    @InjectQueue('aiProcessor') private aiProcessorQueue: Queue<AiProcessorJobData>,
    private logger: LoggerService,
  ) {}

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

  async queueEmbedding(data: EmbeddingJobData): Promise<Job<EmbeddingJobData>> {
    try {
      // CRITICAL FIX: Add retry strategy for embedding failures
      // Prevents "ghost posts" (published but invisible to semantic search)
      const job = await this.embeddingQueue.add(data, {
        priority: 5,
        jobId: `embedding-${data.postId}-${Date.now()}`,
        // ADDED: Retry configuration with exponential backoff
        attempts: 3, // Retry up to 3 times
        backoff: {
          type: 'exponential',
          delay: 2000, // Start with 2s delay, then 4s, 8s
        },
        removeOnComplete: true, // Clean up successful jobs
        removeOnFail: false, // Keep failed jobs for debugging
      });

      this.logger.debug(`Embedding job queued: ${job.id}`, 'QUEUE');
      return job;
    } catch (error) {
      this.logger.error('Failed to queue embedding job', error, 'QUEUE');
      throw error;
    }
  }

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

  async queueAiProcessor(data: AiProcessorJobData): Promise<Job<AiProcessorJobData>> {
    try {
      const job = await this.aiProcessorQueue.add('processPublishedPost', data, {
        priority: 7,
        jobId: `ai-${data.postId}-${Date.now()}`,
      });

      this.logger.debug(`AI processor job queued: ${job.id}`, 'QUEUE');
      return job;
    } catch (error) {
      this.logger.error('Failed to queue AI processor job', error, 'QUEUE');
      throw error;
    }
  }

  async getQueueStats() {
    try {
      const [emailStats, embeddingStats, viewCountStats, aiProcessorStats] = await Promise.all([
        this.emailQueue.getJobCounts(),
        this.embeddingQueue.getJobCounts(),
        this.viewCountQueue.getJobCounts(),
        this.aiProcessorQueue.getJobCounts(),
      ]);

      return {
        email: emailStats,
        embedding: embeddingStats,
        viewCount: viewCountStats,
        aiProcessor: aiProcessorStats,
      };
    } catch (error) {
      this.logger.error('Failed to get queue stats', error, 'QUEUE');
      return null;
    }
  }

  async getJobStatus(queueName: string, jobId: string) {
    try {
      const queue =
        queueName === 'email'
          ? this.emailQueue
          : queueName === 'embedding'
            ? this.embeddingQueue
            : queueName === 'viewCount'
              ? this.viewCountQueue
              : this.aiProcessorQueue;

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

  async clearQueue(queueName: string): Promise<void> {
    try {
      const queue =
        queueName === 'email'
          ? this.emailQueue
          : queueName === 'embedding'
            ? this.embeddingQueue
            : queueName === 'viewCount'
              ? this.viewCountQueue
              : this.aiProcessorQueue;

      await queue.clean(0, 'failed');
      await queue.empty();

      this.logger.warn(`Queue cleared: ${queueName}`, 'QUEUE');
    } catch (error) {
      this.logger.error('Failed to clear queue', error, 'QUEUE');
      throw error;
    }
  }
}

