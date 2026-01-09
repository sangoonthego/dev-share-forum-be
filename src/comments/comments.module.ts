import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentOwnershipGuard } from './guards/comment-ownership.guard';
import { NotificationsModule } from 'src/notifications/notifications.module';

/**
 * CommentsModule - Nested comment management for forum posts
 *
 * **Features:**
 * - Max depth limit (5 levels) for anti-abuse
 * - Atomic reaction counters (likes/dislikes)
 * - Lazy loading for large comment trees
 * - Real-time notifications via WebSockets
 * - Automatic ban handling (hide comments from banned users)
 * - Soft delete with child preservation
 * - Content sanitization (XSS prevention)
 * - Redis caching with automatic invalidation
 *
 * **Exports:**
 * - CommentsService: For comment CRUD operations
 * - CommentOwnershipGuard: For authorization verification
 *
 * **Dependencies:**
 * - PrismaService (global, auto-injected)
 * - RedisService (global, auto-injected)
 * - NotificationsModule: For real-time notifications
 *
 * **Integration Points:**
 * - CommentsService → Notifications (triggers on create)
 * - CommentsService → Comments (depth limit enforcement)
 * - Auth module → CommentsService (hideAllCommentsByUser on ban)
 */
@Module({
  imports: [NotificationsModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentOwnershipGuard],
  exports: [CommentsService, CommentOwnershipGuard],
})
export class CommentsModule {}
