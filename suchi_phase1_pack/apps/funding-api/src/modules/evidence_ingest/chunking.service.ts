import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Approximate tokens (English): ~4 chars per token. Target 400–800 tokens, overlap 10–15%. */
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS_MIN = 400 * CHARS_PER_TOKEN;  // 1600
const TARGET_CHARS_MAX = 800 * CHARS_PER_TOKEN;  // 3200
const OVERLAP_CHARS = Math.floor(600 * CHARS_PER_TOKEN * 0.12); // ~288 chars overlap

/** Sub-batch size for createMany — avoids accumulating huge chunk arrays in memory. */
const CHUNK_WRITE_BATCH = 100;

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / CHARS_PER_TOKEN);
}

/**
 * Detect section title: short line, optionally with heading markers (##, **, or ending with :).
 */
function extractSectionTitle(lines: string[], startIndex: number): string | null {
  for (let i = startIndex - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.length > 120) break;
    if (/^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*$/.test(line) || line.endsWith(":"))
      return line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    if (line.length < 80) return line;
    break;
  }
  return null;
}

/**
 * Split text into chunks with overlap; attach section_title when possible.
 * Target ~600 tokens (~2400 chars), overlap ~12% (~288 chars). Prefer breaking at paragraph boundaries.
 */
function chunkText(text: string): Array<{ content: string; sectionTitle: string | null }> {
  if (!text?.trim()) return [];
  const lines = text.split(/\n/);
  const chunks: Array<{ content: string; sectionTitle: string | null }> = [];
  let lineStart = 0;

  while (lineStart < lines.length) {
    const segmentStart = lineStart;
    const segment: string[] = [];
    let length = 0;

    while (lineStart < lines.length && length < TARGET_CHARS_MIN) {
      segment.push(lines[lineStart]);
      length += lines[lineStart].length + 1;
      lineStart++;
    }
    while (lineStart < lines.length && length < TARGET_CHARS_MAX) {
      segment.push(lines[lineStart]);
      length += lines[lineStart].length + 1;
      lineStart++;
    }

    const content = segment.join("\n").trim();
    if (!content) break;

    const sectionTitle = extractSectionTitle(lines, segmentStart);
    chunks.push({ content, sectionTitle });

    if (lineStart >= lines.length) break;

    const overlapLineCount = Math.min(
      segment.length,
      Math.max(1, Math.ceil(OVERLAP_CHARS / (length / segment.length || 1))),
    );
    lineStart = lineStart - overlapLineCount;
  }

  return chunks;
}

export interface ChunkBatchResult {
  processedDocs: number;
  createdChunks: number;
  /** UUID of the last processed doc — pass as `afterId` for the next call. */
  nextAfterId: string | null;
  /** Approximate remaining docs (unchunked). 0 = done. */
  remainingEstimate: number;
}

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  /** Default batch — safe for 2Gi Cloud Run with large SCCF docs. */
  private static readonly DEFAULT_LIMIT = 3;
  /** Absolute max per HTTP call — prevents "one bad curl" from detonating the revision. */
  private static readonly MAX_LIMIT = 10;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chunk a small batch of eligible documents. Designed for repeated calls:
   *
   *   while (result.remainingEstimate > 0) {
   *     result = await POST /chunk { unchunkedOnly: true, afterId: result.nextAfterId }
   *   }
   *
   * Each call is bounded: few docs, quick return, bounded memory.
   */
  async chunkEligibleDocuments(options?: {
    limit?: number;
    unchunkedOnly?: boolean;
    afterId?: string;
  }): Promise<ChunkBatchResult> {
    const limit = Math.min(
      Math.max(1, options?.limit ?? ChunkingService.DEFAULT_LIMIT),
      ChunkingService.MAX_LIMIT,
    );
    const unchunkedOnly = options?.unchunkedOnly ?? false;
    const afterId = options?.afterId;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      qualityTier: { in: ["A", "B"] },
      cleanText: { not: null },
    };
    if (unchunkedOnly) {
      where.documentChunks = { none: {} };
    }
    // Keyset cursor: only docs after this ID (UUID ordering)
    if (afterId) {
      where.id = { gt: afterId };
    }

    // Count remaining (cheap — index-only on Cloud SQL)
    const remainingTotal = await this.prisma.evidenceDocument.count({ where });

    // Phase 1: IDs only — tiny memory footprint
    const docs = await this.prisma.evidenceDocument.findMany({
      where,
      select: { id: true, canonicalDocId: true },
      orderBy: { id: "asc" },
      take: limit,
    });

    const eligible = docs.filter(
      (d) => d.canonicalDocId === null || d.canonicalDocId === d.id,
    );

    this.logger.log(`Chunk batch: ${eligible.length} eligible, limit=${limit}, afterId=${afterId ?? "start"}, ~${remainingTotal} remaining`);

    let processedDocs = 0;
    let createdChunks = 0;
    let lastId: string | null = null;

    // Phase 2: One doc at a time — load text, chunk, write, release
    for (const { id } of eligible) {
      const doc = await this.prisma.evidenceDocument.findUnique({
        where: { id },
        select: { id: true, cleanText: true, cleanTextRedacted: true },
      });
      if (!doc) continue;

      const text = (doc.cleanTextRedacted ?? doc.cleanText)?.trim();
      if (!text) { lastId = id; continue; }

      // Delete old chunks for re-chunking
      await this.prisma.documentChunk.deleteMany({ where: { documentId: id } });

      // Generate chunks incrementally
      const chunks = chunkText(text);

      // Write in sub-batches to avoid accumulating large arrays
      for (let start = 0; start < chunks.length; start += CHUNK_WRITE_BATCH) {
        const batch = chunks.slice(start, start + CHUNK_WRITE_BATCH);
        await this.prisma.documentChunk.createMany({
          data: batch.map((c, i) => ({
            documentId: id,
            chunkIndex: start + i,
            content: c.content,
            sectionTitle: c.sectionTitle,
            tokenCount: estimateTokens(c.content),
          })),
        });
        createdChunks += batch.length;
      }

      processedDocs++;
      lastId = id;
      this.logger.log(`  doc ${id}: ${chunks.length} chunks`);
    }

    // Use the last doc from the query (not just eligible) for cursor continuity
    const cursorId = docs.length > 0 ? docs[docs.length - 1].id : lastId;
    const remainingEstimate = Math.max(0, remainingTotal - docs.length);

    this.logger.log(`Chunk batch done: ${processedDocs} docs, ${createdChunks} chunks, ~${remainingEstimate} remaining`);

    return {
      processedDocs,
      createdChunks,
      nextAfterId: remainingEstimate > 0 ? cursorId : null,
      remainingEstimate,
    };
  }
}
