/**
 * Local script: chunk SCCF evidence documents via Cloud SQL proxy.
 * Avoids Cloud Run memory limits by processing one doc at a time.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node src/scripts/chunk-sccf-local.ts
 */
import { PrismaClient } from "@prisma/client";

const CHARS_PER_TOKEN = 4;
const TARGET_CHARS_MIN = 400 * CHARS_PER_TOKEN; // 1600
const TARGET_CHARS_MAX = 800 * CHARS_PER_TOKEN; // 3200
const OVERLAP_CHARS = Math.floor(600 * CHARS_PER_TOKEN * 0.12); // ~288

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / CHARS_PER_TOKEN);
}

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

async function main() {
  const prisma = new PrismaClient();

  // Find unchunked evidence docs (Tier A/B with cleanText, no existing chunks)
  const unchunkedIds = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT ed.id
    FROM "EvidenceDocument" ed
    LEFT JOIN "DocumentChunk" dc ON dc."documentId" = ed.id
    WHERE ed."qualityTier" IN ('A', 'B')
      AND ed."cleanText" IS NOT NULL
      AND dc.id IS NULL
      AND (ed."canonicalDocId" IS NULL OR ed."canonicalDocId" = ed.id)
    ORDER BY ed."createdAt" ASC
  `;

  console.log(`Found ${unchunkedIds.length} unchunked documents`);

  let totalDocs = 0;
  let totalChunks = 0;

  for (const { id } of unchunkedIds) {
    // Load one doc at a time to keep memory low
    const doc = await prisma.evidenceDocument.findUnique({
      where: { id },
      select: { id: true, name: true, cleanText: true, cleanTextRedacted: true },
    });
    if (!doc) continue;

    const text = (doc.cleanTextRedacted ?? doc.cleanText)?.trim();
    if (!text) continue;

    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      const { content, sectionTitle } = chunks[i];
      await prisma.documentChunk.create({
        data: {
          documentId: doc.id,
          chunkIndex: i,
          content,
          sectionTitle,
          tokenCount: estimateTokens(content),
        },
      });
      totalChunks++;
    }
    totalDocs++;

    if (totalDocs % 20 === 0) {
      console.log(`Progress: ${totalDocs}/${unchunkedIds.length} docs, ${totalChunks} chunks`);
    }
  }

  console.log(`\nDone: ${totalDocs} docs chunked, ${totalChunks} chunks created`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
