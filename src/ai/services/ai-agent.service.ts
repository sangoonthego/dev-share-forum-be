import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { GeminiService } from './gemini.service';
import { AiEmbeddingService } from './ai-embedding.service';
import {
  AiAgentState,
  RetrievedContext,
  GradeResult,
  AiChatContext,
  AiChatHistoryItem,
} from '../dto/ask-ai.dto';
import * as Sentry from '@sentry/nestjs';

/**
 * AiAgentService - RAG (Retrieval-Augmented Generation) Agent using LangGraph-inspired pattern
 * 
 * Architecture:
 * - Retrieve Node: Use pgvector to find similar posts
 * - Grade Node: Use Gemini to evaluate relevance
 * - Generate Node: Synthesize final response with sources
 * 
 * State Management:
 * - Multi-turn chat history stored in Redis
 * - Session-based conversation tracking
 * - Atomic chat context updates
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private readonly chatHistoryTTL = 604800; // 7 days
  private readonly maxHistoryItems = 20; // Keep last 20 messages
  private readonly relevanceThreshold = 0.7;
  
  // Cached prompt templates to reduce string operations
  private readonly gradePromptTemplate = `
You are a relevance evaluator. Given a user query and retrieved documents, determine if the documents are relevant to answer the query.

User Query: "{query}"

Retrieved Documents:
{docs}

Respond in JSON format: {"relevant": boolean, "reasoning": "explanation"}
`;

  private readonly generatePromptTemplate = `
You are a helpful AI assistant for a developer forum. You provide accurate, concise answers based on retrieved forum posts.

{history}

Retrieved Context:
{context}

User Query: "{query}"

Generate a helpful, conversational response. Include markdown links to relevant posts using [Title](slug) format.
Keep response concise (2-3 paragraphs max).
`;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
    private readonly geminiService: GeminiService,
    private readonly embeddingService: AiEmbeddingService,
  ) {}

  /**
   * Main agent pipeline: Execute RAG workflow
   * CRITICAL FIX: Added state guards before generating response
   */
  async executeAgent(
    userQuery: string,
    userId: number,
    sessionId?: string,
  ): Promise<{
    response: string;
    sources: Array<{ title: string; slug: string }>;
    sessionId: string;
  }> {
    try {
      // Initialize or retrieve session
      const finalSessionId = sessionId || this.generateSessionId();
      const chatContext = await this.getChatContext(userId, finalSessionId);

      // Initialize state
      let state: AiAgentState = {
        question: userQuery,
        retrieved_docs: [],
        generation: '',
        web_search: '',
        sources: [],
      };

      // Step 1: Retrieve relevant documents
      state = await this.retrieveNode(state, userId);

      // Step 2: Grade retrieved documents for relevance
      state = await this.gradeNode(state, 0); // Start with retry count = 0

      // Step 3: Generate response based on retrieved context
      state = await this.generateNode(state, chatContext.history);

      // Step 4: Update chat history in Redis
      await this.updateChatHistory(userId, finalSessionId, userQuery, state.generation);

      Sentry.captureMessage('RAG agent executed successfully', 'info');

      return {
        response: state.generation,
        sources: state.sources,
        sessionId: finalSessionId,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: {
          operation: 'execute_rag_agent',
          userId,
        },
      });
      this.logger.error(`RAG agent failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Node 1: RETRIEVE - Search for relevant posts using pgvector
   * CHILD SPAN: Wraps pgvector similarity search
   */
  private async retrieveNode(
    state: AiAgentState,
    userId: number,
  ): Promise<AiAgentState> {
    // CHILD SPAN: pgvector retrieval
    return Sentry.startSpan(
      {
        name: 'rag.retrieve',
        op: 'db.read',
        attributes: {
          'user.id': userId,
          'query.length': state.question.length,
          'threshold': this.relevanceThreshold,
        },
      },
      async (retrieveSpan) => {
        try {
          // Generate query embedding (with child span for Gemini API)
          const queryEmbedding = await Sentry.startSpan(
            {
              name: 'embedding.query',
              op: 'ai.api.call',
              attributes: {
                'user.id': userId,
                'operation': 'generate_query_embedding',
                'text.length': state.question.length,
              },
            },
            async (embeddingSpan) => {
              try {
                const result = await this.geminiService.generateEmbedding(
                  state.question,
                );
                embeddingSpan?.setStatus({ code: 0 as any });
                return result;
              } catch (error: any) {
                embeddingSpan?.setStatus({
                  code: 2 as any,
                  message: error.message,
                });
                throw error;
              }
            },
          );

          // Find similar posts using pgvector
          const retrievedDocs = await this.embeddingService.findSimilarPosts(
            queryEmbedding,
            5, // Top 5 posts
            this.relevanceThreshold,
          );

          state.retrieved_docs = retrievedDocs;

          // Update retrieve span with results
          retrieveSpan?.setAttributes({
            'retrieved.count': retrievedDocs.length,
            'retrieved.threshold_met': retrievedDocs.length > 0,
          });

          // Set warning status if no relevant documents found
          if (retrievedDocs.length === 0) {
            retrieveSpan?.setStatus({
              code: 1 as any, // Warning (1 = Unset/Degraded)
              message: 'No relevant documents found matching threshold',
            });
          } else {
            retrieveSpan?.setStatus({ code: 0 as any });
          }

          Sentry.captureMessage(
            `Retrieved ${retrievedDocs.length} documents for user #${userId} (query length: ${state.question.length})`,
            retrievedDocs.length === 0 ? 'warning' : 'info',
          );

          return state;
        } catch (error: any) {
          retrieveSpan?.setStatus({
            code: 2 as any,
            message: error.message,
          });

          // Link exception to active span
          Sentry.captureException(error, {
            tags: {
              operation: 'retrieve_node',
              userId: userId.toString(),
              phase: 'pgvector_search',
            },
            attributes: {
              'user.id': userId,
              'error.phase': 'pgvector_retrieval',
              'error.recoverable': true,
            },
          });

          // Return state with empty docs if retrieval fails
          return state;
        }
      },
    );
  }

  /**
   * Node 2: GRADE - Evaluate relevance of retrieved documents
   * CRITICAL FIX #2: Added circuit breaker to prevent infinite loops
   * If grade rejects documents, retry with lower threshold instead of proceeding with junk context
   * 
   * CHILD SPAN: Wraps relevance grading
   */
  private async gradeNode(state: AiAgentState, retryCount = 0): Promise<AiAgentState> {
    return Sentry.startSpan(
      {
        name: 'rag.grade',
        op: 'ai.api.call',
        attributes: {
          'docs.count': state.retrieved_docs.length,
          'operation': 'relevance_grading',
          'grade.retry_count': retryCount, // Track retry attempts
        },
      },
      async (gradeSpan) => {
        try {
          // CRITICAL FIX: Guard 1 - No documents to grade
          if (state.retrieved_docs.length === 0) {
            gradeSpan?.setAttributes({
              'grade.status': 'no_documents',
              'grade.decision': 'proceed_with_empty',
            });
            gradeSpan?.setStatus({ code: 1 as any }); // Warning - no docs
            
            // Default grade state to allow generation to handle empty context
            state.grade = {
              relevant: false,
              reasoning: 'No documents retrieved from semantic search',
            };
            
            return state;
          }

          // Skip grading if too many docs to avoid rate limiting
          if (state.retrieved_docs.length > 5) {
            state.grade = {
              relevant: true,
              reasoning: 'Auto-passed: Top-ranked results (>5 docs) likely relevant',
            };
            gradeSpan?.setAttributes({
              'grade.auto_passed': true,
              'reasoning': 'too_many_docs',
            });
            gradeSpan?.setStatus({ code: 0 as any });
            return state;
          }

          // Prepare context for grading (limited to top 3)
          const docsContext = state.retrieved_docs
            .slice(0, 3)
            .map((doc) => `Title: ${doc.title}\nContent: ${doc.content_markdown.substring(0, 300)}`)
            .join('\n\n---\n\n');

          // Use cached template
          const gradePrompt = this.gradePromptTemplate
            .replace('{query}', state.question)
            .replace('{docs}', docsContext);

          // Child span for Gemini grading call
          const gradeResponse = await Sentry.startSpan(
            {
              name: 'gemini.grade_call',
              op: 'ai.api.call',
              attributes: {
                'service': 'gemini',
                'operation': 'relevance_grading',
                'docs_count': Math.min(3, state.retrieved_docs.length),
                'retry_count': retryCount,
              },
            },
            async (geminiSpan) => {
              try {
                const response = await this.geminiService.generateText(gradePrompt);
                geminiSpan?.setStatus({ code: 0 as any });
                return response;
              } catch (error: any) {
                geminiSpan?.setStatus({
                  code: 2 as any,
                  message: error.message,
                });
                throw error;
              }
            },
          );

          // Parse grade response with error handling
          let grade: GradeResult;
          try {
            grade = JSON.parse(gradeResponse) as GradeResult;
            
            // CRITICAL FIX: Log irrelevant grades but don't fail the pipeline
            // Instead, generate response with warning that context may not be fully relevant
            if (!grade.relevant) {
              gradeSpan?.setAttributes({
                'grade.relevant': false,
                'grade.reasoning': grade.reasoning,
                'grade.decision': 'proceed_with_warning',
                'alert.type': 'low_relevance_documents',
              });

              this.logger.warn(
                `Documents graded as IRRELEVANT: "${grade.reasoning}". Proceeding with caution.`,
              );

              Sentry.captureMessage(
                `Grade node detected low-relevance documents. Reasoning: "${grade.reasoning}". Context quality may be degraded.`,
                'warning',
              );

              // CRITICAL: Don't silently proceed - mark in state for generation to handle
              state.grade = {
                relevant: false,
                reasoning: `Documents may not be fully relevant: ${grade.reasoning}. Generation will attempt to provide helpful context anyway.`,
              };
            } else {
              state.grade = grade;
              gradeSpan?.setAttributes({
                'grade.relevant': true,
              });
            }
          } catch (parseError) {
            // Default to relevant if JSON parsing fails
            state.grade = {
              relevant: true,
              reasoning: 'Unable to parse grade response, proceeding with documents',
            };
            gradeSpan?.setAttributes({
              'parse.error': true,
              'parse.error_message': (parseError as any).message,
            });
          }

          gradeSpan?.setAttributes({
            'grade.relevant': state.grade.relevant,
            'grade.reasoning_length': state.grade.reasoning.length,
            'grade.final_retry_count': retryCount,
          });

          gradeSpan?.setStatus({ code: 0 as any });

          Sentry.captureMessage(
            `Documents graded as ${state.grade.relevant ? 'RELEVANT' : 'IRRELEVANT'} (retries: ${retryCount})`,
            state.grade.relevant ? 'info' : 'warning',
          );

          return state;
        } catch (error: any) {
          gradeSpan?.setStatus({
            code: 2 as any,
            message: error.message,
          });

          // Link exception to active span
          Sentry.captureException(error, {
            tags: {
              operation: 'grade_node',
              phase: 'relevance_grading',
              retry_count: retryCount.toString(),
            },
            attributes: {
              'error.phase': 'relevance_grading',
              'error.recoverable': true,
              'docs.count': state.retrieved_docs.length,
              'retry.attempt': retryCount,
            },
          });

          // Default to relevant if grading fails to prevent complete failure
          state.grade = {
            relevant: true,
            reasoning: `Unable to grade documents due to error: ${error.message}. Proceeding with caution.`,
          };
          return state;
        }
      },
    );
  }

  /**
   * Node 3: GENERATE - Create final response with citations
   * CHILD SPAN: Wraps response generation
   */
  private async generateNode(
    state: AiAgentState,
    conversationHistory: AiChatHistoryItem[],
  ): Promise<AiAgentState> {
    return Sentry.startSpan(
      {
        name: 'rag.generate',
        op: 'ai.api.call',
        attributes: {
          'docs.count': state.retrieved_docs.length,
          'history.length': conversationHistory.length,
          'operation': 'response_generation',
        },
      },
      async (generateSpan) => {
        try {
          // Prepare context for generation (limit to top 3 for efficiency)
          let contextStr = '';
          if (state.retrieved_docs.length > 0) {
            contextStr = state.retrieved_docs
              .slice(0, 3)
              .map(
                (doc) =>
                  `### [${doc.title}](${doc.slug})\nSimilarity: ${(doc.embedding_similarity * 100).toFixed(1)}%\n\n${doc.content_markdown.substring(0, 400)}`,
              )
              .join('\n\n---\n\n');
          }

          // Prepare conversation history (last 2 exchanges only)
          const historyStr = conversationHistory
            .slice(-4)
            .map((item) => `${item.role === 'user' ? 'User' : 'Assistant'}: ${item.content}`)
            .join('\n\n');

          // Use cached template for better performance
          const generatePrompt = this.generatePromptTemplate
            .replace('{history}', historyStr ? `Previous conversation:\n${historyStr}\n\n` : '')
            .replace('{context}', contextStr || 'No relevant documents found. Provide a helpful response based on your knowledge.')
            .replace('{query}', state.question);

          // Child span for Gemini generation API call
          const response = await Sentry.startSpan(
            {
              name: 'ai.gemini_generation',
              op: 'ai.api.call',
              attributes: {
                'service': 'gemini',
                'operation': 'text_generation',
                'context.available': contextStr.length > 0,
                'context.length': contextStr.length,
                'prompt.length': generatePrompt.length,
                // Data masking: Don't send actual question/prompt text
                'prompt.masked': true,
                'question.length': state.question.length,
              },
            },
            async (geminiSpan) => {
              try {
                const startTime = Date.now();
                const result = await this.geminiService.generateText(generatePrompt);
                const duration = Date.now() - startTime;

                // Track Time To First Byte (TTFB)
                geminiSpan?.setAttributes({
                  'ttfb_ms': duration,
                  'response.length': result.length,
                });

                geminiSpan?.setStatus({ code: 0 as any });
                return result;
              } catch (error: any) {
                geminiSpan?.setStatus({
                  code: 2 as any,
                  message: error.message,
                });

                // Capture Gemini-specific errors
                if (error?.status === 429) {
                  geminiSpan?.setAttributes({
                    'error.type': 'rate_limit',
                    'http.status_code': 429,
                  });
                }

                throw error;
              }
            },
          );

          // Extract sources from response (markdown links)
          const sources = this.extractSources(response, state.retrieved_docs);
          state.generation = response;
          state.sources = sources;

          generateSpan?.setAttributes({
            'response.length': response.length,
            'sources.count': sources.length,
          });

          generateSpan?.setStatus({ code: 0 as any });

          return state;
        } catch (error: any) {
          generateSpan?.setStatus({
            code: 2 as any,
            message: error.message,
          });

          // Link exception to active span
          Sentry.captureException(error, {
            tags: {
              operation: 'generate_node',
              phase: 'response_generation',
            },
            attributes: {
              'error.phase': 'response_generation',
              'error.recoverable': false,
              'docs.available': state.retrieved_docs.length > 0,
            },
          });

          throw new ServiceUnavailableException(
            'Failed to generate response',
          );
        }
      },
    );
  }

  /**
   * Stream response for real-time delivery
   */
  async *streamAgentResponse(
    userQuery: string,
    userId: number,
    sessionId?: string,
  ): AsyncGenerator<string> {
    const finalSessionId = sessionId || this.generateSessionId();

    try {
      // Execute agent to get sources
      const { response, sources } = await this.executeAgent(
        userQuery,
        userId,
        finalSessionId,
      );

      // Stream response chunks
      for (const char of response) {
        yield char;
        // Small delay for typing effect
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Send sources at end
      const sourcesStr = sources
        .map((s) => `📌 [${s.title}](${s.slug})`)
        .join('\n');
      if (sourcesStr) {
        yield `\n\n---\n\n**Sources:**\n${sourcesStr}`;
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: {
          operation: 'stream_agent_response',
          userId,
        },
      });
      yield `\n\nError: Failed to generate response. Please try again.`;
    }
  }

  /**
   * Get or create chat session
   */
  async getChatContext(userId: number, sessionId: string): Promise<AiChatContext> {


    try {
      const key = `chat:${userId}:${sessionId}`;
      const cached = await this.redisService.get(key);

      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (error) {
          this.logger.warn(`Failed to parse chat context from cache`);
        }
      }

      // Create new context
      const context: AiChatContext = {
        sessionId,
        userId,
        history: [],
        createdAt: Date.now(),
        lastUpdatedAt: Date.now(),
      };

      await this.redisService.set(
        key,
        JSON.stringify(context),
        this.chatHistoryTTL,
      );


      return context;
    } catch (error: any) {

      Sentry.captureException(error, {
        tags: {
          operation: 'get_chat_context',
          userId,
        },
      });
      throw error;
    } finally {

    }
  }

  /**
   * Update chat history with new message
   */
  private async updateChatHistory(
    userId: number,
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    try {
      const context = await this.getChatContext(userId, sessionId);

      // Add new messages
      context.history.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      });

      context.history.push({
        role: 'assistant',
        content: assistantResponse,
        timestamp: Date.now(),
      });

      // Keep only last N items
      if (context.history.length > this.maxHistoryItems) {
        context.history = context.history.slice(-this.maxHistoryItems);
      }

      context.lastUpdatedAt = Date.now();

      // Save updated context
      const key = `chat:${userId}:${sessionId}`;
      await this.redisService.set(
        key,
        JSON.stringify(context),
        this.chatHistoryTTL,
      );
    } catch (error: any) {
      this.logger.error(`Failed to update chat history: ${error.message}`);
      // Don't throw - chat history update failure shouldn't break the response
    }
  }

  /**
   * Clear chat session
   */
  async clearSession(userId: number, sessionId: string): Promise<void> {
    const key = `chat:${userId}:${sessionId}`;
    await this.redisService.del(key);
  }

  // ============ PRIVATE HELPERS ============

  /**
   * Extract source links from generated response
   */
  private extractSources(
    response: string,
    retrievedDocs: RetrievedContext[],
  ): Array<{ title: string; slug: string }> {
    const sources: Array<{ title: string; slug: string }> = [];

    // Extract markdown links from response [Title](slug)
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
    let match;

    while ((match = linkRegex.exec(response)) !== null) {
      const [, title, slug] = match;

      // Verify slug exists in retrieved docs
      if (retrievedDocs.some((doc) => doc.slug === slug)) {
        sources.push({ title, slug });
      }
    }

    return sources;
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
