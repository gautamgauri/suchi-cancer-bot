/**
 * Unified embedding provider that supports both Google Gemini and OpenAI.
 * Configured via FUNDING_EMBEDDING_PROVIDER env var ("google" | "openai").
 * Default: "google" (to align with Google Cloud deployment).
 */
import { Logger } from "@nestjs/common";
import OpenAI from "openai";

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
  private readonly apiKey: string;
  private readonly model: string;
  readonly dimensions = 768;
  private readonly logger = new Logger(GoogleEmbeddingProvider.name);

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    // gemini-embedding-001 supports 256/768/3072-dim output (default=3072).
    // We always pass outputDimensionality=768 to match the vector(768) DB column.
    // Note: text-embedding-004 is v1-only; the @google/generative-ai SDK uses v1beta,
    // so we call the REST API directly to control the full request body.
    this.model = model || "gemini-embedding-001";
    this.logger.log(`Google embedding provider configured (model=${this.model}, dimensions=${this.dimensions})`);
  }

  get modelName(): string {
    return this.model;
  }

  async embed(input: string): Promise<EmbeddingResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { role: "user", parts: [{ text: input.slice(0, 10000) }] },
        outputDimensionality: 768,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini embed failed (${res.status}): ${err}`);
    }
    const json = await res.json() as { embedding: { values: number[] } };
    return { embedding: json.embedding.values };
  }

  async embedBatch(inputs: string[]): Promise<EmbeddingResult[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: inputs.map((input) => ({
          model: `models/${this.model}`,
          content: { role: "user", parts: [{ text: input.slice(0, 10000) }] },
          outputDimensionality: 768,
        })),
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini batchEmbed failed (${res.status}): ${err}`);
    }
    const json = await res.json() as { embeddings: Array<{ values: number[] }> };
    return json.embeddings.map((e) => ({ embedding: e.values }));
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
