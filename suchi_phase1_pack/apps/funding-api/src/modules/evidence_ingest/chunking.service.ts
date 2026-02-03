import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Approximate tokens (English): ~4 chars per token. Target 400–800 tokens, overlap 10–15%. */
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS_MIN = 400 * CHARS_PER_TOKEN;  // 1600
const TARGET_CHARS_MAX = 800 * CHARS_PER_TOKEN;  // 3200
const OVERLAP_CHARS = Math.floor(600 * CHARS_PER_TOKEN * 0.12); // ~288 chars overlap

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

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * P2-01: Chunk documents that are canonical and Tier A or B. Use clean_text_redacted when present.
   * Re-chunking deletes existing chunks for the doc and recreates.
   */
  async chunkEligibleDocuments(): Promise<{ documentsProcessed: number; chunksCreated: number }> {
    const docs = await this.prisma.evidenceDocument.findMany({
      where: {
        qualityTier: { in: ["A", "B"] },
        cleanText: { not: null },
      },
      select: { id: true, name: true, cleanText: true, cleanTextRedacted: true, canonicalDocId: true },
    });

    const eligible = docs.filter(
      (d) => d.canonicalDocId === null || d.canonicalDocId === d.id,
    );

    let documentsProcessed = 0;
    let chunksCreated = 0;

    for (const doc of eligible) {
      const text = (doc.cleanTextRedacted ?? doc.cleanText)?.trim();
      if (!text) continue;

      await this.prisma.documentChunk.deleteMany({ where: { documentId: doc.id } });

      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        const { content, sectionTitle } = chunks[i];
        await this.prisma.documentChunk.create({
          data: {
            documentId: doc.id,
            chunkIndex: i,
            content,
            sectionTitle,
            tokenCount: estimateTokens(content),
          },
        });
        chunksCreated++;
      }
      documentsProcessed++;
    }

    this.logger.log(`Chunking: ${documentsProcessed} docs, ${chunksCreated} chunks`);
    return { documentsProcessed, chunksCreated };
  }
}
