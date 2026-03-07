/**
 * Local script: chunk personal (orgId=gautam) evidence documents.
 * Handles large documents by truncating text in SQL before loading.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx ts-node src/scripts/chunk-personal-local.ts
 */
import { PrismaClient } from "@prisma/client";

const CHARS_PER_TOKEN = 4;
const TARGET_CHARS_MIN = 400 * CHARS_PER_TOKEN; // 1600
const TARGET_CHARS_MAX = 800 * CHARS_PER_TOKEN; // 3200
const OVERLAP_CHARS = Math.floor(600 * CHARS_PER_TOKEN * 0.12); // ~288
const MAX_TEXT_CHARS = 200_000; // Truncate at 200K chars (~50K tokens)

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

  // Get IDs + truncated text for unchunked docs, one at a time
  // Use raw SQL to truncate text server-side (avoids loading 11MB into Node)
  const BATCH = 20;
  let totalDocs = 0;
  let totalChunks = 0;
  let skipped = 0;

  while (true) {
    // Find next batch of unchunked docs (re-query each time since we create chunks)
    const batch = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT ed.id, ed.name
      FROM "EvidenceDocument" ed
      WHERE ed."qualityTier" IN ('A', 'B')
        AND ed."cleanText" IS NOT NULL
        AND (ed."canonicalDocId" IS NULL OR ed."canonicalDocId" = ed.id)
        AND NOT EXISTS (SELECT 1 FROM "DocumentChunk" dc WHERE dc."documentId" = ed.id)
      ORDER BY ed.id ASC
      LIMIT ${BATCH}
    `;

    if (batch.length === 0) break;

    for (const { id, name } of batch) {
      // Load text truncated at SQL level
      const rows = await prisma.$queryRaw<Array<{ text: string | null }>>`
        SELECT LEFT(COALESCE("cleanTextRedacted", "cleanText"), 200000) as text
        FROM "EvidenceDocument"
        WHERE id::text = ${id}
      `;

      const text = rows[0]?.text?.trim();
      if (!text) {
        skipped++;
        continue;
      }

      const chunks = chunkText(text);
      if (chunks.length === 0) {
        skipped++;
        continue;
      }

      // Write chunks in batches
      const WRITE_BATCH = 50;
      for (let start = 0; start < chunks.length; start += WRITE_BATCH) {
        const slice = chunks.slice(start, start + WRITE_BATCH);
        await prisma.documentChunk.createMany({
          data: slice.map((c, i) => ({
            documentId: id,
            chunkIndex: start + i,
            content: c.content,
            sectionTitle: c.sectionTitle,
            tokenCount: estimateTokens(c.content),
          })),
        });
      }

      totalChunks += chunks.length;
      totalDocs++;

      if (totalDocs % 50 === 0) {
        console.log(`Progress: ${totalDocs} docs, ${totalChunks} chunks, ${skipped} skipped`);
      }
    }
  }

  console.log(`\nDone: ${totalDocs} docs chunked, ${totalChunks} chunks created, ${skipped} skipped`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
