import { Module } from '@nestjs/common';
import { GeminiService } from './services/gemini.service';
import { AiEmbeddingService } from './services/ai-embedding.service';
import { AiAgentService } from './services/ai-agent.service';
import { AiChatGateway } from './gateway/ai-chat.gateway';
import { AiController } from './ai.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RedisModule } from 'src/redis/redis.module';

/**
 * AiModule - Production-grade Agentic AI System
 * 
 * Components:
 * 1. GeminiService: Gemini API wrapper with streaming, safety, and embeddings
 * 2. AiEmbeddingService: pgvector embeddings (768 dimensions) with caching
 * 3. AiAgentService: RAG agent with retrieve/grade/generate nodes
 * 4. AiChatGateway: WebSocket server for real-time streaming chat
 * 5. AiController: REST API endpoints
 * 
 * Features:
 * - Multi-turn conversations with Redis session storage
 * - Streaming responses for real-time delivery
 * - pgvector similarity search with > 0.7 threshold
 * - Full Sentry monitoring (quotas, rate limits, latency)
 * - Error recovery with retry logic
 * - Citation links to source posts
 * 
 * Environment Variables:
 * - GEMINI_API_KEY: Google Gemini API key
 * - REDIS_HOST, REDIS_PORT: Redis configuration
 */
@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AiController],
  providers: [
    GeminiService,
    AiEmbeddingService,
    AiAgentService,
    AiChatGateway,
  ],
  exports: [GeminiService, AiEmbeddingService, AiAgentService],
})
export class AiModule {}
