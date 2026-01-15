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

  // ═══════════════════════════════════════════════════════════════════════
  // 1. COOKIE PARSER - Must be before setting cookies
  // ═══════════════════════════════════════════════════════════════════════
  app.use(cookieParser());

  // ═══════════════════════════════════════════════════════════════════════
  // 2. GLOBAL EXCEPTION FILTER - Standardize error responses
  // ═══════════════════════════════════════════════════════════════════════
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ═══════════════════════════════════════════════════════════════════════
  // 3. GLOBAL VALIDATION PIPE - Validate all incoming requests
  // ═══════════════════════════════════════════════════════════════════════
  // Security: whitelist ensures no extra fields are accepted
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

  // ═══════════════════════════════════════════════════════════════════════
  // 4. GLOBAL AUTHENTICATION GUARD - Require JWT for all routes except @Public()
  // ═══════════════════════════════════════════════════════════════════════
  // AtGuard checks @Public() decorator and bypasses if present
  // This protects all routes by default, allowing public routes via @Public()
  const reflector = app.get(Reflector);
  app.useGlobalGuards(new AtGuard(reflector));

  // ═══════════════════════════════════════════════════════════════════════
  // 5. CORS CONFIGURATION - Allow frontend to send cookies
  // ═══════════════════════════════════════════════════════════════════════
  // Critical: credentials: true allows httpOnly cookies to be sent
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true, // Allow cookies/auth headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. SECURITY HEADERS - Prevent common attacks
  // ═══════════════════════════════════════════════════════════════════════
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