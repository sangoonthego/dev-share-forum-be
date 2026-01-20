import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/common/logger/logger.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ViewCountJobData } from '../queue.service';

/**
 * ViewCountProcessor - Handles post view count updates
 * 
 * Processes:
 * - Increments post view counts
 * - Can batch multiple increments if needed
 * - Non-critical (can fail without affecting user experience)
 */
@Processor('viewCount')
@Injectable()
export class ViewCountProcessor {
  constructor(
    private logger: LoggerService,
    private prisma: PrismaService,
  ) {}

  @Process()
  async handleViewCountJob(job: Job<ViewCountJobData>) {
    const { slug, increment = 1 } = job.data;

    try {
      this.logger.debug(
        `Processing view count job: ${job.id} for slug ${slug}`,
        'VIEWCOUNT_PROCESSOR',
      );

      // Increment view count atomically
      await this.prisma.posts.update({
        where: { slug },
        data: {
          view_count: {
            increment,
          },
        },
      });

      this.logger.debug(
        `View count incremented for post ${slug} by ${increment}`,
        'VIEWCOUNT_PROCESSOR',
      );

      return {
        success: true,
        slug,
        incrementedBy: increment,
      };
    } catch (error) {
      this.logger.error(
        `Failed to update view count for slug ${slug}`,
        error,
        'VIEWCOUNT_PROCESSOR',
      );

      // Don't throw - view count is non-critical
      // Job will be removed on failure by queue config
      return {
        success: false,
        slug,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @OnQueueCompleted()
  onViewCountJobCompleted(job: Job, result: any) {
    this.logger.debug(
      `View count job completed: ${job.id}`,
      'VIEWCOUNT_PROCESSOR',
      result,
    );
  }

  @OnQueueFailed()
  onViewCountJobFailed(job: Job, error: Error) {
    // Log but don't escalate - view count is non-critical
    this.logger.debug(
      `View count job failed: ${job.id}`,
      'VIEWCOUNT_PROCESSOR',
    );
  }
}
