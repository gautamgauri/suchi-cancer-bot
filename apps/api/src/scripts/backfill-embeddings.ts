/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const API_KEY = process.env.GEMINI_API_KEY || process.env.EMBEDDING_API_KEY;
const MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
const DIMENSIONS = 768;
const BATCH_SIZE = 20; // chunks per batch
const RATE_DELAY_MS = 250; // ms between batches

async function generateEmbedding(text: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API ${res.status}: ${err}`);
  }

  const data = await res.json();
  if (!data.embedding?.values?.length) {
    throw new Error("Empty embedding returned");
  }
  return data.embedding.values;
}

async function main() {
  if (!API_KEY) {
    console.error("Set GEMINI_API_KEY or EMBEDDING_API_KEY");
    process.exit(1);
  }

  // Count work
  const totalResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "KbChunk" WHERE embedding IS NULL`;
  const total = Number(totalResult[0].count);

  const doneResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "KbChunk" WHERE embedding IS NOT NULL`;
  const alreadyDone = Number(doneResult[0].count);

  console.log(`Backfill embeddings | model=${MODEL} | dim=${DIMENSIONS}`);
  console.log(`  Chunks needing embeddings: ${total}`);
  console.log(`  Chunks already embedded:   ${alreadyDone}`);

  if (total === 0) {
    console.log("\nNothing to do.");
    return;
  }

  let processed = 0;
  let errors = 0;

  // Process in pages
  while (processed < total) {
    const chunks = await prisma.$queryRaw<{ id: string; content: string }[]>`
      SELECT id, content FROM "KbChunk"
      WHERE embedding IS NULL
      ORDER BY id
      LIMIT ${BATCH_SIZE}`;

    if (chunks.length === 0) break;

    // Generate embeddings concurrently within batch
    const results = await Promise.allSettled(
      chunks.map(async (chunk) => {
        const embedding = await generateEmbedding(chunk.content);
        const embeddingStr = `[${embedding.join(",")}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE "KbChunk" SET embedding = $1::vector WHERE id = $2`,
          embeddingStr,
          chunk.id,
        );
        return chunk.id;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        processed++;
      } else {
        errors++;
        console.error(`  ✗ ${r.reason}`);
      }
    }

    const pct = ((processed / total) * 100).toFixed(1);
    process.stdout.write(`\r  Progress: ${processed}/${total} (${pct}%)  errors: ${errors}`);

    // Rate limit
    await new Promise((r) => setTimeout(r, RATE_DELAY_MS));
  }

  console.log(`\n\n✓ Backfill complete: ${processed} embedded, ${errors} errors`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
