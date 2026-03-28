import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import * as Sentry from '@sentry/nestjs';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { AtGuard } from './common/guards/at.guard';

async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      integrations: [
        Sentry.captureConsoleIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      environment: process.env.NODE_ENV,
    });
  }

  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  app.use(cookieParser());

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      stopAtFirstError: false,
    }),
  );

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new AtGuard(reflector));

  app.enableCors({
    origin: process.env.FRONTEND_URL || ['http://localhost:8000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-CSRF-Token', 'X-Trace-ID'],
  });

  app.use((req, res, next) => {
    // Security headers
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
    res.removeHeader('Server');
    next();
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.log(`DevShare Lite API`);
  logger.log(`http://localhost:${port}`);
  logger.log(`Security: Enabled (CORS, CSRF, Headers, Rate Limiting)`);
  logger.log(`Auth: JWT + Family Rotation + Redis Blacklist`);
  logger.log(`Storage: Redis (RT + Tokens) + PostgreSQL (Users)`);
  logger.log(`Tracing: Sentry (${process.env.SENTRY_DSN ? 'Enabled' : 'Disabled'})`);
  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

bootstrap();
