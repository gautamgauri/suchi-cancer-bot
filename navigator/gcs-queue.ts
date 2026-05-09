/**
 * Suchi Navigator — GCS Queue Adapter
 *
 * When QUEUE_GCS_BUCKET is set, queue.json and hospitals.json are read/written
 * from Google Cloud Storage so state persists across Cloud Run Job restarts.
 *
 * Falls back to local filesystem when the env var is absent (local dev / CI).
 *
 * Usage (in daily-researcher.ts and navigator-approve.service.ts):
 *   import { readQueueJson, writeQueueJson, readHospitalsJson, writeHospitalsJson } from "./gcs-queue";
 */

import * as fs from "node:fs/promises";

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET; // e.g. "suchi-navigator-state"
const GCS_QUEUE_OBJECT = process.env.QUEUE_GCS_OBJECT ?? "queue.json";
const GCS_HOSPITALS_OBJECT =
  process.env.HOSPITALS_GCS_OBJECT ?? "hospitals.json";
const GCS_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";

// ---------------------------------------------------------------------------
// Internal GCS helpers (lazy-loaded @google-cloud/storage)
// ---------------------------------------------------------------------------

async function gcsDownload(bucket: string, object: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const { Storage } = require("@google-cloud/storage") as any;
  const storage = new Storage({ projectId: GCS_PROJECT });
  const [contents] = await storage.bucket(bucket).file(object).download() as [Buffer];
  return contents.toString("utf-8");
}

async function gcsUpload(
  bucket: string,
  object: string,
  content: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const { Storage } = require("@google-cloud/storage") as any;
  const storage = new Storage({ projectId: GCS_PROJECT });
  const file = storage.bucket(bucket).file(object);
  await file.save(content, { contentType: "application/json" });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function readQueueJson(localPath: string): Promise<string> {
  if (GCS_BUCKET) {
    try {
      console.log(
        `[gcs-queue] Reading queue from gs://${GCS_BUCKET}/${GCS_QUEUE_OBJECT}`,
      );
      return await gcsDownload(GCS_BUCKET, GCS_QUEUE_OBJECT);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[gcs-queue] GCS read failed (${msg}), falling back to local file`,
      );
    }
  }
  return fs.readFile(localPath, "utf-8");
}

export async function writeQueueJson(
  localPath: string,
  content: string,
): Promise<void> {
  // Always write local copy
  await fs.writeFile(localPath, content, "utf-8");
  if (GCS_BUCKET) {
    try {
      console.log(
        `[gcs-queue] Writing queue to gs://${GCS_BUCKET}/${GCS_QUEUE_OBJECT}`,
      );
      await gcsUpload(GCS_BUCKET, GCS_QUEUE_OBJECT, content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gcs-queue] GCS write failed: ${msg}`);
    }
  }
}

export async function readHospitalsJson(localPath: string): Promise<string> {
  if (GCS_BUCKET) {
    try {
      console.log(
        `[gcs-queue] Reading hospitals from gs://${GCS_BUCKET}/${GCS_HOSPITALS_OBJECT}`,
      );
      return await gcsDownload(GCS_BUCKET, GCS_HOSPITALS_OBJECT);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[gcs-queue] GCS hospitals read failed (${msg}), falling back to local file`,
      );
    }
  }
  return fs.readFile(localPath, "utf-8");
}

export async function writeHospitalsJson(
  localPath: string,
  content: string,
): Promise<void> {
  await fs.writeFile(localPath, content, "utf-8");
  if (GCS_BUCKET) {
    try {
      console.log(
        `[gcs-queue] Writing hospitals to gs://${GCS_BUCKET}/${GCS_HOSPITALS_OBJECT}`,
      );
      await gcsUpload(GCS_BUCKET, GCS_HOSPITALS_OBJECT, content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gcs-queue] GCS hospitals write failed: ${msg}`);
    }
  }
}
