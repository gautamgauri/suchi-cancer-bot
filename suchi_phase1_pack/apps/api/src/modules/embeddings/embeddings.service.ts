import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("EMBEDDING_API_KEY") || this.configService.get<string>("GEMINI_API_KEY") || "";
    if (!this.apiKey) {
      throw new Error("EMBEDDING_API_KEY or GEMINI_API_KEY is required for embeddings");
    }
    this.modelName = this.configService.get<string>("EMBEDDING_MODEL") || "text-embedding-004";
  }

  /**
   * Generate embedding for a single text using Google's embedding REST API
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Use Google AI REST API for embeddings (text-embedding-004)
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:embedContent?key=${this.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: `models/${this.modelName}`,
          content: {
            parts: [{ text: text }]
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Embeddings API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.embedding?.values || data.embedding.values.length === 0) {
        throw new Error("Empty embedding returned from API");
      }

      return data.embedding.values;
    } catch (error) {
      this.logger.error(`Error generating embedding: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch processing)
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    
    // Process in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(text => this.generateEmbedding(text));
      const batchResults = await Promise.all(batchPromises);
      embeddings.push(...batchResults);
      
      // Small delay between batches to respect rate limits
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return embeddings;
  }

  /**
   * Get embedding dimensions (768 for text-embedding-004)
   */
  getEmbeddingDimensions(): number {
    // Google text-embedding-004 has 768 dimensions
    return 768;
  }
}
