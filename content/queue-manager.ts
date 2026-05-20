import * as fs from "node:fs/promises";
import { ArticleEntry, ContentQueue } from "./types";

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const GCS_QUEUE_OBJECT = "content-queue.json";

async function gcsDownload(object: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const { Storage } = require("@google-cloud/storage") as any;
  const [buf] = await new Storage({ projectId: GCS_PROJECT }).bucket(GCS_BUCKET!).file(object).download() as [Buffer];
  return buf.toString("utf-8");
}

async function gcsUpload(object: string, content: string, contentType = "application/json"): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const { Storage } = require("@google-cloud/storage") as any;
  await new Storage({ projectId: GCS_PROJECT }).bucket(GCS_BUCKET!).file(object).save(content, { contentType });
}

export async function loadQueue(localPath: string): Promise<ArticleEntry[]> {
  if (GCS_BUCKET) {
    try {
      const raw = await gcsDownload(GCS_QUEUE_OBJECT);
      return (JSON.parse(raw) as ContentQueue).articles ?? [];
    } catch {
      // fall through to local
    }
  }
  try {
    const raw = await fs.readFile(localPath, "utf-8");
    return (JSON.parse(raw) as ContentQueue).articles ?? [];
  } catch {
    return [];
  }
}

export async function saveQueue(localPath: string, articles: ArticleEntry[]): Promise<void> {
  const data: ContentQueue = { articles };
  const json = JSON.stringify(data, null, 2) + "\n";
  await fs.writeFile(localPath, json, "utf-8");
  if (GCS_BUCKET) {
    await gcsUpload(GCS_QUEUE_OBJECT, json);
  }
}

export async function uploadDraft(slug: string, markdown: string): Promise<void> {
  if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not set — cannot upload draft");
  await gcsUpload(`content-drafts/${slug}.md`, markdown, "text/markdown");
}

export async function downloadDraft(slug: string): Promise<string> {
  if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not set");
  return gcsDownload(`content-drafts/${slug}.md`);
}
