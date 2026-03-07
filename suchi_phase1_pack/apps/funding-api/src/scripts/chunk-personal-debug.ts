/**
 * Instrumented chunking script — find the OOM culprit.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node --max-old-space-size=4096 --expose-gc \
 *     ./node_modules/.bin/ts-node --transpile-only src/scripts/chunk-personal-debug.ts
 */
import { PrismaClient } from "@prisma/client";

console.log("CHUNK SCRIPT START", new Date().toISOString());

const CHARS_PER_TOKEN = 4;
const TARGET_CHARS_MIN = 1600;
const TARGET_CHARS_MAX = 3200;
const OVERLAP_CHARS = 288;
const MAX_TEXT_CHARS = 200_000;

function mem(label: string) {
  const m = process.memoryUsage();
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;
  console.log(`[mem] ${label} rss=${mb(m.rss)} heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}`);
}

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / CHARS_PER_TOKEN);
}

function chunkText(text: string): Array<{ content: string; sectionTitle: string | null }> {
  if (!text?.trim()) return [];
  const lines = text.split("\n");
  const chunks: Array<{ content: string; sectionTitle: string | null }> = [];
  let lineStart = 0;

  while (lineStart < lines.length) {
    const prevLineStart = lineStart;
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
    chunks.push({ content, sectionTitle: null });
    if (lineStart >= lines.length) break;

    // Calculate overlap rewind, but NEVER rewind past where we started
    const avgLineLen = length / segment.length || 1;
    const overlapLineCount = Math.min(
      segment.length - 1, // always advance at least 1 line
      Math.max(0, Math.ceil(OVERLAP_CHARS / avgLineLen)),
    );
    lineStart = Math.max(prevLineStart + 1, lineStart - overlapLineCount);

    // Guard: stop runaway chunking
    if (chunks.length > 500) {
      console.error(`GUARD: >500 chunks at line ${lineStart}/${lines.length}, truncating`);
      break;
    }
  }

  return chunks;
}

async function main() {
  mem("init");
  const prisma = new PrismaClient();
  mem("prisma created");

  let totalDocs = 0;
  let totalChunks = 0;
  let skippedDocs = 0;
  let batchNum = 0;
  let afterId = "";

  while (true) {
    batchNum++;
    mem(`batch ${batchNum} start (afterId=${afterId.slice(0,8)||"none"})`);

    // Step 1: Get IDs only — use cursor to never re-fetch skipped docs
    const ids = afterId
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT ed.id FROM "EvidenceDocument" ed
          WHERE ed."qualityTier" IN ('A', 'B')
            AND ed."cleanText" IS NOT NULL
            AND (ed."canonicalDocId" IS NULL OR ed."canonicalDocId" = ed.id)
            AND ed.id::text > ${afterId}
          ORDER BY ed.id ASC LIMIT 20
        `
      : await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT ed.id FROM "EvidenceDocument" ed
          WHERE ed."qualityTier" IN ('A', 'B')
            AND ed."cleanText" IS NOT NULL
            AND (ed."canonicalDocId" IS NULL OR ed."canonicalDocId" = ed.id)
          ORDER BY ed.id ASC LIMIT 20
        `;
    mem(`batch ${batchNum} got ${ids.length} IDs`);

    if (ids.length === 0) break;

    for (let j = 0; j < ids.length; j++) {
      const id = ids[j].id;
      afterId = id; // advance cursor regardless

      // Step 1.5: Skip if already chunked
      const existingChunks = await prisma.$queryRaw<Array<{ cnt: number }>>`
        SELECT COUNT(*)::int as cnt FROM "DocumentChunk" WHERE "documentId"::text = ${id}
      `;
      if ((existingChunks[0]?.cnt ?? 0) > 0) continue;

      // Step 2: Fetch text (truncated server-side)
      const rows = await prisma.$queryRaw<Array<{ text: string | null; full_len: number }>>`
        SELECT LEFT(COALESCE("cleanTextRedacted", "cleanText"), 200000) as text,
               LENGTH(COALESCE("cleanTextRedacted", "cleanText"))::int as full_len
        FROM "EvidenceDocument" WHERE id::text = ${id}
      `;
      const text = rows[0]?.text?.trim();
      const fullLen = rows[0]?.full_len ?? 0;

      if (!text) continue;

      mem(`  doc ${j}/${ids.length} id=${id.slice(0,8)} textLen=${text.length} fullLen=${fullLen}`);

      // Step 3: Chunk
      const chunks = chunkText(text);
      mem(`  after chunk: ${chunks.length} chunks`);

      if (chunks.length === 0) continue;

      // Guard (shouldn't happen now with fixed overlap, but just in case)
      if (chunks.length > 500) {
        console.warn(`SKIP: doc ${id} has ${chunks.length} chunks — binary/corrupt content?`);
        skippedDocs++;
        continue;
      }

      // Step 4: Write per-doc
      const WRITE_BATCH = 200;
      for (let i = 0; i < chunks.length; i += WRITE_BATCH) {
        const slice = chunks.slice(i, i + WRITE_BATCH);
        await prisma.documentChunk.createMany({
          data: slice.map((c, idx) => ({
            documentId: id,
            chunkIndex: i + idx,
            content: c.content,
            sectionTitle: c.sectionTitle,
            tokenCount: estimateTokens(c.content),
          })),
        });
      }
      mem(`  after write`);

      totalChunks += chunks.length;
      totalDocs++;

      // Force GC if available
      if (global.gc) {
        global.gc();
        mem(`  after GC`);
      }
    }

    console.log(`Batch ${batchNum} done: totalDocs=${totalDocs} totalChunks=${totalChunks}`);
  }

  console.log(`\nDone: ${totalDocs} docs, ${totalChunks} chunks, ${skippedDocs} skipped (binary/corrupt)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
