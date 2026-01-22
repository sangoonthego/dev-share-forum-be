import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Delete,
  Param,
} from '@nestjs/common';
import { AtGuard } from 'src/common/guards/at.guard';
import { AiAgentService } from './services/ai-agent.service';
import { AskAiDto, AiChatResponse } from './dto/ask-ai.dto';
import { User } from 'src/common/decorators/user.decorator';
import * as Sentry from '@sentry/nestjs';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * AiController - REST API endpoints for AI features
 * 
 * Endpoints:
 * POST /ai/chat - Ask AI question (RAG chatbot)
 * GET /ai/chat/:sessionId - Get chat session history
 * DELETE /ai/chat/:sessionId - Clear chat session
 */
@Controller('ai')
@UseGuards(AtGuard)
export class AiController {
  constructor(private readonly aiAgentService: AiAgentService) {}

  /**
   * POST /ai/chat
   * Ask AI question with optional session context
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async askAi(
    @Body() dto: AskAiDto,
    @User() user: JwtPayload,
  ): Promise<AiChatResponse> {
    try {
      const { message, sessionId } = dto;

      const { response, sources, sessionId: finalSessionId } =
        await this.aiAgentService.executeAgent(
          message,
          user.sub,
          sessionId,
        );

      Sentry.captureMessage('AI chat request completed', 'info');

      return {
        message: response,
        sources: sources.map((s) => ({
          title: s.title,
          slug: s.slug,
          relevanceScore: 0.85,
        })),
        sessionId: finalSessionId,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: {
          endpoint: 'ask_ai',
          userId: user.sub,
        },
      });
      throw error;
    }
  }

  /**
   * GET /ai/chat/:sessionId
   * Retrieve chat session history
   */
  @Get('chat/:sessionId')
  @HttpCode(HttpStatus.OK)
  async getChatSession(
    @Param('sessionId') sessionId: string,
    @User() user: JwtPayload,
  ) {
    try {
      const context = await this.aiAgentService.getChatContext(
        user.sub,
        sessionId,
      );

      return {
        sessionId: context.sessionId,
        createdAt: new Date(context.createdAt),
        lastUpdatedAt: new Date(context.lastUpdatedAt),
        history: context.history,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: {
          endpoint: 'get_chat_session',
          sessionId,
        },
      });
      throw error;
    }
  }

  /**
   * DELETE /ai/chat/:sessionId
   * Clear chat session
   */
  @Delete('chat/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearChatSession(
    @Param('sessionId') sessionId: string,
    @User() user: JwtPayload,
  ): Promise<void> {
    try {
      await this.aiAgentService.clearSession(user.sub, sessionId);
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: {
          endpoint: 'clear_chat_session',
          sessionId,
        },
      });
      throw error;
    }
  }
}
