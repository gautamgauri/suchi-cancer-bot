import * as fs from "node:fs/promises";

export type QueueStatus =
  | "pending"
  | "generated"
  | "email_sent"
  | "approved"
  | "changes_requested"
  | "posted";

export interface QueueEntry {
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

interface QueueFile {
  articles: QueueEntry[];
}

export async function loadQueue(queuePath: string): Promise<QueueEntry[]> {
  const raw = await fs.readFile(queuePath, "utf-8");
  const parsed = JSON.parse(raw) as QueueFile;
  return parsed.articles;
}

export async function saveQueue(
  queuePath: string,
  entries: QueueEntry[]
): Promise<void> {
  const data: QueueFile = { articles: entries };
  await fs.writeFile(queuePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function pickNext(entries: QueueEntry[]): QueueEntry | null {
  return entries.find((e) => e.status === "pending") ?? null;
}

export function updateEntry(
  entries: QueueEntry[],
  slug: string,
  updates: Partial<QueueEntry>
): QueueEntry[] {
  return entries.map((e) =>
    e.slug === slug ? { ...e, ...updates } : e
  );
}
