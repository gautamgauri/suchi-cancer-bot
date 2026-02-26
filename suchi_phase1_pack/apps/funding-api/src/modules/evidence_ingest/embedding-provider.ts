/**
 * Unified embedding provider that supports both Google Gemini and OpenAI.
 * Configured via FUNDING_EMBEDDING_PROVIDER env var ("google" | "openai").
 * Default: "google" (to align with Google Cloud deployment).
 */
import { Logger } from "@nestjs/common";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface EmbeddingResult {
  embedding: number[];
}

export interface EmbeddingProvider {
  embed(input: string): Promise<EmbeddingResult>;
  embedBatch(inputs: string[]): Promise<EmbeddingResult[]>;
  readonly dimensions: number;
  readonly modelName: string;
}

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  private readonly genAI: GoogleGenerativeAI;
  private readonly model: string;
  readonly dimensions = 768;
  private readonly logger = new Logger(GoogleEmbeddingProvider.name);

  constructor(apiKey: string, model?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    // text-embedding-004 is always 768-dim.
    // gemini-embedding-001 supports 256/768/3072 — defaults to 3072 if unspecified.
    // We always request 768 via outputDimensionality to match the DB schema.
    this.model = model || "text-embedding-004";
    this.logger.log(`Google embedding provider configured (model=${this.model}, dimensions=${this.dimensions})`);
  }

  get modelName(): string {
    return this.model;
  }

  async embed(input: string): Promise<EmbeddingResult> {
    const embeddingModel = this.genAI.getGenerativeModel({ model: this.model });
    const result = await embeddingModel.embedContent({
      // outputDimensionality is not in SDK types but accepted by the API.
      // Ensures 768-dim output for models that support variable dimensions (e.g. gemini-embedding-001).
      ...({ outputDimensionality: 768 } as object),
      content: { role: "user", parts: [{ text: input.slice(0, 10000) }] },
    } as Parameters<typeof embeddingModel.embedContent>[0]);
    return { embedding: result.embedding.values };
  }

  async embedBatch(inputs: string[]): Promise<EmbeddingResult[]> {
    const embeddingModel = this.genAI.getGenerativeModel({ model: this.model });
    const result = await embeddingModel.batchEmbedContents({
      requests: inputs.map((input) => ({
        // outputDimensionality ensures 768-dim even for gemini-embedding-001
        ...({ outputDimensionality: 768 } as object),
        content: { role: "user", parts: [{ text: input.slice(0, 10000) }] },
      } as Parameters<typeof embeddingModel.batchEmbedContents>[0]["requests"][number])),
    });
    return result.embeddings.map((e) => ({ embedding: e.values }));
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  readonly dimensions = 1536;
  private readonly logger = new Logger(OpenAIEmbeddingProvider.name);

  constructor(apiKey: string, baseUrl?: string, model?: string) {
    this.client = new OpenAI({ apiKey, ...(baseUrl && { baseURL: baseUrl }) });
    this.model = model || "text-embedding-3-small";
    this.logger.log(`OpenAI embedding provider configured (model=${this.model}, dimensions=${this.dimensions})`);
  }

  get modelName(): string {
    return this.model;
  }

  async embed(input: string): Promise<EmbeddingResult> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: input.slice(0, 8000),
    });
    return { embedding: res.data[0]?.embedding ?? [] };
  }

  async embedBatch(inputs: string[]): Promise<EmbeddingResult[]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: inputs.map((t) => t.slice(0, 8000)),
    });
    return res.data.map((d) => ({ embedding: d.embedding }));
  }
}

/**
 * Factory: create embedding provider from environment config.
 */
export function createEmbeddingProvider(config: {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): EmbeddingProvider | null {
  const provider = (config.provider || "google").toLowerCase();

  if (!config.apiKey) {
    return null;
  }

  if (provider === "google" || provider === "gemini") {
    return new GoogleEmbeddingProvider(config.apiKey, config.model);
  }

  return new OpenAIEmbeddingProvider(config.apiKey, config.baseUrl, config.model);
}
