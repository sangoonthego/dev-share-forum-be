import { Module } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { LoggingInterceptor } from './logging.interceptor';

@Module({
  providers: [LoggerService, LoggingInterceptor],
  exports: [LoggerService, LoggingInterceptor],
})
export class LoggerModule {}
