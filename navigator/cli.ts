/**
 * Suchi Navigator CLI
 *
 * Commands:
 *   research <region>        — Print instructions + template JSON for the hospital-researcher agent
 *   send <batch-id>          — Send review email for a researched batch
 *   status                   — Print queue table
 *   add <batch-json-path>    — Load a JSON file of researched hospitals and add to queue
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  loadQueue,
  saveQueue,
  findBatch,
  pickNextResearched,
  updateBatch,
} from "./queue-manager";
import { sendBatchEmail, sendUpdateNotification } from "./hospital-mailer";
import { writeQueueJson } from "./gcs-queue";
import { ResearchTarget, HospitalDraft } from "./types";

const QUEUE_PATH = path.resolve(__dirname, "queue.json");

// ---------------------------------------------------------------------------
// research command
// ---------------------------------------------------------------------------

async function cmdResearch(region: string): Promise<void> {
  const batches = await loadQueue(QUEUE_PATH);
  const existing = batches.find(
    (b) => b.region.toLowerCase() === region.toLowerCase(),
  );

  console.log(`\n=== Suchi Navigator — Research Instructions ===\n`);
  console.log(`Region: ${region}`);
  if (existing) {
    console.log(`Existing batch found: ${existing.id} (status: ${existing.status})`);
    console.log(`Save researched hospitals to a JSON file and run:\n`);
    console.log(`  npx ts-node navigator/cli.ts add <path-to-json>\n`);
  } else {
    console.log(
      `No existing batch found for this region. Add one to navigator/queue.json first.\n`,
    );
  }

  console.log(`--- Hospital Researcher Agent Instructions ---`);
  console.log(`
Use the hospital-researcher agent to find cancer hospitals in "${region}".
For each hospital, collect:
  - Full name, short name, city, state
  - Hospital type (Government / Private / Trust / TMC)
  - Accreditation (NABH, NABL, TMC_AFFILIATED, NCG_MEMBER, etc.)
  - Departments (medical_oncology, surgical_oncology, radiation_oncology, etc.)
  - Cost tier (Low / Medium / High)
  - PMJAY empanelment status
  - Key doctors (name + role)
  - Phone, address, website
  - Navigation notes (practical tips for patients)
  - Sources (URLs you used)
  - Your confidence: high / medium / low

Aim for 3–5 hospitals per batch.
Save your output as a JSON file matching this template, then run:
  npx ts-node navigator/cli.ts add <path-to-json>
`);

  // Print template JSON
  const template: { batch_id: string; hospitals: HospitalDraft[] } = {
    batch_id: existing?.id ?? `${region.toLowerCase().replace(/\s+/g, "-")}-batch-1`,
    hospitals: [
      {
        id: "example-hospital-city",
        name: "Example Cancer Hospital",
        short_name: "Example Hospital",
        city: "City",
        state: "State",
        region,
        type: "Government / Trust / Private",
        accreditation: ["NABH", "TMC_AFFILIATED"],
        ncg_member: null,
        departments: ["medical_oncology", "surgical_oncology", "radiation_oncology"],
        cost_tier: "Low",
        pmjay_empanelled: null,
        contact: {
          phone: null,
          address: null,
          website: null,
        },
        key_doctors: [{ name: "Dr. Example", role: "Medical Oncology" }],
        notes: "Brief notes about this hospital.",
        tier: null,
        navigation_notes: ["Practical tip for patients."],
        score: null,
        verified_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        confidence: "medium",
        sources: ["https://example.com/hospital-page"],
      },
    ],
  };

  console.log(`--- Template JSON (save as e.g. /tmp/${template.batch_id}-draft.json) ---\n`);
  console.log(JSON.stringify(template, null, 2));
}

// ---------------------------------------------------------------------------
// send command
// ---------------------------------------------------------------------------

async function cmdSend(batchId: string): Promise<void> {
  let batches = await loadQueue(QUEUE_PATH);
  const batch = findBatch(batches, batchId);

  if (!batch) {
    console.error(`Error: batch "${batchId}" not found in queue.json`);
    process.exit(1);
  }

  if (batch.status === "pending") {
    console.error(
      `Error: batch "${batchId}" is still pending — run research first, then add hospitals via:\n` +
        `  npx ts-node navigator/cli.ts add <batch-json-path>`,
    );
    process.exit(1);
  }

  if (batch.status === "email_sent") {
    console.warn(`Warning: batch "${batchId}" already has email_sent status — resending...`);
  }

  if (batch.hospitals.length === 0) {
    console.error(`Error: batch "${batchId}" has no hospitals to review.`);
    process.exit(1);
  }

  const hospitalCount = Math.min(batch.hospitals.length, 5);
  console.log(
    `Sending review email for batch "${batchId}" (${hospitalCount} hospital${hospitalCount !== 1 ? "s" : ""}, region: ${batch.region})...`,
  );

  const result = await sendBatchEmail(batch);

  // Update queue with token + status regardless of email success
  const now = new Date().toISOString();
  batches = updateBatch(batches, batchId, {
    status: "email_sent",
    approvalToken: result.approvalToken,
    emailSentAt: now,
  });
  const queueContent = JSON.stringify({ batches }, null, 2) + "\n";
  await saveQueue(QUEUE_PATH, batches);
  await writeQueueJson(QUEUE_PATH, queueContent);

  if (result.emailSent) {
    console.log(`\nEmail sent to: gautamgauri@dikshafoundation.org, divya.vats@dikshafoundation.org`);
    console.log(`Batch status updated → email_sent`);
    console.log(`Approval token saved to queue.json + GCS`);
  } else if (result.emailError) {
    console.log(`\nEmail failed — ${result.emailError}`);
    console.log(`Batch status updated → email_sent (approval token saved, email not delivered)`);
  } else {
    console.log(
      `\nEmail skipped — SMTP not configured (set SMTP_PASS env var or configure Secret Manager)`,
    );
    console.log(`Batch status updated → email_sent (approval token saved)`);
  }
}

// ---------------------------------------------------------------------------
// notify command
// ---------------------------------------------------------------------------

async function cmdNotify(): Promise<void> {
  const batches = await loadQueue(QUEUE_PATH);
  const pending = batches.filter((b) => b.status === "email_sent");

  if (pending.length === 0) {
    console.log("No email_sent batches found — nothing to notify.");
    return;
  }

  console.log(`Sending update notification for ${pending.length} pending batch(es):`);
  pending.forEach((b) => console.log(`  - ${b.id} (${b.hospitals.length} hospitals)`));

  const result = await sendUpdateNotification(batches);

  if (result.emailSent) {
    console.log(`\nNotification sent to: gautamgauri@dikshafoundation.org, divya.vats@dikshafoundation.org`);
  } else if (result.emailError) {
    console.error(`\nEmail failed — ${result.emailError}`);
    process.exit(1);
  } else {
    console.log(`\nEmail skipped — SMTP not configured (set SMTP_PASS env var)`);
  }
}

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

async function cmdStatus(): Promise<void> {
  const batches = await loadQueue(QUEUE_PATH);

  if (batches.length === 0) {
    console.log("No batches in queue.");
    return;
  }

  const col = {
    id: Math.max(2, ...batches.map((b) => b.id.length)),
    region: Math.max(6, ...batches.map((b) => b.region.length)),
    status: Math.max(6, ...batches.map((b) => b.status.length)),
    hospitals: "HOSPITALS".length,
  };

  const pad = (s: string, n: number) => s.padEnd(n);
  const line = `${pad("ID", col.id)}  ${pad("REGION", col.region)}  ${pad("STATUS", col.status)}  ${"HOSPITALS".padEnd(col.hospitals)}`;
  const divider = "-".repeat(line.length);

  console.log(divider);
  console.log(line);
  console.log(divider);

  for (const b of batches) {
    const hospCount = String(b.hospitals.length).padEnd(col.hospitals);
    console.log(
      `${pad(b.id, col.id)}  ${pad(b.region, col.region)}  ${pad(b.status, col.status)}  ${hospCount}`,
    );
  }

  console.log(divider);
  console.log(`Total: ${batches.length} batch${batches.length !== 1 ? "es" : ""}`);

  const counts: Record<string, number> = {};
  for (const b of batches) {
    counts[b.status] = (counts[b.status] ?? 0) + 1;
  }
  for (const [status, count] of Object.entries(counts)) {
    console.log(`  ${status}: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// add command
// ---------------------------------------------------------------------------

async function cmdAdd(jsonPath: string): Promise<void> {
  const absPath = path.isAbsolute(jsonPath)
    ? jsonPath
    : path.resolve(process.cwd(), jsonPath);

  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf-8");
  } catch {
    console.error(`Error: could not read file "${absPath}"`);
    process.exit(1);
  }

  let parsed: { batch_id: string; hospitals: HospitalDraft[] };
  try {
    parsed = JSON.parse(raw) as { batch_id: string; hospitals: HospitalDraft[] };
  } catch {
    console.error(`Error: invalid JSON in "${absPath}"`);
    process.exit(1);
  }

  if (!parsed.batch_id || !Array.isArray(parsed.hospitals)) {
    console.error(
      `Error: JSON must have "batch_id" (string) and "hospitals" (array).`,
    );
    process.exit(1);
  }

  let batches = await loadQueue(QUEUE_PATH);
  const batch = findBatch(batches, parsed.batch_id);

  if (!batch) {
    console.error(
      `Error: batch "${parsed.batch_id}" not found in queue.json.\n` +
        `Add it manually to navigator/queue.json first.`,
    );
    process.exit(1);
  }

  // Enforce max 5 hospitals per batch
  const incoming = parsed.hospitals.slice(0, 5);

  // Force status: "draft" on all incoming hospitals
  const drafts: HospitalDraft[] = incoming.map((h) => ({ ...h, status: "draft" as const }));

  batches = updateBatch(batches, parsed.batch_id, {
    hospitals: drafts,
    status: "researched",
  });

  await saveQueue(QUEUE_PATH, batches);

  console.log(
    `Added ${drafts.length} hospital${drafts.length !== 1 ? "s" : ""} to batch "${parsed.batch_id}".`,
  );
  console.log(`Batch status updated → researched`);
  console.log(
    `\nNext step — send for review:\n  npx ts-node navigator/cli.ts send ${parsed.batch_id}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  if (!command) {
    console.error("Suchi Navigator CLI");
    console.error("");
    console.error("Usage:");
    console.error("  npx ts-node navigator/cli.ts research <region>");
    console.error("  npx ts-node navigator/cli.ts send <batch-id>");
    console.error("  npx ts-node navigator/cli.ts status");
    console.error("  npx ts-node navigator/cli.ts add <batch-json-path>");
    console.error("  npx ts-node navigator/cli.ts notify");
    process.exit(1);
  }

  switch (command) {
    case "research": {
      const region = args[0];
      if (!region) {
        console.error("Error: region required");
        console.error("  npx ts-node navigator/cli.ts research <region>");
        process.exit(1);
      }
      await cmdResearch(region);
      break;
    }

    case "send": {
      const batchId = args[0];
      if (!batchId) {
        console.error("Error: batch-id required");
        console.error("  npx ts-node navigator/cli.ts send <batch-id>");
        process.exit(1);
      }
      await cmdSend(batchId);
      break;
    }

    case "notify": {
      await cmdNotify();
      break;
    }

    case "status": {
      await cmdStatus();
      break;
    }

    case "add": {
      const jsonPath = args[0];
      if (!jsonPath) {
        console.error("Error: batch-json-path required");
        console.error("  npx ts-node navigator/cli.ts add <batch-json-path>");
        process.exit(1);
      }
      await cmdAdd(jsonPath);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run without arguments to see usage.");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
