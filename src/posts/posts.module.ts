import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { OwnershipGuard } from './guards/ownership.guard';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';

/**
 * PostsModule - Forum Post Management
 * 
 * Exports:
 * - PostsService: Provides post CRUD operations
 * - OwnershipGuard: Verifies post ownership
 * 
 * Dependencies:
 * - PrismaService (from PrismaModule - global)
 * - RedisService (from RedisModule - global)
 * 
 * Architecture:
 * - Guards: ownership.guard.ts
 * - DTOs: dto/*.dto.ts
 * - Controller: posts.controller.ts
 * - Service: posts.service.ts
 * 
 * Features Provided:
 * - Atomic post creation with tag handling
 * - SEO-friendly slug generation
 * - Redis cache-aside pattern
 * - Admin override for moderation
 * - Pagination with caching
 * - AI embedding placeholder
 */
@Module({
  imports: [MediaModule, UsersModule],
  controllers: [PostsController],
  providers: [PostsService, OwnershipGuard],
  exports: [PostsService],
})
export class PostsModule {}
