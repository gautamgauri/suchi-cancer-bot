/* eslint-disable no-console */
/**
 * Re-embed KB chunks with Google Gemini (gemini-embedding-001, 768-dim).
 *
 * Use this when:
 *   - KB was previously ingested with OpenAI (1536-dim) vectors
 *   - The native pgvector column (vector(768)) is NULL for all chunks
 *   - Evidence retrieval returns 0 results despite chunks existing in DB
 *
 * What it does:
 *   1. Counts existing ChunkEmbedding records
 *   2. Deletes all ChunkEmbedding records (clearing the stale OpenAI embeddings)
 *   3. Re-embeds all Tier A/B chunks using Google Gemini (768-dim)
 *   4. Writes native pgvector column so retrieval SQL works
 *
 * Requirements:
 *   - Cloud SQL proxy running locally: gcloud cloud-sql-proxy gen-lang-client-0202543132:us-central1:diksha-db --port=5432
 *   - FUNDING_EMBEDDINGS_API_KEY or FUNDING_GEMINI_API_KEY set to a Gemini API key
 *   - DATABASE_URL pointing to the target DB
 *
 * Usage:
 *   npx ts-node src/scripts/reembed-with-gemini.ts
 *   npx ts-node src/scripts/reembed-with-gemini.ts --dry-run   # Count only, no changes
 */

import { PrismaClient } from "@prisma/client";
import { GoogleEmbeddingProvider } from "../modules/evidence_ingest/embedding-provider";

const BATCH_SIZE = 50;
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 3;

const isDryRun = process.argv.includes("--dry-run");

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // Resolve Gemini API key
    const apiKey =
      process.env.FUNDING_GEMINI_API_KEY ||
      process.env.FUNDING_EMBEDDINGS_API_KEY ||
      process.env.FUNDING_OPENAI_API_KEY;

    if (!apiKey || apiKey.startsWith("sk-") || apiKey.startsWith("sk-proj-")) {
      // OpenAI key or no key
      if (apiKey?.startsWith("sk-") || apiKey?.startsWith("sk-proj-")) {
        console.error(
          "ERROR: FUNDING_EMBEDDINGS_API_KEY appears to be an OpenAI key (starts with sk-).",
        );
        console.error(
          "Set FUNDING_GEMINI_API_KEY or FUNDING_EMBEDDINGS_API_KEY to a Google Gemini API key.",
        );
      } else {
        console.error("ERROR: No API key found.");
        console.error("Set FUNDING_GEMINI_API_KEY or FUNDING_EMBEDDINGS_API_KEY.");
      }
      process.exit(1);
    }

    const model = process.env.EVIDENCE_EMBEDDING_MODEL || "gemini-embedding-001";
    console.log(`\nGemini re-embed script`);
    console.log(`  Model : ${model} (768-dim)`);
    console.log(`  Mode  : ${isDryRun ? "DRY RUN (no changes)" : "LIVE"}`);
    console.log(`  DB    : ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`);

    // ── Step 1: Count current state ──────────────────────────────────────
    const totalChunks = await prisma.documentChunk.count();
    const totalEmbeddings = await prisma.chunkEmbedding.count();

    const nullNative = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) FROM "ChunkEmbedding" WHERE "embedding" IS NULL
    `;
    const nullCount = Number(nullNative[0].count);

    const embeddingModels = await prisma.$queryRaw<Array<{ embeddingModel: string; count: bigint }>>`
      SELECT "embeddingModel", COUNT(*) as count FROM "ChunkEmbedding" GROUP BY "embeddingModel"
    `;

    console.log(`\nCurrent DB state:`);
    console.log(`  DocumentChunk records : ${totalChunks}`);
    console.log(`  ChunkEmbedding records: ${totalEmbeddings}`);
    console.log(`  Native vector IS NULL : ${nullCount} (these are the broken ones)`);
    console.log(`  Embedding models used :`);
    for (const row of embeddingModels) {
      console.log(`    ${row.embeddingModel}: ${row.count} records`);
    }

    if (totalEmbeddings === 0) {
      console.log("\nNo ChunkEmbedding records found — nothing to re-embed.");
      console.log("Run the KB ingest script first: npm run kb:ingest-funding");
      return;
    }

    if (nullCount === 0 && totalEmbeddings > 0) {
      console.log(
        "\nAll ChunkEmbedding records have native vector — retrieval should work.",
      );
      console.log("If evidence still returns 0, the issue is elsewhere (orgId filter, tiers, etc.).");
      return;
    }

    if (isDryRun) {
      console.log(`\nDRY RUN: Would delete ${totalEmbeddings} ChunkEmbedding records and re-embed.`);
      console.log("Remove --dry-run flag to apply changes.");
      return;
    }

    // ── Step 2: Delete all ChunkEmbedding records ─────────────────────────
    console.log(`\nStep 2: Deleting ${totalEmbeddings} stale ChunkEmbedding records...`);
    const deleted = await prisma.chunkEmbedding.deleteMany({});
    console.log(`  Deleted: ${deleted.count} records`);

    // ── Step 3: Find all Tier A/B chunks (now without embeddings) ─────────
    const tierAdocs = await prisma.evidenceDocument.findMany({
      where: { qualityTier: { in: ["A", "B"] } },
      select: { id: true, canonicalDocId: true },
    });
    const canonicalSet = new Set(
      tierAdocs
        .filter((d) => d.canonicalDocId === null || d.canonicalDocId === d.id)
        .map((d) => d.id),
    );

    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: { in: [...canonicalSet] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true },
    });

    if (chunks.length === 0) {
      console.log(
        "\nNo Tier A/B chunks found — check that EvidenceDocument records have qualityTier set.",
      );
      return;
    }

    console.log(`\nStep 3: Re-embedding ${chunks.length} Tier A/B chunks with Gemini...`);

    // ── Step 4: Embed in batches ──────────────────────────────────────────
    const provider = new GoogleEmbeddingProvider(apiKey, model);
    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content.slice(0, 10000));

      let lastErr: Error | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const results = await provider.embedBatch(texts);

          for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const vec = results[j]?.embedding;
            if (!vec || vec.length !== 768) {
              console.warn(`  Chunk ${chunk.id}: unexpected vector length ${vec?.length ?? 0}, skipping`);
              failed++;
              continue;
            }

            const embStr = `[${vec.join(",")}]`;

            // Create ChunkEmbedding row
            const row = await prisma.chunkEmbedding.create({
              data: {
                chunkId: chunk.id,
                embeddingModel: model,
                vector: JSON.stringify(vec),
              },
            });

            // Write native pgvector column
            await prisma.$executeRawUnsafe(
              `UPDATE "ChunkEmbedding" SET "embedding" = $1::vector WHERE "id" = $2`,
              embStr,
              row.id,
            );

            embedded++;
          }

          lastErr = null;
          break;
        } catch (e) {
          lastErr = e as Error;
          if (attempt < MAX_RETRIES - 1) {
            console.warn(
              `  Batch ${Math.floor(i / BATCH_SIZE) + 1} attempt ${attempt + 1} failed: ${lastErr.message}. Retrying...`,
            );
            await sleep(RETRY_DELAY_MS * (attempt + 1));
          }
        }
      }

      if (lastErr) {
        failed += batch.length;
        console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} failed after retries: ${lastErr.message}`);
      } else {
        const pct = Math.round(((i + batch.length) / chunks.length) * 100);
        process.stdout.write(
          `\r  Progress: ${i + batch.length}/${chunks.length} (${pct}%) — embedded ${embedded}, failed ${failed}`,
        );
      }

      // Rate limit: ~50 batches/min = ~2500 embeddings/min (well within Gemini free tier)
      if (i + BATCH_SIZE < chunks.length) {
        await sleep(1200);
      }
    }

    console.log(`\n\nDone!`);
    console.log(`  Embedded : ${embedded}`);
    console.log(`  Failed   : ${failed}`);

    // ── Verify ────────────────────────────────────────────────────────────
    const verifyNull = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) FROM "ChunkEmbedding" WHERE "embedding" IS NULL
    `;
    const remainingNull = Number(verifyNull[0].count);
    console.log(`\nVerification: ${remainingNull} ChunkEmbedding records still have NULL native vector`);

    if (remainingNull === 0 && embedded > 0) {
      console.log("✓ All chunks have native 768-dim Gemini vectors — retrieval should now work!");
    } else if (remainingNull > 0) {
      console.warn(`Warning: ${remainingNull} chunks still have NULL vectors. Check errors above.`);
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
