/**
 * Suchi Navigator — Daily Research Automation
 *
 * Designed to run on a daily schedule (Cloud Scheduler → Cloud Run Job).
 * Picks the next pending batch from queue.json, asks Claude to research
 * cancer hospitals in that region, gates each result through inclusion
 * criteria, updates the queue, and emails the batch for human approval.
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY           — Claude API key
 *   NAVIGATOR_APPROVAL_SECRET   — HMAC secret for approval tokens
 *   SMTP_PASS (optional)        — SMTP password for email send
 *
 * Exit codes: 0 = success (email sent or no pending work), 1 = error
 */

import Anthropic from "@anthropic-ai/sdk";
import * as path from "node:path";
import { pickNextPending, updateBatch } from "./queue-manager";
import { sendBatchEmail } from "./hospital-mailer";
import { passesInclusionCriteria, estimateTier } from "./inclusion-criteria";
import { readQueueJson, writeQueueJson } from "./gcs-queue";
import { HospitalDraft, ResearchTarget } from "./types";

const QUEUE_PATH = path.resolve(__dirname, "queue.json");

// ---------------------------------------------------------------------------
// Queue helpers that go through the GCS adapter
// ---------------------------------------------------------------------------

interface QueueFile { batches: ResearchTarget[] }

async function loadBatches(): Promise<ResearchTarget[]> {
  const raw = await readQueueJson(QUEUE_PATH);
  return (JSON.parse(raw) as QueueFile).batches;
}

async function saveBatches(batches: ResearchTarget[]): Promise<void> {
  const content = JSON.stringify({ batches }, null, 2) + "\n";
  await writeQueueJson(QUEUE_PATH, content);
}

// ---------------------------------------------------------------------------
// Research prompt
// ---------------------------------------------------------------------------

function buildResearchPrompt(region: string): string {
  return `You are a hospital research assistant for Suchi, an Indian cancer information service focused on East India and patients from Bihar, Jharkhand, West Bengal, and Odisha.

Research cancer treatment hospitals in: ${region}

For each hospital you find, verify it meets ALL of these minimum criteria:
1. Has at least one oncologist (medical oncologist OR surgical oncologist) with known, verifiable presence
2. Offers 2+ treatment modalities (surgery + chemo, chemo + radiation, etc.)
3. Has at least one trust signal: NABH/NABL accreditation, NCG membership, TMC affiliation, or is a government institution (AIIMS, government medical college, ESIC)

Find 3–5 hospitals that meet these criteria. Prioritise:
- Government hospitals and AIIMS units (affordable, PMJAY-empanelled)
- NCG (National Cancer Grid) member hospitals
- TMC (Tata Memorial Centre) affiliated units
- NABH-accredited private hospitals with full oncology

Return ONLY a JSON object with this exact structure (no markdown, no explanation, just the JSON):

{
  "region": "${region}",
  "researched_at": "${new Date().toISOString().slice(0, 10)}",
  "hospitals": [
    {
      "id": "hospital-city-shortname",
      "name": "Full Official Hospital Name",
      "short_name": "Short Name",
      "city": "City Name",
      "state": "State Name",
      "region": "${region}",
      "type": "Government | Private | Trust | TMC",
      "accreditation": ["NABH", "TMC_AFFILIATED", "NCG_MEMBER"],
      "ncg_member": true | false | null,
      "departments": ["medical_oncology", "surgical_oncology", "radiation_oncology", "chemotherapy"],
      "cost_tier": "Low | Medium | High",
      "pmjay_empanelled": true | false | null,
      "contact": {
        "phone": "+91-XXXXXXXXXX or null",
        "address": "Full address or null",
        "website": "https://... or null"
      },
      "key_doctors": [
        { "name": "Dr. Full Name", "role": "Medical Oncology" }
      ],
      "notes": "One-paragraph factual summary of what this hospital offers for cancer patients.",
      "tier": null,
      "navigation_notes": [
        "Practical tip 1 for patients travelling from rural areas",
        "PMJAY/Ayushman Bharat registration note if applicable"
      ],
      "score": null,
      "verified_date": "${new Date().toISOString().slice(0, 10)}",
      "status": "draft",
      "confidence": "high | medium | low",
      "sources": ["Description of source used (e.g. hospital website, NCI directory, news article)"]
    }
  ]
}

Department codes to use (use only these values in the departments array):
medical_oncology, surgical_oncology, radiation_oncology, chemotherapy, immunotherapy,
bone_marrow_transplant, targeted_therapy, palliative_care, pain_management,
head_and_neck_surgery, gynecologic_oncology, hemato_oncology, pediatric_oncology,
nuclear_medicine, pathology, radiology, clinical_trials

Only include hospitals you are confident exist and operate in ${region}. If you are unsure about a field, set it to null rather than guessing. Set confidence to "low" if you found limited verifiable information.`;
}

// ---------------------------------------------------------------------------
// Parse and validate the API response
// ---------------------------------------------------------------------------

interface ResearchResponse {
  region: string;
  researched_at: string;
  hospitals: HospitalDraft[];
}

function parseResearchResponse(content: string): ResearchResponse {
  // Strip possible markdown code fences
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();

  const parsed = JSON.parse(cleaned) as ResearchResponse;

  if (!parsed.region || !Array.isArray(parsed.hospitals)) {
    throw new Error(`Invalid response structure: missing region or hospitals array`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Gate each draft through inclusion criteria
// ---------------------------------------------------------------------------

interface GatingResult {
  passed: HospitalDraft[];
  rejected: Array<{ name: string; reasons: string[] }>;
}

function applyInclusionCriteria(drafts: HospitalDraft[]): GatingResult {
  const passed: HospitalDraft[] = [];
  const rejected: Array<{ name: string; reasons: string[] }> = [];

  for (const draft of drafts) {
    const result = passesInclusionCriteria(draft);
    if (result.pass) {
      // Auto-estimate tier if not set
      const tier = draft.tier ?? estimateTier(draft, result.score);
      passed.push({ ...draft, tier, score: result.score });
    } else {
      rejected.push({ name: draft.name, reasons: result.failures });
    }
  }

  return { passed, rejected };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "[daily-researcher] ANTHROPIC_API_KEY not set — cannot run research",
    );
    process.exit(1);
  }

  // 1. Load queue and find next pending batch
  let batches = await loadBatches();
  const target: ResearchTarget | null = pickNextPending(batches);

  if (!target) {
    console.log("[daily-researcher] No pending batches in queue — nothing to do.");
    process.exit(0);
  }

  console.log(
    `[daily-researcher] Researching batch: ${target.id} (region: ${target.region})`,
  );

  // 2. Call Claude to research hospitals
  const client = new Anthropic({ apiKey });
  const prompt = buildResearchPrompt(target.region);

  let rawContent: string;
  try {
    console.log(`[daily-researcher] Calling Claude claude-sonnet-4-6 for region: ${target.region}`);
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text content in API response");
    }
    rawContent = textBlock.text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[daily-researcher] Claude API call failed: ${msg}`);
    process.exit(1);
  }

  // 3. Parse response
  let researchResult: ResearchResponse;
  try {
    researchResult = parseResearchResponse(rawContent);
    console.log(
      `[daily-researcher] Parsed ${researchResult.hospitals.length} hospital drafts`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[daily-researcher] Failed to parse research response: ${msg}`);
    console.error("--- Raw response ---");
    console.error(rawContent.slice(0, 2000));
    process.exit(1);
  }

  // 4. Apply inclusion criteria gate
  const { passed, rejected } = applyInclusionCriteria(researchResult.hospitals);

  if (rejected.length > 0) {
    console.log(`\n[daily-researcher] Rejected ${rejected.length} hospital(s) (did not meet criteria):`);
    for (const r of rejected) {
      console.log(`  ✗ ${r.name}`);
      for (const reason of r.reasons) {
        console.log(`      - ${reason}`);
      }
    }
  }

  if (passed.length === 0) {
    console.warn(
      `[daily-researcher] No hospitals passed inclusion criteria for batch "${target.id}". ` +
        `Batch remains pending — review the research prompt or add hospitals manually.`,
    );
    process.exit(0);
  }

  // Enforce max 5
  const finalDrafts = passed.slice(0, 5);
  console.log(
    `\n[daily-researcher] ${finalDrafts.length} hospital(s) passed criteria:`,
  );
  for (const h of finalDrafts) {
    console.log(
      `  ✓ ${h.name} (${h.city}) — Tier ${h.tier ?? "?"}, Confidence: ${h.confidence}`,
    );
  }

  // 5. Update queue
  batches = updateBatch(batches, target.id, {
    hospitals: finalDrafts,
    status: "researched",
  });
  await saveBatches(batches);
  console.log(`\n[daily-researcher] Queue updated → batch "${target.id}" status: researched`);

  // 6. Re-load to get the updated batch for email
  batches = await loadBatches();
  const updatedBatch = batches.find((b) => b.id === target.id);
  if (!updatedBatch) {
    console.error(`[daily-researcher] Could not find batch after save — aborting email`);
    process.exit(1);
  }

  // 7. Send approval email
  console.log(`\n[daily-researcher] Sending approval email for batch "${target.id}"...`);
  const mailResult = await sendBatchEmail(updatedBatch);

  // 8. Persist token + email_sent status
  batches = updateBatch(batches, target.id, {
    status: "email_sent",
    approvalToken: mailResult.approvalToken,
    emailSentAt: new Date().toISOString(),
  });
  await saveBatches(batches);

  if (mailResult.emailSent) {
    console.log(
      `[daily-researcher] Email sent to reviewers. Batch "${target.id}" → email_sent`,
    );
  } else if (mailResult.emailError) {
    console.warn(
      `[daily-researcher] Email failed (${mailResult.emailError}) — token saved, batch marked email_sent`,
    );
  } else {
    console.log(
      `[daily-researcher] SMTP not configured — token saved, batch marked email_sent. ` +
        `Run: npx ts-node navigator/cli.ts send ${target.id}`,
    );
  }

  console.log(`\n[daily-researcher] Done. Approval token: ${mailResult.approvalToken.slice(0, 12)}...`);
}

main().catch((err) => {
  console.error("[daily-researcher] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
