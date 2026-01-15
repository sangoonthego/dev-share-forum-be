import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { EmbeddingService } from './services/embedding.service';
import { OwnershipGuard } from './guards/ownership.guard';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';

/**
 * PostsModule - Forum Post Management with AI Embeddings
 * 
 * Exports:
 * - PostsService: Provides post CRUD operations with embedding support
 * - OwnershipGuard: Verifies post ownership
 * 
 * Dependencies:
 * - PrismaService (from PrismaModule - global)
 * - RedisService (from RedisModule - global)
 * - EmbeddingService: Generates OpenAI embeddings for semantic search
 * 
 * Architecture:
 * - Guards: ownership.guard.ts
 * - DTOs: dto/*.dto.ts
 * - Services: posts.service.ts, services/embedding.service.ts
 * - Controller: posts.controller.ts
 * 
 * Features Provided:
 * - Atomic post creation with tag handling + embeddings
 * - SEO-friendly slug generation
 * - Redis cache-aside pattern with search caching
 * - Admin override for moderation
 * - Pagination with caching
 * - Real-time embeddings from OpenAI API (with fallback)
 * - Semantic search via pgvector
 * 
 * Embedding Service:
 * - Generates 1536-dimensional embeddings via text-embedding-3-small
 * - Graceful fallback to deterministic mock if API unavailable
 * - Non-blocking: post operations continue even if embedding fails
 */
@Module({
  imports: [MediaModule, UsersModule],
  controllers: [PostsController],
  providers: [PostsService, EmbeddingService, OwnershipGuard],
  exports: [PostsService],
})
export class PostsModule {}
