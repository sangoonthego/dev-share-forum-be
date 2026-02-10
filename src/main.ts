import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { AtGuard } from './common/guards/at.guard';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  app.use(cookieParser());

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remove unvalidated properties
      forbidNonWhitelisted: true, // Throw error if extra fields
      transform: true, // Auto convert types (string -> number)
      transformOptions: {
        enableImplicitConversion: true,
      },
      stopAtFirstError: false, // Return all validation errors
    }),
  );

  const reflector = app.get(Reflector);
  app.useGlobalGuards(new AtGuard(reflector));

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true, // Allow cookies/auth headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  app.use((req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Enable XSS protection in older browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Content Security Policy (basic)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );

    // Remove Server header to prevent fingerprinting
    res.removeHeader('Server');

    next();
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.log(`DevShare Lite API`);
  logger.log(`http://localhost:${port}`);
  logger.log(`Security: Enabled (CORS, CSRF, Headers)`);
  logger.log(`Auth: JWT + Redis Blacklist + Global AtGuard`);
  logger.log(`Storage: Redis (RT) + PostgreSQL (User Data)`);
  logger.log(`Posts: Atomic Creation, Caching, Ownership Verification`);
  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

bootstrap();