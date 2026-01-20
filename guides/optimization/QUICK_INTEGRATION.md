# 🔧 QUICK INTEGRATION REFERENCE

## 1️⃣ Install Dependencies

```bash
npm install @nestjs/bull bull @sentry/nestjs @sentry/tracing winston
```

## 2️⃣ Update App Module

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { QueueModule } from './queues/queue.module';
import { LoggerModule } from './common/logger/logger.module';

@Module({
  imports: [
    // ... existing imports
    QueueModule, // Add this
    LoggerModule, // Add this
  ],
})
export class AppModule {}
```

## 3️⃣ Update Environment

```env
# .env
LOG_LEVEL=info
SENTRY_DSN=https://your-key@sentry.io/project-id
SENTRY_TRACE_RATE=0.1
```

## 4️⃣ Update Auth Refresh Endpoint

```typescript
// src/auth/auth.controller.ts - refresh endpoint

@UseGuards(RtGuard)
@Post('refresh')
@HttpCode(HttpStatus.OK)
async refreshTokens(
  @User() user: JwtPayload,
  @Res({ passthrough: true }) res: Response,
) {
  // NEW: Use token family for rotation
  const decoded = await this.jwtService.verify(refreshToken, {
    secret: process.env.JWT_RT_SECRET,
  });

  // NEW: Verify with reuse detection
  const verification = await this.tokenService.verifyRefreshToken(
    decoded.sub,
    refreshToken,
    decoded.family, // NEW parameter
  );

  if (verification.reuseDetected) {
    // Security breach detected
    await this.tokenService.revokeAllTokens(decoded.sub);
    throw new UnauthorizedException('Token reuse detected - please re-login');
  }

  if (!verification.valid) {
    throw new UnauthorizedException('Invalid refresh token');
  }

  // NEW: Generate new tokens (with new family)
  const newTokens = await this.tokenService.getTokens(
    decoded.sub,
    decoded.email,
    decoded.role,
    decoded.version,
    // No family param = generates new one
  );

  // NEW: Invalidate old token
  await this.tokenService.invalidateRefreshToken(decoded.sub, decoded.family);

  // Set new refresh token cookie
  res.cookie('refresh_token', newTokens.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  return { access_token: newTokens.access_token };
}
```

## 5️⃣ Use Queue in Services

```typescript
// Example: PostsService

import { QueueService } from 'src/queues/queue.service';
import { LoggerService } from 'src/common/logger/logger.service';

@Injectable()
export class PostsService {
  constructor(
    private queueService: QueueService,
    private logger: LoggerService,
  ) {}

  async createPost(userId: number, dto: CreatePostDto) {
    // ... create post

    // NEW: Queue email notification (async)
    try {
      await this.queueService.queueEmail({
        userId: post.author_id,
        email: author.email,
        subject: 'Your post was published',
        template: 'post-published',
        variables: { postTitle: post.title },
      });
    } catch (error) {
      this.logger.error('Failed to queue email', error);
    }

    // NEW: Queue embedding generation (async)
    try {
      await this.queueService.queueEmbedding({
        postId: post.id,
        title: post.title,
        content: post.content_markdown,
      });
    } catch (error) {
      this.logger.error('Failed to queue embedding', error);
    }

    return post;
  }

  async getPostBySlug(slug: string) {
    // NEW: Cache with stampede protection
    const post = await this.redis.getWithStampedeProtection(
      `post:${slug}`,
      async () => {
        return await this.prisma.posts.findUnique({ where: { slug } });
      },
      3600, // 1 hour cache
    );

    // NEW: Queue view count (async)
    this.queueService.queueViewCountIncrement(slug).catch((err) => {
      this.logger.debug('Failed to queue view count', 'POSTS');
    });

    return post;
  }

  async searchPosts(query: string, userRole?: string) {
    // NEW: Search with similarity threshold
    return await this.postsService.searchPosts(
      query,
      userRole,
      undefined,
      5,
      1.0, // Similarity threshold
    );
  }

  async deletePost(postId: number) {
    // ... delete post

    // NEW: Invalidate by tag instead of pattern
    await this.redis.invalidateByTag('posts'); // Deletes all posts-related cache
  }
}
```

## 6️⃣ Run Database Migration

```bash
# Apply HNSW index and composite indices
npx prisma migrate deploy

# Or create a new migration if needed
npx prisma migrate dev --name add_performance_indices
```

## 7️⃣ Testing Queue Processors

```typescript
// test/queues/email.processor.spec.ts

import { Test } from '@nestjs/testing';
import { EmailProcessor } from 'src/queues/processors/email.processor';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [EmailProcessor, LoggerService],
    }).compile();

    processor = module.get<EmailProcessor>(EmailProcessor);
  });

  it('should process email job', async () => {
    const mockJob = {
      data: {
        userId: 1,
        email: 'test@example.com',
        subject: 'Test',
        template: 'test',
      },
    };

    const result = await processor.handleEmailJob(mockJob as any);
    expect(result.success).toBe(true);
  });
});
```

## 8️⃣ Monitor Queues

```typescript
// src/admin/admin.controller.ts (optional)

@Controller('admin')
export class AdminController {
  constructor(private queueService: QueueService) {}

  @Get('queue-status')
  async getQueueStatus() {
    return await this.queueService.getQueueStats();
  }

  @Get('job/:id')
  async getJobStatus(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    return await this.queueService.getJobStatus(queueName, jobId);
  }
}
```

## 🚨 Common Issues & Fixes

### Issue: "Bull not registered"

```typescript
// Make sure BullModule is imported in QueueModule
@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'email', ... },
      { name: 'embedding', ... },
      { name: 'viewCount', ... },
    ),
  ],
})
```

### Issue: "Redis connection failed"

```bash
# Check Redis is running
redis-cli ping
# Should return: PONG

# Or check connection string
echo $REDIS_HOST $REDIS_PORT
```

### Issue: "Logger not injecting"

```typescript
// Make sure LoggerModule is in imports
// and LoggerService is in providers/exports
@Module({
  providers: [LoggerService, LoggingInterceptor],
  exports: [LoggerService, LoggingInterceptor],
})
export class LoggerModule {}
```

### Issue: "HNSW index not created"

```bash
# Check if pgvector extension is installed
psql -U postgres -d your_db -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Install if missing
psql -U postgres -d your_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## ✅ Verification Checklist

- [ ] Dependencies installed: `npm list @nestjs/bull bull winston`
- [ ] Environment variables set: `.env` has SENTRY_DSN and LOG_LEVEL
- [ ] App module updated: imports QueueModule and LoggerModule
- [ ] Auth controller updated: uses new token rotation logic
- [ ] Database migration applied: `npx prisma migrate deploy`
- [ ] Queue processors working: check logs/combined.log
- [ ] Vector search threshold added: `searchPosts(..., 1.0)`
- [ ] Cache tags working: `redis.invalidateByTag('posts')`
- [ ] Sentry capturing: test with intentional error
- [ ] Performance improved: compare query times

---

**Next**: Read [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for detailed information.
