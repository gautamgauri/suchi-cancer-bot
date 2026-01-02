/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { isTrustedSource } from "../config/trusted-sources.config";

type ManifestDoc = {
  id: string;
  title: string;
  version: string;
  status?: "active" | "inactive" | "deprecated";
  source?: string;
  sourceType?: string;
  path: string;
  license?: string;
  lastReviewed?: string; // ISO date string
  reviewFrequency?: "quarterly" | "annual" | "monthly" | "as_needed";
  audienceLevel?: "patient" | "caregiver" | "general" | "technical";
  language?: string;
  cancerTypes?: string[];
  tags?: string[];
  url?: string;
  citation?: string;
};
type Manifest = { locale?: string; schemaVersion?: string; docs: ManifestDoc[] };
type Opts = { kbRoot: string; wipeChunks: boolean; maxChunkChars: number; overlapChars: number; dryRun: boolean; skipEmbeddings: boolean; resume: boolean; confirmWipe: boolean };
type Checkpoint = { docIndex: number; chunkIndex: number; timestamp: string };

const prisma = new PrismaClient();

// Retry database operations on connection failures
async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      // Retry on connection errors
      if (error.code === 'P1017' || error.code === 'P1001' || error.message?.includes('connection')) {
        console.log(`  ⚠️  Connection error (attempt ${attempt}/${maxRetries}), reconnecting...`);
        await prisma.$disconnect();
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        continue;
      }
      throw error; // Don't retry other errors
    }
  }
  throw lastError;
}

// SAFETY: Check existing data before wipe operations
async function checkExistingData() {
  const docCount = await prisma.kbDocument.count();
  const chunkCount = await prisma.kbChunk.count();
  const embeddedResult = await prisma.$queryRaw<[{ count: bigint }]>`SELECT COUNT(*) as count FROM "KbChunk" WHERE embedding IS NOT NULL`;
  const embeddedCount = Number(embeddedResult[0].count);
  return { docCount, chunkCount, embeddedCount };
}

function mustExist(p: string) { if (!fs.existsSync(p)) throw new Error(`Missing: ${p}`); }
function readJson<T>(p: string): T { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; }

// Checkpoint management for resume-safe ingestion
const CHECKPOINT_FILE = path.join(process.cwd(), ".ingestion-checkpoint.json");

function loadCheckpoint(): Checkpoint {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    } catch {
      return { docIndex: 0, chunkIndex: 0, timestamp: new Date().toISOString() };
    }
  }
  return { docIndex: 0, chunkIndex: 0, timestamp: new Date().toISOString() };
}

function saveCheckpoint(state: Checkpoint): void {
  const tmpFile = CHECKPOINT_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify({ ...state, timestamp: new Date().toISOString() }, null, 2));
  fs.renameSync(tmpFile, CHECKPOINT_FILE);
}

function clearCheckpoint(): void {
  if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
}

// Generate deterministic chunk ID
function generateChunkId(docId: string, chunkIndex: number): string {
  return `${docId}::chunk::${chunkIndex}`;
}

function chunkMarkdown(md: string, maxChars: number, overlapChars: number): string[] {
  const normalized = md.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const parts = normalized.split(/\n(?=#{1,6}\s)/g);

  const chunks: string[] = [];
  let buf = "";
  const push = () => { const t = buf.trim(); if (t) chunks.push(t); buf = ""; };

  for (const part of parts) {
    if ((buf + "\n\n" + part).length <= maxChars) buf = buf ? buf + "\n\n" + part : part;
    else { push(); if (part.length <= maxChars) buf = part; else {
      let i = 0;
      while (i < part.length) {
        chunks.push(part.slice(i, i + maxChars).trim());
        i += Math.max(1, maxChars - overlapChars);
      }
    }}
  }
  push();
  return chunks;
}

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const get = (k: string) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i+1]; };
  const flag = (k: string) => args.includes(k);

  return {
    kbRoot: get("--kbRoot") || path.resolve(process.cwd(), "../../kb"),
    wipeChunks: flag("--wipeChunks"),
    dryRun: flag("--dryRun"),
    skipEmbeddings: flag("--skipEmbeddings"),
    resume: flag("--resume"),
    confirmWipe: flag("--confirmWipe"),
    maxChunkChars: Number(get("--maxChunkChars") || "1400"),
    overlapChars: Number(get("--overlapChars") || "200")
  };
}

function parseDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function generateEmbedding(text: string, apiKey: string, modelName: string): Promise<number[]> {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: `models/${modelName}`,
      content: {
        parts: [{ text: text }]
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Embeddings API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.embedding?.values || data.embedding.values.length === 0) {
    throw new Error("Empty embedding returned from API");
  }

  return data.embedding.values;
}

async function ingestDoc(doc: ManifestDoc, opts: Opts) {
  const full = path.join(opts.kbRoot, doc.path);
  mustExist(full);
  const raw = fs.readFileSync(full, "utf-8");
  const parsed = matter(raw);
  const content = parsed.content.trim();

  const chunks = chunkMarkdown(content, opts.maxChunkChars, opts.overlapChars);

  const sourceInfo = `[${doc.sourceType || "unknown"}] ${doc.source || "Unknown"}`;
  console.log(`\n[DOC] ${doc.id}  ${sourceInfo}  (${chunks.length} chunks)`);
  if (opts.dryRun) return;

  const lastReviewedDate = parseDate(doc.lastReviewed);
  
  // Determine if source is trusted
  const isTrusted = doc.sourceType ? isTrustedSource(doc.sourceType) : false;
  
  // Generate version hash from content for change detection
  const versionHash = createHash("sha256").update(content).digest("hex").substring(0, 16);
  
  // Determine publisher and jurisdiction based on sourceType
  let publisher: string | undefined;
  let jurisdiction: string | undefined;
  
  if (doc.sourceType) {
    const sourceTypeMap: Record<string, { publisher: string; jurisdiction?: string }> = {
      "01_suchi_oncotalks": { publisher: "SCCF", jurisdiction: "India" },
      "02_nci_core": { publisher: "National Cancer Institute", jurisdiction: "USA" },
      "03_who_public_health": { publisher: "World Health Organization", jurisdiction: "Global" },
      "04_iarc_stats": { publisher: "IARC", jurisdiction: "Global" },
      "05_india_ncg": { publisher: "National Cancer Grid", jurisdiction: "India" },
      "06_pmc_selective": { publisher: "PMC", jurisdiction: "Global" },
      "99_local_navigation": { publisher: "SCCF", jurisdiction: "India" }
    };
    
    const sourceInfo = sourceTypeMap[doc.sourceType];
    if (sourceInfo) {
      publisher = sourceInfo.publisher;
      jurisdiction = sourceInfo.jurisdiction;
    }
  }

  const now = new Date();

  await withRetry(() => prisma.kbDocument.upsert({
    where: { id: doc.id },
    update: {
      title: doc.title,
      source: doc.source,
      sourceType: doc.sourceType,
      version: doc.version,
      status: doc.status ?? "active",
      license: doc.license,
      lastReviewed: lastReviewedDate,
      reviewFrequency: doc.reviewFrequency,
      audienceLevel: doc.audienceLevel,
      language: doc.language ?? "en",
      cancerTypes: doc.cancerTypes ?? [],
      tags: doc.tags ?? [],
      url: doc.url,
      citation: doc.citation,
      isTrustedSource: isTrusted,
      versionHash: versionHash,
      publisher: publisher,
      jurisdiction: jurisdiction,
      retrievedDate: now
    },
    create: {
      id: doc.id,
      title: doc.title,
      source: doc.source,
      sourceType: doc.sourceType,
      version: doc.version,
      status: doc.status ?? "active",
      license: doc.license,
      lastReviewed: lastReviewedDate,
      reviewFrequency: doc.reviewFrequency,
      audienceLevel: doc.audienceLevel,
      language: doc.language ?? "en",
      cancerTypes: doc.cancerTypes ?? [],
      tags: doc.tags ?? [],
      url: doc.url,
      citation: doc.citation,
      isTrustedSource: isTrusted,
      versionHash: versionHash,
      publisher: publisher,
      jurisdiction: jurisdiction,
      retrievedDate: now
    }
  }));

  // SAFETY: Only wipe if explicitly confirmed
  if (opts.wipeChunks && opts.confirmWipe) {
    await prisma.kbChunk.deleteMany({ where: { docId: doc.id } });
  } else if (opts.wipeChunks && !opts.confirmWipe) {
    throw new Error("SAFETY: --wipeChunks requires --confirmWipe flag to prevent accidental data loss");
  }

  // Generate embeddings if not skipped
  let embeddings: (number[] | null)[] = [];
  if (!opts.skipEmbeddings && !opts.dryRun) {
    const apiKey = process.env.EMBEDDING_API_KEY || process.env.GEMINI_API_KEY;
    const modelName = process.env.EMBEDDING_MODEL || "text-embedding-004";
    
    if (!apiKey) {
      console.warn("Warning: No EMBEDDING_API_KEY or GEMINI_API_KEY found. Skipping embeddings.");
      embeddings = chunks.map(() => null);
    } else {
      console.log(`  Generating embeddings for ${chunks.length} chunks...`);
      try {
        // Generate embeddings in batches
        const batchSize = 5;
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          const batchEmbeddings = await Promise.all(
            batch.map(chunk => generateEmbedding(chunk, apiKey, modelName))
          );
          embeddings.push(...batchEmbeddings);
          
          if (i + batchSize < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit delay
          }
        }
        console.log(`  ✓ Generated ${embeddings.length} embeddings`);
      } catch (error) {
        console.error(`  ✗ Error generating embeddings: ${error.message}`);
        embeddings = chunks.map(() => null); // Continue without embeddings
      }
    }
  } else {
    embeddings = chunks.map(() => null);
  }

  // Store chunks with embeddings (UPSERT for idempotency)
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = generateChunkId(doc.id, i); // Deterministic ID
    const embedding = embeddings[i];
    // Convert embedding array to pgvector format string: "[0.1,0.2,...]"
    const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

    // Use UPSERT (ON CONFLICT) for idempotency with retry on connection errors
    if (embeddingStr) {
      await withRetry(() => prisma.$executeRawUnsafe(
        `INSERT INTO "KbChunk" ("id", "docId", "chunkIndex", "content", "embedding", "createdAt")
         VALUES ($1, $2, $3, $4, $5::vector, NOW())
         ON CONFLICT ("id") DO UPDATE SET
           "content" = EXCLUDED."content",
           "embedding" = EXCLUDED."embedding",
           "createdAt" = NOW()`,
        chunkId,
        doc.id,
        i,
        chunks[i],
        embeddingStr
      ));
    } else {
      await withRetry(() => prisma.$executeRawUnsafe(
        `INSERT INTO "KbChunk" ("id", "docId", "chunkIndex", "content", "createdAt")
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT ("id") DO UPDATE SET
           "content" = EXCLUDED."content",
           "createdAt" = NOW()`,
        chunkId,
        doc.id,
        i,
        chunks[i]
      ));
    }
  }
}

async function main() {
  const opts = parseArgs();
  const manifestPath = path.join(opts.kbRoot, "manifest.json");
  mustExist(manifestPath);
  const manifest = readJson<Manifest>(manifestPath);
  const embeddingsStatus = opts.skipEmbeddings ? "disabled" : "enabled";

  // SAFETY: Check existing data and warn before destructive operations
  if (opts.wipeChunks) {
    const existing = await checkExistingData();
    console.log("\n⚠️  WARNING: DESTRUCTIVE OPERATION REQUESTED");
    console.log(`   Current database state:`);
    console.log(`   - Documents: ${existing.docCount}`);
    console.log(`   - Total chunks: ${existing.chunkCount}`);
    console.log(`   - Chunks with embeddings: ${existing.embeddedCount}`);
    console.log(`\n   --wipeChunks will DELETE all ${existing.chunkCount} chunks!`);

    if (!opts.confirmWipe) {
      console.error("\n❌ SAFETY CHECK FAILED:");
      console.error("   --wipeChunks requires --confirmWipe flag to proceed.");
      console.error("   This prevents accidental data loss.\n");
      console.error("   To confirm deletion, add: --confirmWipe");
      console.error("   Example: npm run kb:ingest -- --wipeChunks --confirmWipe\n");
      process.exit(1);
    }

    console.log(`\n✓  Confirmation received. Proceeding with wipe operation...\n`);
  }

  // Load checkpoint if resuming
  let checkpoint: Checkpoint = { docIndex: 0, chunkIndex: 0, timestamp: new Date().toISOString() };
  if (opts.resume) {
    checkpoint = loadCheckpoint();
    console.log(`Resuming from checkpoint: doc ${checkpoint.docIndex + 1}/${manifest.docs.length} (${checkpoint.timestamp})`);
  } else {
    clearCheckpoint(); // Start fresh
  }

  console.log(`Suchi KB Ingestion | docs=${manifest.docs.length} | dry=${opts.dryRun} | wipe=${opts.wipeChunks} | embeddings=${embeddingsStatus} | resume=${opts.resume}`);

  // Process documents from checkpoint
  for (let docIndex = checkpoint.docIndex; docIndex < manifest.docs.length; docIndex++) {
    await ingestDoc(manifest.docs[docIndex], opts);

    // Save checkpoint after each document (every 1 doc)
    if (!opts.dryRun) {
      saveCheckpoint({ docIndex: docIndex + 1, chunkIndex: 0, timestamp: new Date().toISOString() });
    }
  }

  clearCheckpoint(); // Success - clear checkpoint
  console.log("\n✓ Ingestion complete!");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
