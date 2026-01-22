import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

// request dto for ai chat endpoint
export class AskAiDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

export interface AiChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * AiChatContext - Session context for multi-turn conversations
 */
export interface AiChatContext {
  sessionId: string;
  userId: number;
  history: AiChatHistoryItem[];
  createdAt: number;
  lastUpdatedAt: number;
}

/**
 * AiChatResponse - Response DTO for chat endpoint
 */
export interface AiChatResponse {
  message: string;
  sources?: Array<{
    title: string;
    slug: string;
    relevanceScore: number;
  }>;
  sessionId: string;
}

/**
 * RetrievedContext - Retrieved post with similarity score
 */
export interface RetrievedContext {
  id: number;
  title: string;
  slug: string;
  content_markdown: string;
  embedding_similarity: number;
}

/**
 * GradeResult - Grade evaluation output
 */
export interface GradeResult {
  relevant: boolean;
  reasoning: string;
}

/**
 * AiAgentState - State shared across graph nodes
 */
export interface AiAgentState {
  question: string;
  retrieved_docs: RetrievedContext[];
  generation: string;
  web_search: string;
  grade?: GradeResult;
  sources: Array<{ title: string; slug: string }>;
}
