/**
 * Suchi Navigator — Queue Manager
 *
 * Loads, saves, and mutates the navigator/queue.json file.
 * Mirrors the pattern of distribution/queue-manager.ts.
 */

import * as fs from "node:fs/promises";
import { ResearchTarget, BatchStatus } from "./types";

interface QueueFile {
  batches: ResearchTarget[];
}

export async function loadQueue(queuePath: string): Promise<ResearchTarget[]> {
  const raw = await fs.readFile(queuePath, "utf-8");
  const parsed = JSON.parse(raw) as QueueFile;
  return parsed.batches;
}

export async function saveQueue(
  queuePath: string,
  batches: ResearchTarget[],
): Promise<void> {
  const data: QueueFile = { batches };
  await fs.writeFile(
    queuePath,
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

export function findBatch(
  batches: ResearchTarget[],
  id: string,
): ResearchTarget | null {
  return batches.find((b) => b.id === id) ?? null;
}

export function pickNextPending(
  batches: ResearchTarget[],
): ResearchTarget | null {
  return batches.find((b) => b.status === "pending") ?? null;
}

export function pickNextResearched(
  batches: ResearchTarget[],
): ResearchTarget | null {
  return batches.find((b) => b.status === "researched") ?? null;
}

export function updateBatch(
  batches: ResearchTarget[],
  id: string,
  updates: Partial<ResearchTarget>,
): ResearchTarget[] {
  return batches.map((b) => (b.id === id ? { ...b, ...updates } : b));
}
