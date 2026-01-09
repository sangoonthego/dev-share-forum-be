import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentOwnershipGuard } from './guards/comment-ownership.guard';

/**
 * CommentsModule - Nested comment management for forum posts
 * 
 * Exports:
 * - CommentsService: Provides comment CRUD operations with caching
 * - CommentOwnershipGuard: Verifies comment ownership for moderation
 * 
 * Dependencies (Global Modules):
 * - PrismaService (from PrismaModule - auto-injected)
 * - RedisService (from RedisModule - auto-injected)
 * 
 * Architecture:
 * - Controllers: comments.controller.ts
 * - Services: comments.service.ts
 * - Guards: guards/comment-ownership.guard.ts
 * - DTOs: dto/*.dto.ts
 * - Utilities: utils/comment-tree.utility.ts
 * 
 * Features Provided:
 * - Atomic comment creation with parent validation
 * - Recursive comment tree retrieval (single query, O(n) transformation)
 * - Redis cache-aside pattern (key: comments:post:{postId})
 * - Content sanitization using isomorphic-dompurify
 * - Rate limiting: 5 comments per 5 minutes per user
 * - Soft delete: deleted comments show placeholder, children preserved
 * - Advanced authorization:
 *   - UPDATE: Only author or admin
 *   - DELETE: Author, post author, or admin
 * 
 * Integration Points:
 * - Extends posts module with comments
 * - Uses existing Redis service for caching
 * - Uses existing Prisma service for database operations
 * - Integrates with auth guards and decorators
 */
@Module({
  controllers: [CommentsController],
  providers: [CommentsService, CommentOwnershipGuard],
  exports: [CommentsService, CommentOwnershipGuard],
})
export class CommentsModule {}
