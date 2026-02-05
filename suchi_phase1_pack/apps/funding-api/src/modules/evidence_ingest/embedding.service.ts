import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import OpenAI from "openai";

const BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI | null = null;
  private readonly model: string;
  private readonly rateLimitPerMin: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>("FUNDING_OPENAI_API_KEY");
    const baseURL = this.configService.get<string>("FUNDING_OPENAI_BASE_URL");
    if (apiKey) {
      this.client = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });
    }
    this.model = this.configService.get<string>("EVIDENCE_EMBEDDING_MODEL") ?? "text-embedding-3-small";
    this.rateLimitPerMin = this.configService.get<number>("EVIDENCE_EMBEDDING_RATE_LIMIT_PER_MIN") ?? 60;
  }

  isConfigured(): boolean {
    return !!this.client;
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
    if (!this.client) throw new Error("Embedding API not configured (FUNDING_OPENAI_API_KEY)");

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

    for (let i = 0; i < chunksFromCanonical.length; i += BATCH_SIZE) {
      const batch = chunksFromCanonical.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content.slice(0, 8000));

      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const res = await this.client.embeddings.create({
            model: this.model,
            input: texts,
          });
          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const vec = res.data[j]?.embedding;
            if (!vec) continue;
            await this.prisma.chunkEmbedding.create({
              data: {
                chunkId: chunk.id,
                embeddingModel: this.model,
                vector: JSON.stringify(vec),
              },
            });
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
