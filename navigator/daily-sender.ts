/**
 * Suchi Navigator — Daily Approval Email Sender
 *
 * Designed to run on a daily schedule (Cloud Scheduler → Cloud Run Job).
 * Picks the next researched batch from queue.json and emails it for human
 * approval. No Claude API call — the research is already done.
 *
 * Required env vars:
 *   NAVIGATOR_APPROVAL_SECRET   — HMAC secret for approval tokens
 *   SMTP_PASS (optional)        — SMTP password for email send
 *
 * Exit codes: 0 = success (email sent or no work), 1 = error
 */

import * as path from "node:path";
import { pickNextResearched, updateBatch } from "./queue-manager";
import { sendBatchEmail } from "./hospital-mailer";
import { readQueueJson, writeQueueJson } from "./gcs-queue";
import { ResearchTarget } from "./types";

const QUEUE_PATH = path.resolve(__dirname, "queue.json");

interface QueueFile { batches: ResearchTarget[] }

async function loadBatches(): Promise<ResearchTarget[]> {
  const raw = await readQueueJson(QUEUE_PATH);
  return (JSON.parse(raw) as QueueFile).batches;
}

async function saveBatches(batches: ResearchTarget[]): Promise<void> {
  const content = JSON.stringify({ batches }, null, 2) + "\n";
  await writeQueueJson(QUEUE_PATH, content);
}

async function main(): Promise<void> {
  let batches = await loadBatches();
  const target: ResearchTarget | null = pickNextResearched(batches);

  if (!target) {
    console.log("[daily-sender] No researched batches waiting — nothing to send.");
    process.exit(0);
  }

  console.log(`[daily-sender] Sending approval email for batch: ${target.id} (${target.region})`);
  console.log(`[daily-sender] Hospitals in batch: ${target.hospitals.length}`);

  const mailResult = await sendBatchEmail(target);

  batches = updateBatch(batches, target.id, {
    status: "email_sent",
    approvalToken: mailResult.approvalToken,
    emailSentAt: new Date().toISOString(),
  });
  await saveBatches(batches);

  if (mailResult.emailSent) {
    console.log(`[daily-sender] Email sent. Batch "${target.id}" → email_sent`);
  } else if (mailResult.emailError) {
    console.warn(`[daily-sender] Email failed (${mailResult.emailError}) — token saved, batch marked email_sent`);
  } else {
    console.log(`[daily-sender] SMTP not configured — token saved, batch marked email_sent`);
  }

  console.log(`[daily-sender] Approval token: ${mailResult.approvalToken.slice(0, 12)}...`);
}

main().catch((err) => {
  console.error("[daily-sender] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
