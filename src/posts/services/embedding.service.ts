import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private geminiClient: GoogleGenerativeAI;
  private model: string;
  private isConfigured: boolean = false;

  constructor() {
    this.initializeGemini();
  }

  private initializeGemini(): void {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'text-embedding-004';

    if (!apiKey) {
      this.logger.warn(
        '[EMBEDDING] GEMINI_API_KEY not configured. Using mock embeddings for development.',
      );
      this.isConfigured = false;
      return;
    }

    try {
      this.geminiClient = new GoogleGenerativeAI(apiKey);
      this.model = model;
      this.isConfigured = true;
      this.logger.debug(`[EMBEDDING] Gemini initialized with model: ${model}`);
    } catch (error) {
      this.logger.error('[EMBEDDING] Failed to initialize Gemini:', error);
      this.isConfigured = false;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Clean and preprocess text
      const cleanedText = this.normalizeText(text);

      // Try real embedding if configured
      if (this.isConfigured && this.geminiClient) {
        return await this.generateGeminiEmbedding(cleanedText);
      }

      // Fall back to mock
      this.logger.debug('[EMBEDDING] Using mock embedding (development mode)');
      return this.generateMockEmbedding(cleanedText);
    } catch (error) {
      this.logger.error('[EMBEDDING] Error generating embedding:', error);
      // Graceful degradation: use mock embedding
      return this.generateMockEmbedding(text);
    }
  }

  private async generateGeminiEmbedding(text: string): Promise<number[]> {
    try {
      this.logger.debug(`[EMBEDDING] Calling Gemini API for text: "${text.substring(0, 50)}..."`);

      const model = this.geminiClient.getGenerativeModel({
        model: this.model,
      });

      const result = await model.embedContent(text);

      if (!result.embedding || !result.embedding.values) {
        throw new Error('No embedding returned from Gemini API');
      }

      const embedding = result.embedding.values;

      if (embedding.length !== 768) {
        this.logger.warn(
          `[EMBEDDING] Expected 768 dimensions, got ${embedding.length}. May cause database compatibility issues.`,
        );
      }

      this.logger.debug(
        `[EMBEDDING] Generated Gemini embedding: ${embedding.length} dimensions`,
      );

      return embedding;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[EMBEDDING] Gemini API error: ${errorMessage}. Falling back to mock embedding.`,
      );

      // Return mock embedding as fallback
      return this.generateMockEmbedding('');
    }
  }

  private generateMockEmbedding(text: string): number[] {
    let hash = this.hashString(text);

    const embedding: number[] = [];
    let seed = hash || 12345; 

    for (let i = 0; i < 768; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const normalized = (seed / 0x7fffffff) * 2 - 1; 
      embedding.push(normalized);
    }

    return this.normalizeVector(embedding);
  }

  private normalizeText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      .replace(/\s+/g, ' ') 
      .trim() 
      .substring(0, 8191 * 4); 
  }

  private normalizeVector(vector: number[]): number[] {
    // Calculate magnitude: sqrt(sum of squares)
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0),
    );

    if (magnitude === 0) {
      return vector;
    }

    // Divide each component by magnitude
    return vector.map((val) => val / magnitude);
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i); 
    }
    return (hash >>> 0) & 0x7fffffff; 
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  getStatus(): {
    isConfigured: boolean;
    apiKeyPrefix?: string;
    model?: string;
    dimensions: number;
  } {
    return {
      isConfigured: this.isConfigured,
      ...(this.isConfigured && {
        apiKeyPrefix: process.env.GEMINI_API_KEY?.substring(0, 10) + '...',
        model: this.model,
      }),
      dimensions: 768, 
    };
  }
}
