import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { createEmbeddingProvider, EmbeddingProvider } from "./embedding-provider";

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly embeddingProvider: EmbeddingProvider | null = null;
  private readonly rateLimitPerMin: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // Split provider: embeddings use separate API key/base URL from LLM
    // Falls back to LLM config if embeddings-specific vars not set
    const embeddingsApiKey = this.configService.get<string>("FUNDING_EMBEDDINGS_API_KEY");
    const embeddingsBaseUrl = this.configService.get<string>("FUNDING_EMBEDDINGS_BASE_URL");
    const llmApiKey = this.configService.get<string>("FUNDING_OPENAI_API_KEY");
    const embeddingProviderName = this.configService.get<string>("FUNDING_EMBEDDING_PROVIDER");

    // Use embeddings-specific key if available, otherwise fall back to LLM key
    const apiKey = embeddingsApiKey || llmApiKey;
    const model = this.configService.get<string>("EVIDENCE_EMBEDDING_MODEL");

    // Create unified embedding provider (supports Google Gemini and OpenAI)
    this.embeddingProvider = createEmbeddingProvider({
      provider: embeddingProviderName,
      apiKey: apiKey || undefined,
      baseUrl: embeddingsBaseUrl || undefined,
      model: model || undefined,
    });

    if (this.embeddingProvider) {
      this.logger.log(`Embeddings provider configured: ${embeddingProviderName || "google"} (model=${this.embeddingProvider.modelName})`);
    } else {
      this.logger.warn("Embeddings provider not configured - FUNDING_EMBEDDINGS_API_KEY or FUNDING_OPENAI_API_KEY required");
    }

    this.rateLimitPerMin = this.configService.get<number>("EVIDENCE_EMBEDDING_RATE_LIMIT_PER_MIN") ?? 60;
  }

  isConfigured(): boolean {
    return !!this.embeddingProvider;
  }

  /**
   * P2-02: Embed chunks that have no embedding yet. Only Tier A/B canonical docs.
   * Resumable: processes chunks without ChunkEmbedding. Rate-limited and retried.
   */
  async embedPendingChunks(): Promise<{
    embedded: number;
    failed: number;
    durationMs: number;
    tokenCountProxy: number;
  }> {
    if (!this.embeddingProvider) throw new Error("Embedding provider not configured (set FUNDING_EMBEDDINGS_API_KEY and FUNDING_EMBEDDING_PROVIDER)");

    const docIds = await this.prisma.evidenceDocument.findMany({
      where: { qualityTier: { in: ["A", "B"] } },
      select: { id: true, canonicalDocId: true },
    });
    const canonicalSet = new Set(
      docIds.filter((d) => d.canonicalDocId === null || d.canonicalDocId === d.id).map((d) => d.id),
    );
    const chunksFromCanonical = await this.prisma.documentChunk.findMany({
      where: {
        chunkEmbedding: null,
        documentId: { in: [...canonicalSet] },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    const start = Date.now();
    let embedded = 0;
    let failed = 0;
    let tokenCountProxy = 0;
    const delayBetweenBatches = (60 * 1000) / this.rateLimitPerMin;
    const embeddingModelName = this.embeddingProvider.modelName;

    for (let i = 0; i < chunksFromCanonical.length; i += BATCH_SIZE) {
      const batch = chunksFromCanonical.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content.slice(0, 8000));

      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const results = await this.embeddingProvider.embedBatch(texts);
          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const vec = results[j]?.embedding;
            if (!vec) continue;
            const row = await this.prisma.chunkEmbedding.create({
              data: {
                chunkId: chunk.id,
                embeddingModel: embeddingModelName,
                vector: JSON.stringify(vec),
              },
            });
            // Dual-write: also populate native pgvector column
            try {
              await this.prisma.$executeRawUnsafe(
                `UPDATE "ChunkEmbedding" SET "embedding" = $1::vector WHERE "id" = $2`,
                `[${vec.join(",")}]`,
                row.id,
              );
            } catch (pgvecErr) {
              // Non-fatal: pgvector column may not exist yet (pre-migration)
              this.logger.debug(`pgvector dual-write skipped: ${(pgvecErr as Error).message}`);
            }
            embedded++;
            tokenCountProxy += Math.ceil((chunk.content.length || 0) / 4);
          }
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e as Error;
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          }
        }
      }
      if (lastErr) {
        failed += batch.length;
        this.logger.warn(`Embedding batch failed: ${lastErr.message}`);
      }
      if (i + BATCH_SIZE < chunksFromCanonical.length) {
        await new Promise((r) => setTimeout(r, delayBetweenBatches));
      }
    }

    const durationMs = Date.now() - start;
    this.logger.log(
      `Embedding: ${embedded} embedded, ${failed} failed, ${durationMs}ms, ~${tokenCountProxy} token proxy`,
    );

    await this.prisma.ingestRun.create({
      data: {
        step: "embedding",
        countsIndexed: embedded + failed,
        countsExtracted: embedded,
        durationMs,
        errorTypes: failed > 0 ? ({ failedBatch: failed } as object) : undefined,
      },
    });

    return { embedded, failed, durationMs, tokenCountProxy };
  }
}
