import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggerService } from './logger.service';

/**
 * LoggingInterceptor - Intercepts all HTTP requests/responses
 * 
 * Features:
 * - Logs all API calls with timing
 * - Masks sensitive request/response data
 * - Captures request parameters, headers (non-sensitive)
 * - Logs response status and timing
 * - Useful for debugging and audit trails
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private logger: LoggerService) {}

  private maskSensitiveHeaders(headers: any): any {
    const masked = { ...headers };
    const sensitiveHeaders = [
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
    ];

    for (const header of sensitiveHeaders) {
      if (header in masked) {
        masked[header] = '***REDACTED***';
      }
    }

    return masked;
  }

  private maskSensitiveBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const masked = { ...body };
    const sensitiveFields = [
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'email',
    ];

    for (const field of sensitiveFields) {
      if (field in masked) {
        masked[field] = '***REDACTED***';
      }
    }

    return masked;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    const { method, url, headers, body } = request;
    const maskedHeaders = this.maskSensitiveHeaders(headers);
    const maskedBody = this.maskSensitiveBody(body);

    this.logger.log(`Incoming Request: ${method} ${url}`, 'HTTP', {
      headers: maskedHeaders,
      body: maskedBody,
    });

    return next.handle().pipe(
      tap((response) => {
        const duration = Date.now() - startTime;
        const statusCode = context.switchToHttp().getResponse().statusCode;

        this.logger.log(`Outgoing Response: ${method} ${url} - ${statusCode}`, 'HTTP', {
          duration: `${duration}ms`,
          statusCode,
        });

        // Log performance warning for slow requests
        if (duration > 1000) {
          this.logger.warn(
            `Slow API Request: ${method} ${url} took ${duration}ms`,
            'PERFORMANCE',
          );
        }
      }),
    );
  }
}
