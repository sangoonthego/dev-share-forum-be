# 📡 API Controller Integration Examples

This document shows how to integrate the new background jobs, logging, and caching into your existing controllers.

## 1. Posts Controller - Async Email & Embeddings

```typescript
// src/posts/posts.controller.ts

import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PostsService } from './posts.service';
import { QueueService } from 'src/queues/queue.service';
import { LoggerService } from 'src/common/logger/logger.service';
import { AtGuard } from 'src/common/guards/at.guard';
import { User } from 'src/common/decorators/user.decorator';
import { CreatePostDto } from './dto/create-post.dto';
import { LoggingInterceptor } from 'src/common/logger/logging.interceptor';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

@Controller('posts')
@UseInterceptors(LoggingInterceptor) // NEW: Automatic request/response logging
export class PostsController {
  constructor(
    private postsService: PostsService,
    private queueService: QueueService,
    private logger: LoggerService,
  ) {}

  @Post()
  @UseGuards(AtGuard)
  async createPost(@User() user: JwtPayload, @Body() dto: CreatePostDto) {
    // Create post
    const post = await this.postsService.createPost(user.sub, dto);

    // NEW: Queue email notification asynchronously
    try {
      await this.queueService.queueEmail({
        userId: user.sub,
        email: user.email,
        subject: 'Your post has been published!',
        template: 'post-created',
        variables: {
          postTitle: post.title,
          postUrl: `https://devshare.com/posts/${post.slug}`,
        },
      });
      this.logger.log('Post created email queued', 'POSTS_CONTROLLER');
    } catch (error) {
      // Non-critical - email queuing failed but post was created
      this.logger.warn(
        'Failed to queue post created email',
        'POSTS_CONTROLLER',
      );
    }

    return post;
  }

  @Get(':slug')
  async getPostBySlug(@Param('slug') slug: string) {
    // NEW: Uses cache with stampede protection
    // Returns instantly from cache on hit
    // On miss, fetches from DB with lock to prevent stampede
    const startTime = Date.now();
    const post = await this.postsService.getPostBySlug(slug);
    const duration = Date.now() - startTime;

    // NEW: Log performance metrics
    this.logger.logPerformance('getPostBySlug', duration, 'POSTS');

    // NEW: Queue view count asynchronously (non-blocking)
    this.queueService.queueViewCountIncrement(slug).catch(() => {
      // View count is non-critical, don't log error
    });

    return post;
  }

  @Post(':id/search')
  async searchPosts(
    @Body('query') query: string,
    @Query('threshold') threshold: number = 1.0, // NEW: similarity threshold
  ) {
    try {
      // NEW: Search with similarity threshold
      // Returns only results with distance < threshold
      const results = await this.postsService.searchPosts(
        query,
        undefined, // userRole
        undefined, // userId
        5, // limit
        threshold, // NEW: filter low-relevance results
      );

      this.logger.log(
        `Search completed: "${query}" found ${results.length} results`,
        'POSTS',
        { threshold },
      );

      return results;
    } catch (error) {
      this.logger.error('Search failed', error, 'POSTS');
      throw error;
    }
  }
}
```

## 2. Auth Controller - Token Rotation with Reuse Detection

```typescript
// src/auth/auth.controller.ts (refresh endpoint)

@Post('refresh')
@UseGuards(RtGuard)
@HttpCode(HttpStatus.OK)
@UseInterceptors(LoggingInterceptor)
async refreshTokens(
  @User() user: JwtPayload,
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
) {
  try {
    // Extract RT from cookie (or authorization header)
    const refreshToken = req.cookies.refresh_token;

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    // Decode RT to get family
    const decoded = await this.jwtService.verify(refreshToken, {
      secret: process.env.JWT_RT_SECRET,
    });

    // NEW: Verify with reuse detection
    // Returns: { valid, shouldRotate, reuseDetected }
    const verification = await this.tokenService.verifyRefreshToken(
      decoded.sub,
      refreshToken,
      decoded.family, // NEW: token family for rotation tracking
    );

    // NEW: Detect token reuse (security breach)
    if (verification.reuseDetected) {
      // Immediately revoke all sessions
      await this.tokenService.revokeAllTokens(decoded.sub);

      // Log security event
      this.logger.logSecurityEvent(
        'Token reuse detected - all sessions revoked',
        decoded.sub,
        {
          family: decoded.family,
          ip: req.ip,
          userAgent: req.get('user-agent'),
        },
      );

      throw new UnauthorizedException(
        'Token reuse detected. Please log in again.',
      );
    }

    if (!verification.valid) {
      this.logger.logSecurityEvent(
        'Invalid refresh token attempt',
        decoded.sub,
      );
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // NEW: Generate new tokens with rotation
    // Automatically generates NEW family ID
    const newTokens = await this.tokenService.getTokens(
      decoded.sub,
      decoded.email,
      decoded.role,
      decoded.version,
      // NO family parameter = auto-generates new family
    );

    // NEW: Invalidate old RT immediately
    await this.tokenService.invalidateRefreshToken(decoded.sub, decoded.family);

    // Log successful refresh
    this.logger.log(
      `Token refreshed for user ${decoded.sub}`,
      'AUTH',
      { new_family: newTokens.family },
    );

    // Set new RT cookie
    res.cookie('refresh_token', newTokens.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    return { access_token: newTokens.access_token };
  } catch (error) {
    if (error instanceof UnauthorizedException) {
      throw error;
    }

    this.logger.error('Token refresh failed', error, 'AUTH');
    throw new UnauthorizedException('Token refresh failed');
  }
}
```

## 3. Cache Invalidation - Replace SCAN with Tags

```typescript
// OLD: Using SCAN pattern matching (DEPRECATED)
// ❌ DON'T USE THIS ANYMORE
async deletePost(postId: number) {
  await this.prisma.posts.update({
    where: { id: postId },
    data: { deleted_at: new Date() },
  });

  // OLD: Pattern invalidation
  await this.redis.delByPattern('posts:list:*'); // O(n) scan
}

// NEW: Using tagged invalidation (RECOMMENDED)
// ✅ USE THIS INSTEAD
async deletePost(postId: number) {
  // Soft delete post
  const post = await this.prisma.posts.update({
    where: { id: postId },
    data: { deleted_at: new Date() },
  });

  // NEW: Invalidate by tags
  await this.redis.invalidateByTag('posts'); // O(1) set deletion
  await this.redis.invalidateByTag(`post:${postId}`); // Delete specific post
  await this.redis.invalidateByTag(`author:${post.author_id}`); // Delete author posts

  this.logger.log(
    `Post ${postId} deleted and caches invalidated`,
    'POSTS',
  );
}
```

## 4. Comments Controller - Logging & Async Notifications

```typescript
// src/comments/comments.controller.ts

@Controller('posts/:postId/comments')
@UseInterceptors(LoggingInterceptor)
export class CommentsController {
  constructor(
    private commentsService: CommentsService,
    private queueService: QueueService,
    private logger: LoggerService,
  ) {}

  @Post()
  @UseGuards(AtGuard)
  async createComment(
    @Param('postId') postId: number,
    @User() user: JwtPayload,
    @Body() dto: CreateCommentDto,
  ) {
    try {
      // Create comment
      const comment = await this.commentsService.create(postId, user.sub, dto);

      // NEW: Queue notification emails asynchronously
      try {
        // Notify post author
        const post = await this.prisma.posts.findUnique({
          where: { id: postId },
          include: { author: true },
        });

        if (post && post.author_id !== user.sub) {
          await this.queueService.queueEmail({
            userId: post.author_id,
            email: post.author.email,
            subject: `New comment on "${post.title}"`,
            template: 'comment-notification',
            variables: {
              commentAuthor: user.email,
              commentText: dto.content,
              postTitle: post.title,
            },
          });
        }
      } catch (error) {
        // Non-critical - continue even if notification fails
        this.logger.warn('Failed to queue comment notification', 'COMMENTS');
      }

      // Invalidate comment cache
      await this.redis.invalidateByTag(`post:${postId}:comments`);

      return comment;
    } catch (error) {
      this.logger.error('Failed to create comment', error, 'COMMENTS');
      throw error;
    }
  }
}
```

## 5. Admin Panel - Queue Monitoring

```typescript
// src/admin/admin.controller.ts (NEW)

@Controller('admin')
@UseGuards(AtGuard, AdminGuard)
@UseInterceptors(LoggingInterceptor)
export class AdminController {
  constructor(
    private queueService: QueueService,
    private logger: LoggerService,
  ) {}

  @Get('queues/status')
  async getQueueStatus() {
    try {
      const stats = await this.queueService.getQueueStats();

      this.logger.log('Queue status retrieved', 'ADMIN');

      return {
        timestamp: new Date().toISOString(),
        queues: stats,
      };
    } catch (error) {
      this.logger.error('Failed to get queue status', error, 'ADMIN');
      throw error;
    }
  }

  @Get('queues/:queueName/jobs/:jobId')
  async getJobDetails(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
  ) {
    try {
      const job = await this.queueService.getJobStatus(queueName, jobId);

      if (!job) {
        throw new NotFoundException(`Job not found`);
      }

      this.logger.log(`Job details retrieved: ${jobId}`, 'ADMIN', job);

      return job;
    } catch (error) {
      this.logger.error('Failed to get job details', error, 'ADMIN');
      throw error;
    }
  }

  @Post('queues/:queueName/clear')
  async clearQueue(@Param('queueName') queueName: string) {
    try {
      await this.queueService.clearQueue(queueName);

      this.logger.logSecurityEvent(`Queue cleared: ${queueName}`, undefined, {
        queueName,
      });

      return { message: `Queue "${queueName}" cleared` };
    } catch (error) {
      this.logger.error('Failed to clear queue', error, 'ADMIN');
      throw error;
    }
  }
}
```

## 6. Global Error Handling with Logging

```typescript
// src/common/filters/global-exception.filter.ts

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = 500;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.getResponse();
    }

    // NEW: Log all errors with context
    this.logger.error(
      `HTTP ${status} - ${request.method} ${request.url}`,
      exception,
      'GLOBAL_EXCEPTION',
    );

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

// src/main.ts
app.useGlobalFilters(new GlobalExceptionFilter(loggerService));
```

---

**Summary**: These examples show how to integrate:

- ✅ Async job queueing (emails, embeddings, view counts)
- ✅ Structured logging (requests, errors, security events)
- ✅ Token rotation with reuse detection
- ✅ Cache management with tags
- ✅ Performance monitoring

See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for full details.
