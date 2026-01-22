import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerativeModel,
  Content,
} from '@google/generative-ai';
import * as Sentry from '@sentry/nestjs';

/**
 * GeminiService - Wrapper for Google Gemini API with streaming and safety features
 * 
 * Features:
 * - Multi-model support (gemini-1.5-flash for chat/summarization, text-embedding-004 for embeddings)
 * - Streaming support for real-time responses
 * - Safety filtering (HARMFUL_CATEGORY_HARASSMENT, SEXUAL, VIOLENCE, DANGEROUS)
 * - Sentry integration for quota, rate limits, and latency monitoring
 * - Retry logic for transient errors
 * - Request/response validation
 */
@Injectable()
export class GeminiService {
  private readonly client: GoogleGenerativeAI;
  private readonly logger = new Logger(GeminiService.name);
  private readonly chatModel: GenerativeModel;
  private readonly embeddingModel: GenerativeModel;
  private readonly maxRetries = 3;
  private readonly requestTimeout = 30000; // 30 seconds

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    this.client = new GoogleGenerativeAI(apiKey);
    this.chatModel = this.client.getGenerativeModel(
      { model: 'gemini-1.5-flash' },
      {
        apiVersion: 'v1beta',
      },
    );
    this.embeddingModel = this.client.getGenerativeModel({
      model: 'text-embedding-004',
    });

    // Log initialization
    this.logger.log('GeminiService initialized with gemini-1.5-flash and text-embedding-004');
  }

  /**
   * Generate text response using gemini-1.5-flash
   * With safety filtering and error handling
   * Wrapped in Child Span for observability
   */
  async generateText(prompt: string, retryCount = 0): Promise<string> {
    return Sentry.startSpan(
      {
        name: 'gemini.text_generation',
        op: 'ai.api.call',
        attributes: {
          'service': 'gemini',
          'model': 'gemini-1.5-flash',
          'operation': 'generateText',
          'prompt.length': prompt?.length || 0,
          'retry_count': retryCount,
          // Data masking: Don't send actual prompt text
          'prompt.masked': true,
        },
      },
      async (span) => {
        try {
          if (!prompt || prompt.trim().length === 0) {
            throw new BadRequestException('Prompt cannot be empty');
          }

          const startTime = Date.now();

          const response = await Promise.race([
            this.chatModel.generateContent({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              safetySettings: this.getSafetySettings(),
              generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 1024,
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Gemini request timeout')),
                this.requestTimeout,
              ),
            ),
          ]);

          const duration = Date.now() - startTime;

          const text =
            response.response.text?.() ||
            response.response.candidates?.[0]?.content?.parts?.[0]?.text;

          if (!text) {
            throw new ServiceUnavailableException(
              'Gemini response is empty or malformed',
            );
          }

          // Track Time To First Byte (TTFB)
          span?.setAttributes({
            'ttfb_ms': duration,
            'response.length': text.length,
            'response.success': true,
          });

          span?.setStatus({ code: 0 as any });

          Sentry.captureMessage('Gemini text generated successfully', 'info');
          return text;
        } catch (error: any) {
          const duration = Date.now() - (Date.now() - (error.startTime || 0));

          // Handle Rate Limit (429) errors
          if (error?.status === 429) {
            span?.setAttributes({
              'error.type': 'rate_limit',
              'http.status_code': 429,
              'retry.attempt': retryCount,
            });
            span?.setStatus({
              code: 2 as any,
              message: 'Rate limit exceeded (429)',
            });

            // Link rate limit error to span
            Sentry.captureException(error, {
              tags: {
                error_type: 'rate_limit',
                service: 'gemini',
                retry_count: retryCount.toString(),
              },
              level: 'warning',
              attributes: {
                'error.phase': 'gemini_generation',
                'http.status_code': 429,
                'retry.attempt': retryCount,
              },
            });
          } else {
            span?.setStatus({
              code: 2 as any,
              message: error.message,
            });

            // Link other errors to span
            this.handleGeminiError(error, retryCount);
          }

          // Retry logic for transient errors
          if (
            retryCount < this.maxRetries &&
            this.isTransientError(error)
          ) {
            this.logger.warn(
              `Retrying Gemini request (attempt ${retryCount + 1}/${this.maxRetries})`,
            );
            await this.delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
            return this.generateText(prompt, retryCount + 1);
          }

          throw error;
        }
      },
    );
  }

  /**
   * Stream text generation for real-time response delivery
   * Used for WebSocket streaming to clients
   */
  async *streamGenerateText(prompt: string): AsyncGenerator<string> {


    try {
      if (!prompt || prompt.trim().length === 0) {
        throw new BadRequestException('Prompt cannot be empty');
      }

      const stream = await this.chatModel.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        safetySettings: this.getSafetySettings(),
        generationConfig: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 1024,
        },
      });

      for await (const chunk of stream.stream) {
        const text = chunk.text?.();
        if (text) {
          yield text;
        }
      }


    } catch (error: any) {
      this.handleGeminiError(error);
      throw error;
    } finally {

    }
  }

  /**
   * Generate embeddings for semantic search
   * Returns 768-dimensional vectors from text-embedding-004
   * Wrapped in Child Span with TTFB tracking
   */
  async generateEmbedding(text: string, retryCount = 0): Promise<number[]> {
    return Sentry.startSpan(
      {
        name: 'gemini.embedding',
        op: 'ai.api.call',
        attributes: {
          'service': 'gemini',
          'model': 'text-embedding-004',
          'operation': 'generateEmbedding',
          'text.length': text?.length || 0,
          'text.masked': true, // Data masking
          'retry_count': retryCount,
        },
      },
      async (span) => {
        try {
          if (!text || text.trim().length === 0) {
            throw new BadRequestException('Text cannot be empty');
          }

          // Truncate text to reasonable length for embedding (max 2048 tokens ≈ 8000 chars)
          const truncatedText = text.substring(0, 8000);

          const startTime = Date.now();

          const response = await Promise.race([
            this.embeddingModel.embedContent({
              content: { role: 'user', parts: [{ text: truncatedText }] },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Embedding request timeout')),
                this.requestTimeout,
              ),
            ),
          ]);

          const duration = Date.now() - startTime;

          const embedding = response.embedding?.values;
          if (!embedding || !Array.isArray(embedding)) {
            throw new ServiceUnavailableException(
              'Invalid embedding response from Gemini',
            );
          }

          // Track TTFB for embedding
          span?.setAttributes({
            'ttfb_ms': duration,
            'embedding.dimension': embedding.length,
            'response.success': true,
          });

          span?.setStatus({ code: 0 as any });

          Sentry.captureMessage('Embedding generated successfully', 'info');
          return embedding;
        } catch (error: any) {
          span?.setStatus({
            code: 2 as any,
            message: error.message,
          });

          // Handle Rate Limit errors
          if (error?.status === 429) {
            span?.setAttributes({
              'error.type': 'rate_limit',
              'http.status_code': 429,
            });

            // Link rate limit to span
            Sentry.captureException(error, {
              tags: {
                error_type: 'rate_limit',
                service: 'gemini',
                operation: 'embedding',
              },
              level: 'warning',
              attributes: {
                'error.phase': 'embedding_generation',
                'http.status_code': 429,
              },
            });
          } else {
            this.handleGeminiError(error, retryCount);
          }

          if (retryCount < this.maxRetries && this.isTransientError(error)) {
            this.logger.warn(
              `Retrying embedding generation (attempt ${retryCount + 1}/${this.maxRetries})`,
            );
            await this.delay(Math.pow(2, retryCount) * 1000);
            return this.generateEmbedding(text, retryCount + 1);
          }

          throw error;
        }
      },
    );
  }

  /**
   * Check text for safety violations (toxicity, harassment, sexual content, violence)
   * Returns true if text is safe, false if unsafe
   */
  async checkSafety(text: string): Promise<boolean> {
    // Wrap in child span for safety check operation with TTFB tracking
    return Sentry.startSpan({
      name: 'gemini.safety_check',
      op: 'ai.api.call',
      attributes: {
        'service': 'gemini',
        'model': 'gemini-1.5-flash',
        'operation': 'safety_check',
        'text.masked': true, // Do not send actual text
        'text.length': text?.length || 0,
      },
    }, async (span) => {
      const startTime = Date.now();
      
      try {
        if (!text || text.trim().length === 0) {
          span?.setAttributes({
            'check.result': 'safe',
            'check.reason': 'empty_text',
          });
          return true; // Empty text is safe
        }

        const response = await this.chatModel.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Analyze this text for safety violations (toxicity, harassment, sexual content, violence). Respond with only "SAFE" or "UNSAFE":\n\n"${text}"`,
                },
              ],
            },
          ],
          safetySettings: this.getSafetySettings(),
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 10,
          },
        });

        const duration = Date.now() - startTime;
        const result = response.response.text?.().trim().toUpperCase();
        const isSafe = result === 'SAFE';

        // Record TTFB and result
        span?.setAttributes({
          'ttfb_ms': duration,
          'check.result': isSafe ? 'safe' : 'unsafe',
          'response.length': result?.length || 0,
        });

        // Set OK status
        span?.setStatus({ code: 0 as any });

        Sentry.captureMessage(
          `Safety check completed: ${isSafe ? 'SAFE' : 'UNSAFE'}`,
          'info',
        );

        return isSafe;
      } catch (error: any) {
        const duration = Date.now() - startTime;
        
        // Handle Rate Limit (429) errors
        if (error?.status === 429) {
          span?.setAttributes({
            'error.type': 'rate_limit',
            'http.status_code': 429,
            'ttfb_ms': duration,
          });
          span?.setStatus({
            code: 2 as any,
            message: 'Rate limit exceeded (429)',
          });
          
          Sentry.captureException(error, {
            tags: {
              error_type: 'rate_limit',
              service: 'gemini',
              operation: 'safety_check',
            },
            level: 'warning',
            attributes: {
              'error.phase': 'safety_check',
              'http.status_code': 429,
            },
          });
        } else {
          span?.setAttributes({
            'error.type': error?.status || 'unknown',
            'ttfb_ms': duration,
          });
          span?.setStatus({
            code: 2 as any,
            message: error?.message || 'Safety check failed',
          });
          
          Sentry.captureException(error, {
            tags: {
              error_type: 'safety_check_failed',
              service: 'gemini',
              operation: 'safety_check',
            },
            level: 'warning',
            attributes: {
              'error.phase': 'safety_check',
              'error.status': error?.status,
            },
          });
        }

        this.handleGeminiError(error);
        // On error, default to safe to not block operations
        return true;
      }
    });
  }

  /**
   * Summarize text to a specified length
   * Used for content summarization and snippet generation
   */
  async summarize(
    text: string,
    maxTokens: number = 150,
  ): Promise<string> {
    // Wrap in child span for summarization operation with TTFB tracking
    return Sentry.startSpan({
      name: 'gemini.summarization',
      op: 'ai.api.call',
      attributes: {
        'service': 'gemini',
        'model': 'gemini-1.5-flash',
        'operation': 'summarization',
        'text.masked': true, // Do not send actual text
        'text.length': text?.length || 0,
        'max_tokens': maxTokens,
      },
    }, async (span) => {
      const startTime = Date.now();
      
      try {
        if (!text || text.trim().length === 0) {
          span?.setStatus({
            code: 2 as any,
            message: 'Text cannot be empty',
          });
          throw new BadRequestException('Text cannot be empty');
        }

        const response = await this.chatModel.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Summarize the following text in ${maxTokens} tokens or less, preserving key information:\n\n${text}`,
                },
              ],
            },
          ],
          safetySettings: this.getSafetySettings(),
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: maxTokens,
          },
        });

        const duration = Date.now() - startTime;
        const summary =
          response.response.text?.() ||
          response.response.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!summary) {
          span?.setStatus({
            code: 2 as any,
            message: 'Empty response',
          });
          throw new ServiceUnavailableException(
            'Summarization failed - empty response',
          );
        }

        // Record success with TTFB
        span?.setAttributes({
          'ttfb_ms': duration,
          'summary.length': summary.length,
          'compression_ratio': (summary.length / text.length).toFixed(2),
        });
        span?.setStatus({ code: 0 as any });

        return summary;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Handle Rate Limit (429) errors
        if (error?.status === 429) {
          span?.setAttributes({
            'error.type': 'rate_limit',
            'http.status_code': 429,
            'ttfb_ms': duration,
          });
          span?.setStatus({
            code: 2 as any,
            message: 'Rate limit exceeded (429)',
          });
          
          Sentry.captureException(error, {
            tags: {
              error_type: 'rate_limit',
              service: 'gemini',
              operation: 'summarization',
            },
            level: 'warning',
            attributes: {
              'error.phase': 'summarization',
              'http.status_code': 429,
            },
          });
        } else {
          span?.setAttributes({
            'error.type': error?.status || 'unknown',
            'ttfb_ms': duration,
          });
          span?.setStatus({
            code: 2 as any,
            message: error?.message || 'Summarization failed',
          });
          
          Sentry.captureException(error, {
            tags: {
              error_type: 'summarization_failed',
              service: 'gemini',
              operation: 'summarization',
            },
            level: 'error',
            attributes: {
              'error.phase': 'summarization',
              'error.status': error?.status,
            },
          });
        }

        this.handleGeminiError(error);
        throw error;
      }
    });
  }

  /**
   * Extract and suggest tags based on content
   * Used for auto-tagging functionality
   */
  async suggestTags(content: string, existingTags: string[]): Promise<string[]> {
    // Wrap in child span for tagging operation with TTFB tracking
    return Sentry.startSpan({
      name: 'gemini.tagging',
      op: 'ai.api.call',
      attributes: {
        'service': 'gemini',
        'model': 'gemini-1.5-flash',
        'operation': 'tagging',
        'content.masked': true, // Do not send actual content
        'content.length': content?.length || 0,
        'existing_tags.count': existingTags?.length || 0,
      },
    }, async (span) => {
      const startTime = Date.now();
      
      try {
        if (!content || content.trim().length === 0) {
          span?.setStatus({
            code: 2 as any,
            message: 'Content cannot be empty',
          });
          throw new BadRequestException('Content cannot be empty');
        }

        const existingTagsStr =
          existingTags.length > 0
            ? `\n\nExisting tags in the system: ${existingTags.join(', ')}`
            : '';

        const response = await this.chatModel.generateContent({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Based on this content, suggest 3-5 relevant tags. Return only tag names separated by commas, no extra text.${existingTagsStr}\n\nContent:\n${content.substring(0, 2000)}`,
                },
              ],
            },
          ],
          safetySettings: this.getSafetySettings(),
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 100,
          },
        });

        const duration = Date.now() - startTime;
        const tagsStr = response.response.text?.().trim() || '';
        const tags = tagsStr
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0 && tag.length <= 50)
          .slice(0, 10);

        // Record success with TTFB
        span?.setAttributes({
          'ttfb_ms': duration,
          'tags.suggested_count': tags.length,
          'tags.raw_length': tagsStr.length,
        });
        span?.setStatus({ code: 0 as any });

        return tags;
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Handle Rate Limit (429) errors
        if (error?.status === 429) {
          span?.setAttributes({
            'error.type': 'rate_limit',
            'http.status_code': 429,
            'ttfb_ms': duration,
          });
          span?.setStatus({
            code: 2 as any,
            message: 'Rate limit exceeded (429)',
          });
          
          Sentry.captureException(error, {
            tags: {
              error_type: 'rate_limit',
              service: 'gemini',
              operation: 'tagging',
            },
            level: 'warning',
            attributes: {
              'error.phase': 'tagging',
              'http.status_code': 429,
            },
          });
        } else {
          span?.setAttributes({
            'error.type': error?.status || 'unknown',
            'ttfb_ms': duration,
          });
          span?.setStatus({
            code: 2 as any,
            message: error?.message || 'Tagging failed',
          });
          
          Sentry.captureException(error, {
            tags: {
              error_type: 'tagging_failed',
              service: 'gemini',
              operation: 'tagging',
            },
            level: 'error',
            attributes: {
              'error.phase': 'tagging',
              'error.status': error?.status,
            },
          });
        }

        this.handleGeminiError(error);
        return []; // Return empty array on error
      }
    });
  }

  /**
   * Initialize multi-turn conversation with system context
   */
  initializeConversation(systemContext: string): Content[] {
    return [
      {
        role: 'user',
        parts: [{ text: systemContext }],
      },
    ];
  }

  /**
   * Add message to conversation history
   */
  addToConversation(
    history: Content[],
    userMessage: string,
    assistantResponse: string,
  ): Content[] {
    return [
      ...history,
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
      {
        role: 'model',
        parts: [{ text: assistantResponse }],
      },
    ];
  }

  // ============ PRIVATE HELPERS ============

  /**
   * Get safety settings for Gemini API
   */
  private getSafetySettings() {
    return [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ];
  }

  /**
   * Handle Gemini-specific errors with Sentry reporting
   */
  private handleGeminiError(
    error: any,
    retryCount: number = 0,
  ): void {
    const errorMessage = error?.message || 'Unknown error';
    const statusCode = error?.status;

    // Log rate limit errors
    if (statusCode === 429) {
      Sentry.captureException(error, {
        tags: {
          error_type: 'rate_limit',
          retry_count: retryCount,
        },
        level: 'warning',
      });
      this.logger.warn('Gemini rate limit exceeded (429)');
    }
    // Log quota exceeded errors
    else if (statusCode === 403 && errorMessage.includes('quota')) {
      Sentry.captureException(error, {
        tags: {
          error_type: 'quota_exceeded',
        },
        level: 'error',
      });
      this.logger.error('Gemini quota exceeded (403)');
    }
    // Log timeout errors
    else if (errorMessage.includes('timeout')) {
      Sentry.captureException(error, {
        tags: {
          error_type: 'timeout',
          retry_count: retryCount,
        },
        level: 'warning',
      });
      this.logger.warn('Gemini request timeout');
    }
    // Log other errors
    else {
      Sentry.captureException(error, {
        tags: {
          error_type: 'api_error',
          status_code: statusCode,
        },
      });
      this.logger.error(`Gemini API error: ${errorMessage}`);
    }
  }

  /**
   * Check if error is transient and retryable
   */
  private isTransientError(error: any): boolean {
    const status = error?.status;
    const message = error?.message?.toLowerCase() || '';

    return (
      status === 429 || // Rate limit
      status === 503 || // Service unavailable
      status === 500 || // Internal server error
      status === 504 || // Gateway timeout
      message.includes('timeout') ||
      message.includes('temporary')
    );
  }

  /**
   * Delay helper for exponential backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}




