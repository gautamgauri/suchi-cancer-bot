/* eslint-disable no-console */
/**
 * Funding KB Ingestion Script
 *
 * Reads markdown files from kb_funding/, chunks content, generates embeddings,
 * and stores in EvidenceDocument + DocumentChunk + ChunkEmbedding tables.
 *
 * Follows the Suchi ingest-kb.ts pattern for consistency.
 *
 * Usage:
 *   npm run kb:ingest-funding              # Normal run with resume support
 *   npm run kb:ingest-funding:dry          # Dry run (no DB writes)
 *   npm run kb:ingest-funding:fresh        # Wipe and re-ingest
 *   npm run kb:ingest-funding:no-embeddings # Skip embedding generation
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import OpenAI from "openai";
import { inferCorpus } from "../modules/evidence_ingest/corpus.constants";
import { debugLog } from "../modules/evidence_ingest/debug-log";

// Types
type ManifestDoc = {
  id: string;
  title: string;
  sourceType: string;
  source: string;
  driveFileId: string;
  path: string;
  docType: string;
  program?: string;
  qualityTier: string;
  qualityScore?: number;
  lastModified: string;
  status?: "active" | "inactive" | "deprecated";
};

type Manifest = {
  locale?: string;
  schemaVersion?: string;
  docs: ManifestDoc[];
};

type Opts = {
  kbRoot: string;
  wipeChunks: boolean;
  maxChunkChars: number;
  overlapChars: number;
  dryRun: boolean;
  skipEmbeddings: boolean;
  resume: boolean;
  confirmWipe: boolean;
};

type Checkpoint = {
  docIndex: number;
  chunkIndex: number;
  timestamp: string;
};

const prisma = new PrismaClient();

// Initialize OpenAI client for embeddings
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (openai) return openai;

  const apiKey = process.env.FUNDING_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("Warning: No FUNDING_OPENAI_API_KEY or OPENAI_API_KEY found. Skipping embeddings.");
    return null;
  }

  openai = new OpenAI({ apiKey });
  return openai;
}

// Retry database operations on connection failures
async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error as Error;
      const errorCode = (error as { code?: string })?.code;
      const errorMessage = (error as Error)?.message;

      // Retry on connection errors
      if (errorCode === "P1017" || errorCode === "P1001" || errorMessage?.includes("connection")) {
        console.log(`  Warning: Connection error (attempt ${attempt}/${maxRetries}), reconnecting...`);
        await prisma.$disconnect();
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// SAFETY: Check existing data before wipe operations
async function checkExistingData() {
  const docCount = await prisma.evidenceDocument.count();
  const chunkCount = await prisma.documentChunk.count();
  const embeddingCount = await prisma.chunkEmbedding.count();
  return { docCount, chunkCount, embeddingCount };
}

function mustExist(p: string) {
  if (!fs.existsSync(p)) throw new Error(`Missing: ${p}`);
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

// Checkpoint management for resume-safe ingestion
const CHECKPOINT_FILE = path.join(process.cwd(), ".funding-ingestion-checkpoint.json");

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

/**
 * Normalize content for stable hashing
 */
function normalizeContent(content: string): string {
  let normalized = content;

  // 1. Strip NUL bytes (PostgreSQL rejects 0x00 in TEXT columns)
  normalized = normalized.replace(/\0/g, "");

  // 2. Normalize line endings to \n
  normalized = normalized.replace(/\r\n/g, "\n");

  // 2. Trim trailing whitespace per line
  normalized = normalized.split("\n")
    .map(line => line.trimEnd())
    .join("\n");

  // 3. Collapse 3+ blank lines to 2
  normalized = normalized.replace(/\n{3,}/g, "\n\n");

  // 4. Trim overall content
  normalized = normalized.trim();

  return normalized;
}

/**
 * Chunk markdown by headers, with size limits and overlap
 */
function chunkMarkdown(md: string, maxChars: number, overlapChars: number): string[] {
  const normalized = md.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split on markdown headers
  const parts = normalized.split(/\n(?=#{1,6}\s)/g);

  const chunks: string[] = [];
  let buf = "";

  const push = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };

  for (const part of parts) {
    if ((buf + "\n\n" + part).length <= maxChars) {
      buf = buf ? buf + "\n\n" + part : part;
    } else {
      push();
      if (part.length <= maxChars) {
        buf = part;
      } else {
        // Part too long - split with overlap
        let i = 0;
        while (i < part.length) {
          chunks.push(part.slice(i, i + maxChars).trim());
          i += Math.max(1, maxChars - overlapChars);
        }
      }
    }
  }
  push();
  return chunks;
}

function parseArgs(): Opts {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const i = args.indexOf(k);
    return i === -1 ? undefined : args[i + 1];
  };
  const flag = (k: string) => args.includes(k);

  return {
    kbRoot: get("--kbRoot") || path.resolve(process.cwd(), "../../kb_funding"),
    wipeChunks: flag("--wipeChunks"),
    dryRun: flag("--dryRun"),
    skipEmbeddings: flag("--skipEmbeddings"),
    resume: flag("--resume"),
    confirmWipe: flag("--confirmWipe"),
    maxChunkChars: Number(get("--maxChunkChars") || "1400"),
    overlapChars: Number(get("--overlapChars") || "200"),
  };
}

function parseDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Generate embedding using OpenAI API
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  const client = getOpenAIClient();
  if (!client) return null;

  try {
    // #region agent log
    debugLog({ location: "ingest-funding-kb.ts:generateEmbeddingBefore", message: "script before embeddings.create", data: { textLen: text?.length }, hypothesisId: "H2" });
    // #endregion
    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    // #region agent log
    const dataLen = response?.data?.length ?? -1;
    const firstLen = response?.data?.[0]?.embedding?.length ?? -1;
    debugLog({ location: "ingest-funding-kb.ts:generateEmbeddingAfter", message: "script after embeddings.create", data: { dataLen, firstLen }, hypothesisId: "H3" });
    // #endregion
    const embedding = response?.data?.[0]?.embedding ?? null;
    return Array.isArray(embedding) ? embedding : null;
  } catch (error) {
    // #region agent log
    debugLog({ location: "ingest-funding-kb.ts:generateEmbeddingCatch", message: "script embedding error", data: { errMsg: (error as Error).message }, hypothesisId: "H2_H3" });
    // #endregion
    console.error(`  Error generating embedding: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Process a single document from manifest
 */
async function ingestDoc(doc: ManifestDoc, opts: Opts) {
  const full = path.join(opts.kbRoot, doc.path);
  mustExist(full);

  const raw = fs.readFileSync(full, "utf-8");
  const parsed = matter(raw);
  const rawContent = parsed.content.trim();

  // Normalize content before hashing
  const normalizedContent = normalizeContent(rawContent);

  // Generate version hash from normalized content
  const versionHash = createHash("sha256")
    .update(normalizedContent)
    .digest("hex")
    .substring(0, 16);

  const sourceInfo = `[${doc.docType}] ${doc.title}`;

  // Check if document exists and is unchanged
  const existingDoc = await withRetry(() =>
    prisma.evidenceDocument.findUnique({
      where: { driveFileId: doc.driveFileId },
      select: { id: true, versionKey: true, needsProcessing: true },
    })
  );

  if (
    existingDoc &&
    existingDoc.versionKey === versionHash &&
    !existingDoc.needsProcessing &&
    !opts.wipeChunks
  ) {
    console.log(`  SKIP ${doc.id} ${sourceInfo} (unchanged hash: ${versionHash})`);
    return;
  }

  // Document is NEW or UPDATED
  const logPrefix = existingDoc ? "UPDATE" : "NEW";
  const chunks = chunkMarkdown(normalizedContent, opts.maxChunkChars, opts.overlapChars);

  console.log(`  ${logPrefix} ${doc.id} ${sourceInfo} (hash: ${versionHash}, ${chunks.length} chunks)`);
  if (opts.dryRun) return;

  const modifiedDate = parseDate(doc.lastModified) || new Date();
  const now = new Date();

  // Upsert EvidenceDocument
  const evidenceDoc = await withRetry(() =>
    prisma.evidenceDocument.upsert({
      where: { driveFileId: doc.driveFileId },
      update: {
        name: doc.title,
        sourceFolder: doc.sourceType,
        docType: doc.docType,
        program: doc.program,
        qualityTier: doc.qualityTier,
        qualityScore: doc.qualityScore,
        corpus: inferCorpus(doc.sourceType, doc.title, doc.docType),
        versionKey: versionHash,
        modifiedTime: modifiedDate,
        needsProcessing: false,
        cleanText: normalizedContent,
        extractionStatus: "success",
        updatedAt: now,
      },
      create: {
        driveFileId: doc.driveFileId,
        name: doc.title,
        sourceFolder: doc.sourceType,
        mimeType: "text/markdown",
        createdTime: modifiedDate,
        modifiedTime: modifiedDate,
        docType: doc.docType,
        program: doc.program,
        qualityTier: doc.qualityTier,
        qualityScore: doc.qualityScore,
        corpus: inferCorpus(doc.sourceType, doc.title, doc.docType),
        versionKey: versionHash,
        needsProcessing: false,
        cleanText: normalizedContent,
        extractionStatus: "success",
        canonicalDocId: doc.id,
      },
    })
  );

  // Wipe existing chunks if requested
  if (opts.wipeChunks && opts.confirmWipe) {
    await prisma.documentChunk.deleteMany({ where: { documentId: evidenceDoc.id } });
  } else if (opts.wipeChunks && !opts.confirmWipe) {
    throw new Error("SAFETY: --wipeChunks requires --confirmWipe flag");
  }

  // Generate embeddings if not skipped
  let embeddings: (number[] | null)[] = [];
  if (!opts.skipEmbeddings && !opts.dryRun) {
    console.log(`  Generating embeddings for ${chunks.length} chunks...`);
    try {
      // Generate embeddings in batches
      const batchSize = 5;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchEmbeddings = await Promise.all(
          batch.map(chunk => generateEmbedding(chunk))
        );
        embeddings.push(...batchEmbeddings);

        if (i + batchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 200)); // Rate limit
        }
      }
      const successCount = embeddings.filter(e => e !== null).length;
      console.log(`  Generated ${successCount}/${embeddings.length} embeddings`);
    } catch (error) {
      console.error(`  Error generating embeddings: ${(error as Error).message}`);
      embeddings = chunks.map(() => null);
    }
  } else {
    embeddings = chunks.map(() => null);
  }

  // Delete existing chunks for this document before creating new ones
  await withRetry(() =>
    prisma.documentChunk.deleteMany({
      where: { documentId: evidenceDoc.id },
    })
  );

  // Store chunks with embeddings
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = generateChunkId(doc.id, i);
    const embedding = embeddings[i];

    // Create DocumentChunk
    const chunk = await withRetry(() =>
      prisma.documentChunk.create({
        data: {
          documentId: evidenceDoc.id,
          chunkIndex: i,
          content: chunks[i],
          tokenCount: Math.ceil(chunks[i].length / 4), // Rough estimate
        },
      })
    );

    // Store embedding if generated
    if (embedding) {
      const embeddingStr = JSON.stringify(embedding);
      await withRetry(() =>
        prisma.chunkEmbedding.upsert({
          where: { chunkId: chunk.id },
          update: {
            vector: embeddingStr,
            embeddingModel: "text-embedding-3-small",
            updatedAt: now,
          },
          create: {
            chunkId: chunk.id,
            vector: embeddingStr,
            embeddingModel: "text-embedding-3-small",
          },
        })
      );
    }
  }
}

async function main() {
  try {
    fs.appendFileSync(
      path.join(require("os").tmpdir(), "debug-302c0b.log"),
      JSON.stringify({ sessionId: "302c0b", message: "ingest-funding-kb main() started", timestamp: Date.now() }) + "\n",
    );
  } catch {
    // ignore
  }
  const opts = parseArgs();
  const manifestPath = path.join(opts.kbRoot, "manifest.json");
  mustExist(manifestPath);

  const manifest = readJson<Manifest>(manifestPath);
  const embeddingsStatus = opts.skipEmbeddings ? "disabled" : "enabled";

  // Filter to only active documents
  const activeDocs = manifest.docs.filter(d => d.status !== "deprecated" && d.status !== "inactive");

  // SAFETY: Check existing data and warn before destructive operations
  if (opts.wipeChunks) {
    const existing = await checkExistingData();
    console.log("\nWARNING: DESTRUCTIVE OPERATION REQUESTED");
    console.log(`   Current database state:`);
    console.log(`   - Documents: ${existing.docCount}`);
    console.log(`   - Total chunks: ${existing.chunkCount}`);
    console.log(`   - Embeddings: ${existing.embeddingCount}`);
    console.log(`\n   --wipeChunks will DELETE all chunks!`);

    if (!opts.confirmWipe) {
      console.error("\nSAFETY CHECK FAILED:");
      console.error("   --wipeChunks requires --confirmWipe flag to proceed.");
      process.exit(1);
    }

    console.log(`\n  Confirmation received. Proceeding with wipe operation...\n`);
  }

  // Load checkpoint if resuming
  let checkpoint: Checkpoint = { docIndex: 0, chunkIndex: 0, timestamp: new Date().toISOString() };
  if (opts.resume) {
    checkpoint = loadCheckpoint();
    console.log(`Resuming from checkpoint: doc ${checkpoint.docIndex + 1}/${activeDocs.length} (${checkpoint.timestamp})`);
  } else {
    clearCheckpoint();
  }

  console.log(`Funding KB Ingestion | docs=${activeDocs.length} | dry=${opts.dryRun} | wipe=${opts.wipeChunks} | embeddings=${embeddingsStatus} | resume=${opts.resume}`);

  // Process documents from checkpoint
  for (let docIndex = checkpoint.docIndex; docIndex < activeDocs.length; docIndex++) {
    await ingestDoc(activeDocs[docIndex], opts);

    // Save checkpoint after each document
    if (!opts.dryRun) {
      saveCheckpoint({ docIndex: docIndex + 1, chunkIndex: 0, timestamp: new Date().toISOString() });
    }
  }

  clearCheckpoint();
  console.log("\nIngestion complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
