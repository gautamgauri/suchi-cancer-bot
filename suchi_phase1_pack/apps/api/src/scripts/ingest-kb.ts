/* eslint-disable no-console */
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { PrismaClient } from "@prisma/client";
import { randomUUID, createHash } from "crypto";
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
type Opts = { kbRoot: string; wipeChunks: boolean; maxChunkChars: number; overlapChars: number; dryRun: boolean; skipEmbeddings: boolean };

const prisma = new PrismaClient();

function mustExist(p: string) { if (!fs.existsSync(p)) throw new Error(`Missing: ${p}`); }
function readJson<T>(p: string): T { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; }

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

  await prisma.kbDocument.upsert({
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
  });

  if (opts.wipeChunks) await prisma.kbChunk.deleteMany({ where: { docId: doc.id } });

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

  // Store chunks with embeddings
  for (let i = 0; i < chunks.length; i++) {
    const embedding = embeddings[i];
    // Convert embedding array to pgvector format string: "[0.1,0.2,...]"
    const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;
    
    // Use raw SQL to insert vector data since Prisma doesn't support vectors directly
    if (embeddingStr) {
      const chunkId = randomUUID();
      // Use $executeRawUnsafe for vector type (Prisma doesn't support vector in tagged templates)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "KbChunk" ("id", "docId", "chunkIndex", "content", "embedding", "createdAt")
         VALUES ($1, $2, $3, $4, $5::vector, NOW())`,
        chunkId,
        doc.id,
        i,
        chunks[i],
        embeddingStr
      );
    } else {
      await prisma.kbChunk.create({
        data: { docId: doc.id, chunkIndex: i, content: chunks[i] }
      });
    }
  }
}

async function main() {
  const opts = parseArgs();
  const manifestPath = path.join(opts.kbRoot, "manifest.json");
  mustExist(manifestPath);
  const manifest = readJson<Manifest>(manifestPath);
  const embeddingsStatus = opts.skipEmbeddings ? "disabled" : "enabled";
  console.log(`Suchi KB Ingestion | docs=${manifest.docs.length} | dry=${opts.dryRun} | wipe=${opts.wipeChunks} | embeddings=${embeddingsStatus}`);
  for (const d of manifest.docs) await ingestDoc(d, opts);
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
