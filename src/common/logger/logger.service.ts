import { Injectable, Logger } from '@nestjs/common';
import * as winston from 'winston';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class LoggerService extends Logger {
  private winstonLogger: winston.Logger;

  constructor() {
    super();
    this.winstonLogger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),
      defaultMeta: { service: 'devshare-api' },
      transports: [
        // Console transport
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              return `${timestamp} [${level}]: ${message} ${
                Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
              }`;
            }),
          ),
        }),
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 5242880,
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          maxsize: 5242880,
          maxFiles: 10,
        }),
      ],
    });

    if (process.env.SENTRY_DSN) {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACE_RATE || '0.1'),
      });
    }
  }

  private maskSensitiveData(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const masked = { ...data };
    const sensitiveFields = [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'refresh_token',
      'access_token',
      'apiKey',
      'secretKey',
      'email',
      'creditCard',
      'cvv',
      'ssn',
      'authorization',
      'cookie',
      'jwt',
    ];

    for (const field of sensitiveFields) {
      if (field in masked && masked[field]) {
        masked[field] = '***REDACTED***';
      }
    }

    return masked;
  }

  /**
   * Log error with Sentry integration
   */
  error(message: string, error?: any, context?: string) {
    const maskedError = this.maskSensitiveData(error);

    // Winston logging
    this.winstonLogger.error(message, {
      error: maskedError,
      context,
      stack: error?.stack,
    });

    // Sentry reporting
    if (process.env.SENTRY_DSN && error instanceof Error) {
      Sentry.captureException(error, {
        contexts: {
          custom: { message, context },
        },
      });
    }

    // NestJS Logger
    super.error(message, error?.stack || '');
  }

  /**
   * Log warning
   */
  warn(message: string, context?: string, data?: any) {
    const maskedData = this.maskSensitiveData(data);

    this.winstonLogger.warn(message, {
      data: maskedData,
      context,
    });

    super.warn(message);
  }

  log(message: string, context?: string, data?: any) {
    const maskedData = this.maskSensitiveData(data);

    this.winstonLogger.info(message, {
      data: maskedData,
      context,
    });

    super.log(message);
  }

  debug(message: string, context?: string, data?: any) {
    const maskedData = this.maskSensitiveData(data);

    this.winstonLogger.debug(message, {
      data: maskedData,
      context,
    });

    super.debug(message);
  }

  verbose(message: string, context?: string, data?: any) {
    const maskedData = this.maskSensitiveData(data);

    this.winstonLogger.http(message, {
      data: maskedData,
      context,
    });

    super.verbose(message);
  }

  logPerformance(
    operation: string,
    duration: number,
    context?: string,
    success: boolean = true,
  ) {
    const message = `[PERFORMANCE] ${operation}: ${duration}ms`;

    if (success) {
      this.winstonLogger.info(message, { context });
    } else {
      this.winstonLogger.warn(message, { context });
    }
  }

  logSecurityEvent(event: string, userId?: number, details?: any) {
    const maskedDetails = this.maskSensitiveData(details);

    this.winstonLogger.warn(`[SECURITY] ${event}`, {
      userId,
      details: maskedDetails,
      timestamp: new Date().toISOString(),
    });

    // Also report to Sentry
    if (process.env.SENTRY_DSN) {
      Sentry.captureMessage(`Security Event: ${event}`, {
        level: 'warning',
        contexts: {
          security: { userId, details: maskedDetails },
        },
      });
    }
  }
}
