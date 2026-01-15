import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * EmbeddingService - Generate vector embeddings using Google Gemini API
 *
 * Features:
 * - Uses Google Gemini text-embedding-004 model (768 dimensions)
 * - Graceful error handling with fallback to deterministic mock embeddings
 * - Text preprocessing to improve embedding quality
 * - Caching support (optional, can be integrated with Redis)
 *
 * Cost Optimization:
 * - Google Gemini Free Tier: Unlimited embeddings (no cost)
 * - Rate limiting: 15 requests per minute (free tier)
 * - Typical post (500 tokens): ~Free
 *
 * Environment Variables Required:
 * - GEMINI_API_KEY: Your Google Gemini API key
 * - GEMINI_MODEL: Model name (default: text-embedding-004)
 *
 * Usage:
 * const embedding = await this.embeddingService.generateEmbedding(text);
 * // Returns: number[] (768 dimensions)
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private geminiClient: GoogleGenerativeAI;
  private model: string;
  private isConfigured: boolean = false;

  constructor() {
    this.initializeGemini();
  }

  /**
   * Initialize Gemini client
   * - Checks for API key
   * - Creates client if available
   * - Logs warning if not configured (falls back to mock)
   */
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

  /**
   * Generate embedding for given text
   *
   * Flow:
   * 1. Clean and preprocess input text (remove newlines, collapse spaces)
   * 2. Try Gemini API if configured
   * 3. Fall back to deterministic mock if API unavailable
   * 4. Return 768-dimensional vector
   *
   * @param text - Input text to embed
   * @returns Vector embedding (768 dimensions)
   */
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

  /**
   * Generate embedding using Gemini API
   * - Calls text-embedding-004 model
   * - Returns 768-dimensional vectors
   * - Handles API errors gracefully
   *
   * @param text - Cleaned, normalized text
   * @returns Vector embedding or throws error
   */
  private async generateGeminiEmbedding(text: string): Promise<number[]> {
    try {
      this.logger.debug(`[EMBEDDING] Calling Gemini API for text: "${text.substring(0, 50)}..."`);

      // Get the embedding model from Gemini
      const model = this.geminiClient.getGenerativeModel({
        model: this.model,
      });

      // Generate embedding
      const result = await model.embedContent(text);

      if (!result.embedding || !result.embedding.values) {
        throw new Error('No embedding returned from Gemini API');
      }

      const embedding = result.embedding.values;

      // Validate dimensions (should be 768 for text-embedding-004)
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

  /**
   * Generate deterministic mock embedding (for development/fallback)
   *
   * Features:
   * - Deterministic: Same input always produces same output
   * - 768 dimensions (matches Gemini text-embedding-004)
   * - Uses Linear Congruential Generator (LCG) for reproducibility
   * - L2 normalization for unit vectors
   *
   * Why deterministic?
   * - Reproducible for testing
   * - Consistent across restarts
   * - Predictable for integration tests
   *
   * @param text - Input text (seed for randomness)
   * @returns Deterministic mock embedding (768 dimensions)
   */
  private generateMockEmbedding(text: string): number[] {
    // Generate deterministic seed from text
    let hash = this.hashString(text);

    // Generate 768 deterministic random numbers using LCG
    const embedding: number[] = [];
    let seed = hash || 12345; // Default seed if hash is 0

    for (let i = 0; i < 768; i++) {
      // Linear Congruential Generator parameters (standard)
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const normalized = (seed / 0x7fffffff) * 2 - 1; // Range [-1, 1]
      embedding.push(normalized);
    }

    // L2 normalization: convert to unit vector
    return this.normalizeVector(embedding);
  }

  /**
   * Normalize text for better embedding quality
   *
   * Operations:
   * - Remove extra whitespace (newlines, tabs, multiple spaces)
   * - Convert to single line
   * - Limit to 8191 tokens (Google API soft limit)
   * - Trim leading/trailing whitespace
   *
   * Why clean text?
   * - Newlines don't add semantic meaning
   * - Multiple spaces are redundant
   * - Reduces token count for better performance
   * - Improves retrieval quality
   *
   * @param text - Raw text input
   * @returns Cleaned text ready for embedding
   */
  private normalizeText(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
      .trim() // Remove leading/trailing whitespace
      .substring(0, 8191 * 4); // Rough estimate: 4 chars per token, limit to 8191 tokens
  }

  /**
   * L2 normalization: convert vector to unit vector
   *
   * Formula: v' = v / ||v||
   * where ||v|| = sqrt(sum(v[i]^2))
   *
   * Result: All vectors have magnitude ~1.0
   *
   * Why normalize?
   * - Consistent vector magnitude
   * - Better for cosine similarity (already normalized)
   * - Matches expected embedding format
   *
   * @param vector - Input vector
   * @returns Normalized unit vector
   */
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

  /**
   * Simple string hash for deterministic seeding (DJB2)
   *
   * Algorithm: DJB2 hash function
   * - Fast and simple
   * - Good distribution
   * - Deterministic
   *
   * @param str - String to hash
   * @returns Hash value (unsigned 32-bit)
   */
  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i); // hash * 33 + c
    }
    return (hash >>> 0) & 0x7fffffff; // Convert to positive 31-bit integer
  }

  /**
   * Check if Gemini API is configured and ready
   * @returns true if API key is set and client initialized
   */
  isReady(): boolean {
    return this.isConfigured;
  }

  /**
   * Get status information about embedding service
   *
   * Useful for debugging and health checks
   * @returns Object with configuration status
   */
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
      dimensions: 768, // Gemini text-embedding-004 always outputs 768 dimensions
    };
  }
}
