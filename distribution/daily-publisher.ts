/**
 * Distribution Daily Publisher
 *
 * Cloud Run Job / Cloud Scheduler entry point.
 * Finds all queue entries with status "approved", posts them via social-poster,
 * then updates their status to "posted" or "failed".
 *
 * Exit 0 on success (even if some channels failed to post — that's a soft failure).
 * Exit 1 only on fatal errors (cannot load queue, cannot save queue).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { postPack } from "./social-poster";
import { GeneratedPack } from "./generator";

// ---------------------------------------------------------------------------
// GCS helpers — same pattern as navigator-approve.service.ts
// ---------------------------------------------------------------------------

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const GCS_QUEUE_OBJECT = process.env.DIST_QUEUE_GCS_OBJECT ?? "dist-queue.json";
const GCS_PACKS_PREFIX = process.env.DIST_PACKS_GCS_PREFIX ?? "dist-packs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStorage(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const { Storage } = require("@google-cloud/storage") as any;
  return new Storage({ projectId: GCS_PROJECT });
}

async function gcsRead(object: string): Promise<string> {
  const storage = await getStorage();
  const [contents] = await storage.bucket(GCS_BUCKET!).file(object).download() as [Buffer];
  return contents.toString("utf-8");
}

async function gcsWrite(object: string, content: string): Promise<void> {
  const storage = await getStorage();
  await storage.bucket(GCS_BUCKET!).file(object).save(content, { contentType: "application/json" });
}

async function readQueue(localPath: string): Promise<string> {
  if (GCS_BUCKET) {
    console.log(`[daily-publisher] Reading gs://${GCS_BUCKET}/${GCS_QUEUE_OBJECT}`);
    return gcsRead(GCS_QUEUE_OBJECT);
  }
  console.log(`[daily-publisher] Reading local ${localPath}`);
  return fs.readFile(localPath, "utf-8");
}

async function writeQueue(localPath: string, content: string): Promise<void> {
  if (GCS_BUCKET) {
    console.log(`[daily-publisher] Writing gs://${GCS_BUCKET}/${GCS_QUEUE_OBJECT}`);
    await gcsWrite(GCS_QUEUE_OBJECT, content);
  }
  await fs.writeFile(localPath, content, "utf-8").catch(() => undefined);
}

async function loadPackJson(slug: string, packsDir: string): Promise<GeneratedPack> {
  if (GCS_BUCKET) {
    const gcsObject = `${GCS_PACKS_PREFIX}/${slug}.json`;
    console.log(`[daily-publisher] Loading pack gs://${GCS_BUCKET}/${gcsObject}`);
    const raw = await gcsRead(gcsObject);
    return JSON.parse(raw) as GeneratedPack;
  }

  // Local: try exact name, then date-suffixed
  let packPath = path.join(packsDir, `${slug}.json`);
  try {
    await fs.access(packPath);
  } catch {
    const files = await fs.readdir(packsDir).catch(() => [] as string[]);
    const match = files.find((f) => f.startsWith(slug) && f.endsWith(".json"));
    if (!match) throw new Error(`Pack JSON not found for slug "${slug}"`);
    packPath = path.join(packsDir, match);
  }
  const raw = await fs.readFile(packPath, "utf-8");
  return JSON.parse(raw) as GeneratedPack;
}

// ---------------------------------------------------------------------------
// Types (inline to avoid cross-tree import issues)
// ---------------------------------------------------------------------------

type QueueStatus =
  | "pending"
  | "generated"
  | "email_sent"
  | "approved"
  | "posted"
  | "failed"
  | "changes_requested";

interface QueueEntry {
  slug: string;
  contentType: string;
  sourcePath: string;
  url: string;
  title: string;
  status: QueueStatus;
  packId?: string;
  processedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const REPO_ROOT = path.resolve(__dirname, "..");
  const queuePath = path.resolve(__dirname, "queue.json");
  const packsDir = path.resolve(__dirname, "packs");

  // Load queue
  let queueRaw: string;
  try {
    queueRaw = await readQueue(queuePath);
  } catch (err) {
    console.error(`[daily-publisher] FATAL: Cannot load queue: ${(err as Error).message}`);
    process.exit(1);
  }

  const queueData = JSON.parse(queueRaw) as { articles: QueueEntry[] };
  const entries: QueueEntry[] = queueData.articles ?? [];

  const approved = entries.filter((e) => e.status === "approved");
  console.log(`[daily-publisher] Found ${approved.length} approved pack(s) to publish`);

  if (approved.length === 0) {
    console.log("[daily-publisher] Nothing to do — exiting");
    process.exit(0);
  }

  const updatedEntries = [...entries];

  for (const entry of approved) {
    console.log(`[daily-publisher] Publishing pack: ${entry.slug}`);

    let pack: GeneratedPack;
    try {
      pack = await loadPackJson(entry.slug, packsDir);
    } catch (err) {
      console.error(`[daily-publisher] Cannot load pack ${entry.slug}: ${(err as Error).message} — marking failed`);
      const idx = updatedEntries.findIndex((e) => e.slug === entry.slug);
      if (idx !== -1) {
        updatedEntries[idx] = {
          ...updatedEntries[idx],
          status: "failed",
          processedAt: new Date().toISOString(),
        };
      }
      continue;
    }

    try {
      const successfulPosts = result.filter((r) => r.success).length;
      console.log(`[daily-publisher] ${entry.slug} — posted ${successfulPosts} channel(s)`);

      const idx = updatedEntries.findIndex((e) => e.slug === entry.slug);
      if (idx !== -1) {
        updatedEntries[idx] = {
          ...updatedEntries[idx],
          status: "posted",
          processedAt: new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error(`[daily-publisher] postPack failed for ${entry.slug}: ${(err as Error).message}`);

      const idx = updatedEntries.findIndex((e) => e.slug === entry.slug);
      if (idx !== -1) {
        updatedEntries[idx] = {
          ...updatedEntries[idx],
          status: "failed",
          processedAt: new Date().toISOString(),
        };
      }
    }
  }

  // Save updated queue
  const updatedJson = JSON.stringify({ articles: updatedEntries }, null, 2) + "\n";
  try {
    await writeQueue(queuePath, updatedJson);
    console.log("[daily-publisher] Queue saved");
  } catch (err) {
    console.error(`[daily-publisher] FATAL: Cannot save queue: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log("[daily-publisher] Done");
  // Suppress unused import warning — REPO_ROOT used for clarity in local path resolution
  void REPO_ROOT;
}

main().catch((err) => {
  console.error("[daily-publisher] Unhandled error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
