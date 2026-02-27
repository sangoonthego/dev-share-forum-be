import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  CallHandler,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Decorator: Extract trace ID from request headers / set response headers
 * Usage: @TraceId() traceId: string
 */
export const TraceId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request.headers['x-trace-id'] as string) || uuidv4();
  },
);

/**
 * Interceptor: Automatic Sentry tracing on all auth endpoints
 * Captures: request scope, response headers, errors
 */
@Injectable()
export class SentryTracingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const traceId = (request.headers['x-trace-id'] as string) || uuidv4();

    // Set response trace ID header for frontend correlation
    response.setHeader('x-trace-id', traceId);

    return Sentry.startSpan(
      {
        op: 'http.server',
        name: `${request.method} ${request.path}`,
        attributes: {
          'http.method': request.method,
          'http.url': request.url,
          'http.target': request.path,
        },
      },
      () => {
        return next.handle().pipe(
          catchError((error) => {
            // Capture exception with trace context
            Sentry.captureException(error, {
              tags: {
                endpoint: request.path,
                method: request.method,
              },
              contexts: {
                http: {
                  trace_id: traceId,
                },
              },
            });
            throw error;
          }),
        );
      },
    );
  }
}

/**
 * Factory: Create Sentry span for specific operation
 * Prevents code duplication in service methods
 *
 * Usage:
 * return createAuthSpan('auth.login', 'Login attempt', async () => {
 *   // auth logic
 * });
 */
export async function createAuthSpan<T>(
  op: string,
  name: string,
  attributes: Record<string, any>,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan(
    {
      op,
      name,
      attributes,
    },
    async (span) => {
      try {
        const result = await fn();
        // Status is automatically set based on exception
        return result;
      } catch (error) {
        throw error;
      }
    },
  );
}

/**
 * Decorator: Auto-wrap method with Sentry tracing
 * Usage:
 * @TraceSpan('auth.register', 'User registration')
 * async register(dto: RegisterDto) { ... }
 */
export function TraceSpan(op: string, name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const attributes = {
        method: propertyKey,
        class: target.constructor.name,
      };

      return createAuthSpan(op, name, attributes, () =>
        originalMethod.apply(this, args),
      );
    };

    return descriptor;
  };
}
