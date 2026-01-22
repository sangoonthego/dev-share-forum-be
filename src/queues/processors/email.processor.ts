import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import type { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/common/logger/logger.service';
import { EmailJobData } from '../queue.service';

@Processor('email')
@Injectable()
export class EmailProcessor {
  constructor(private logger: LoggerService) {}

  @Process()
  async handleEmailJob(job: Job<EmailJobData>) {
    const { userId, email, subject, template, variables } = job.data;

    try {
      this.logger.log(
        `Processing email job: ${job.id} for user ${userId}`,
        'EMAIL_PROCESSOR',
      );

      await this.sendEmailViaProvider(email, subject, template, variables);

      this.logger.log(
        `Email sent successfully to ${email}`,
        'EMAIL_PROCESSOR',
        { jobId: job.id, userId },
      );

      return {
        success: true,
        email,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${email}`,
        error,
        'EMAIL_PROCESSOR',
      );

      throw error;
    }
  }

  private async sendEmailViaProvider(
    email: string,
    subject: string,
    template: string,
    variables?: Record<string, any>,
  ): Promise<void> {
    console.log(`[EMAIL] Sending to ${email}: ${subject}`);
    console.log(`[EMAIL] Template: ${template}, Variables:`, variables);

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  @OnQueueCompleted()
  onEmailJobCompleted(job: Job, result: any) {
    this.logger.log(`Email job completed: ${job.id}`, 'EMAIL_PROCESSOR', result);
  }

  @OnQueueFailed()
  onEmailJobFailed(job: Job, error: Error) {
    this.logger.error(
      `Email job failed: ${job.id} after ${job.attemptsMade} attempts`,
      error,
      'EMAIL_PROCESSOR',
    );

    if (job.data.template === 'password-reset') {
      this.logger.logSecurityEvent(
        'Password reset email failed to send',
        job.data.userId,
        { email: job.data.email, jobId: job.id },
      );
    }
  }
}
