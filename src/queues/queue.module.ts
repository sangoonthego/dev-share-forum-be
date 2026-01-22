import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { EmailProcessor } from './processors/email.processor';
import { EmbeddingProcessor } from './processors/embedding.processor';
import { ViewCountProcessor } from './processors/view-count.processor';
import { PostProcessorWorker } from './processors/ai-post-processor.worker';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LoggerModule } from 'src/common/logger/logger.module';
import { AiModule } from 'src/ai/ai.module';

/**
 * QueueModule - BullMQ integration for background job processing
 * 
 * Queues:
 * - email: Email notifications (send emails, notifications)
 * - embedding: AI embedding generation for semantic search
 * - viewCount: View count updates (batched for performance)
 * - aiProcessor: AI tasks (embedding, moderation, tagging)
 * 
 * Benefits:
 * - Decouples heavy tasks from request/response cycle
 * - Automatic retry logic
 * - Dead letter queue for failed jobs
 * - Job persistence
 * - Worker scaling
 */
@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'email',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000, // Start at 2 seconds
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
      {
        name: 'embedding',
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
      {
        name: 'viewCount',
        defaultJobOptions: {
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true, // Less critical, can discard failed jobs
        },
      },
      {
        name: 'aiProcessor',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000, // Start at 2 seconds
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    ),
    PrismaModule,
    LoggerModule,
    AiModule,
  ],
  providers: [QueueService, EmailProcessor, EmbeddingProcessor, ViewCountProcessor, PostProcessorWorker],
  exports: [QueueService],
})
export class QueueModule {}
