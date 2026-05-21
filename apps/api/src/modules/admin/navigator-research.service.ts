/**
 * Navigator Research Service
 *
 * Runs as a daily scheduled task (POST /admin/hospital-research, SchedulerOidcGuard).
 * Picks the next pending batch from GCS queue, calls Gemini to research hospitals,
 * validates through inclusion criteria, saves back to GCS, and emails reviewers.
 *
 * Mirrors daily-researcher.ts but runs inside the NestJS API so it has access to
 * all Cloud Run secrets and the existing LLM + Email services.
 */

import { Injectable, Logger } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { LlmService } from "../llm/llm.service";
import { EmailService } from "../email/email.service";

// ---------------------------------------------------------------------------
// GCS helpers (mirrors navigator-approve.service.ts pattern)
// ---------------------------------------------------------------------------

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const GCS_QUEUE_OBJECT = "queue.json";

function getStorage(): Storage {
  return new Storage({ projectId: GCS_PROJECT });
}

async function gcsRead(object: string): Promise<string> {
  if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not configured");
  const [contents] = await getStorage().bucket(GCS_BUCKET).file(object).download() as [Buffer];
  return contents.toString("utf-8");
}

async function gcsWrite(object: string, content: string): Promise<void> {
  if (!GCS_BUCKET) return;
  await getStorage().bucket(GCS_BUCKET).file(object).save(content, { contentType: "application/json" });
}

// ---------------------------------------------------------------------------
// Inline types (mirrors navigator/types.ts — no cross-package imports)
// ---------------------------------------------------------------------------

type BatchStatus = "pending" | "researched" | "email_sent" | "approved" | "rejected";

interface HospitalDraft {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  region: string;
  type: string;
  accreditation: string[];
  ncg_member: boolean | null;
  departments: string[];
  cost_tier: string | null;
  pmjay_empanelled: boolean | null;
  contact: { phone: string | null; address: string | null; website: string | null };
  key_doctors: Array<{ name: string; role: string }>;
  notes: string;
  tier: "A" | "B" | "C" | null;
  navigation_notes: string[];
  score: number | null;
  verified_date: string;
  status: string;
  confidence: "high" | "medium" | "low";
  sources: string[];
}

interface ResearchTarget {
  id: string;
  region: string;
  status: BatchStatus;
  hospitals: HospitalDraft[];
  createdAt: string;
  approvalToken?: string;
  emailSentAt?: string;
}

interface QueueFile { batches: ResearchTarget[] }

// ---------------------------------------------------------------------------
// Inclusion criteria (mirrors navigator/inclusion-criteria.ts)
// ---------------------------------------------------------------------------

const CORE_ONCOLOGY_DEPTS = new Set([
  "medical_oncology", "surgical_oncology", "radiation_oncology",
  "head_and_neck_surgery", "gynecologic_oncology", "pediatric_oncology", "hemato_oncology",
]);

const TREATMENT_MODALITIES = new Set([
  "medical_oncology", "surgical_oncology", "radiation_oncology", "chemotherapy",
  "immunotherapy", "bone_marrow_transplant", "targeted_therapy",
  "head_and_neck_surgery", "gynecologic_oncology",
]);

const TRUST_SIGNALS = new Set(["NABH", "NABL", "NCG_MEMBER", "TMC_AFFILIATED", "JCI", "ISO"]);
const GOVERNMENT_TYPES = ["Government", "AIIMS", "ESIC"];

function passesInclusionCriteria(h: HospitalDraft): { pass: boolean; failures: string[]; score: number } {
  const failures: string[] = [];

  if (!h.departments.some((d) => CORE_ONCOLOGY_DEPTS.has(d)))
    failures.push("No core oncology department");

  if (h.departments.filter((d) => TREATMENT_MODALITIES.has(d)).length < 2)
    failures.push("Fewer than 2 treatment modalities");

  const hasTrust = h.accreditation.some((a) => TRUST_SIGNALS.has(a)) ||
    GOVERNMENT_TYPES.some((t) => h.type.toLowerCase().includes(t.toLowerCase())) ||
    !!h.ncg_member;
  if (!hasTrust) failures.push("No trust signal (NABH/NCG/TMC/Government)");

  let score = 0;
  if (h.accreditation.some((a) => TRUST_SIGNALS.has(a))) score += 2;
  if (h.ncg_member) score += 2;
  if (GOVERNMENT_TYPES.some((t) => h.type.toLowerCase().includes(t.toLowerCase()))) score += 1;
  if (h.departments.includes("radiation_oncology")) score += 1;
  if (h.pmjay_empanelled) score += 1;
  if (h.key_doctors.length >= 2) score += 1;
  if (h.contact.phone) score += 1;
  if (h.contact.address) score += 1;
  score = Math.min(score, 10);

  return { pass: failures.length === 0, failures, score };
}

function estimateTier(h: HospitalDraft, score: number): "A" | "B" | "C" {
  if (h.ncg_member || h.accreditation.includes("TMC_AFFILIATED")) return "A";
  if (score >= 7) return "A";
  if (score >= 4) return "B";
  return "C";
}

// ---------------------------------------------------------------------------
// Research prompt
// ---------------------------------------------------------------------------

const REVIEW_BASE = "https://suchi-api-514521785197.us-central1.run.app/v1/admin/navigator/review";

function buildResearchPrompt(region: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a hospital research assistant for Suchi, an Indian cancer information service focused on East India.

Research cancer treatment hospitals in: ${region}

Each hospital must meet ALL three criteria:
1. At least one oncologist (medical OR surgical) with verifiable presence
2. 2+ treatment modalities (surgery, chemo, radiation, immunotherapy, BMT, etc.)
3. At least one trust signal: NABH/NABL accreditation, NCG membership, TMC affiliation, or Government/AIIMS institution

Find 3–5 hospitals. Prioritise Government hospitals, AIIMS, NCG members, TMC-affiliated.

Return ONLY valid JSON (no markdown fences):
{
  "region": "${region}",
  "researched_at": "${today}",
  "hospitals": [
    {
      "id": "hospital-city-shortname",
      "name": "Full Official Name",
      "short_name": "Short Name",
      "city": "City",
      "state": "State",
      "region": "${region}",
      "type": "Government | Private | Trust | TMC",
      "accreditation": ["NABH"],
      "ncg_member": true,
      "departments": ["medical_oncology", "surgical_oncology", "radiation_oncology"],
      "cost_tier": "Low | Medium | High",
      "pmjay_empanelled": true,
      "contact": { "phone": "+91-...", "address": "Full address", "website": "https://..." },
      "key_doctors": [{ "name": "Dr. Name", "role": "Medical Oncology" }],
      "notes": "Factual one-paragraph summary.",
      "tier": null,
      "navigation_notes": ["Practical tip for patients."],
      "score": null,
      "verified_date": "${today}",
      "status": "draft",
      "confidence": "high | medium | low",
      "sources": ["Source description"]
    }
  ]
}

Department codes: medical_oncology, surgical_oncology, radiation_oncology, chemotherapy, immunotherapy, bone_marrow_transplant, targeted_therapy, palliative_care, head_and_neck_surgery, gynecologic_oncology, hemato_oncology, pediatric_oncology, nuclear_medicine, pathology, radiology, clinical_trials

Set unknown fields to null. Set confidence to "low" for limited information.`;
}

// ---------------------------------------------------------------------------
// Email builder
// ---------------------------------------------------------------------------

function buildApprovalToken(batchId: string): string {
  const secret = process.env.NAVIGATOR_APPROVAL_SECRET ?? "suchi-nav-dev-secret";
  return createHmac("sha256", secret).update(batchId).digest("hex");
}

function buildReviewEmail(batch: ResearchTarget, token: string): string {
  const reviewUrl = `${REVIEW_BASE}/${encodeURIComponent(batch.id)}?token=${token}`;
  const hospitalRows = batch.hospitals.map((h) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee"><strong>${h.name}</strong><br><small>${h.city}, ${h.state}</small></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${h.type}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${h.tier ?? "?"}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${h.confidence}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:700px;margin:auto;padding:20px">
<h2>Navigator — New Hospital Batch Ready for Review</h2>
<p><strong>Region:</strong> ${batch.region}<br>
<strong>Batch ID:</strong> ${batch.id}<br>
<strong>Hospitals:</strong> ${batch.hospitals.length}</p>

<table style="width:100%;border-collapse:collapse;margin:16px 0">
<thead><tr style="background:#f5f5f5">
  <th style="padding:8px;text-align:left">Hospital</th>
  <th style="padding:8px;text-align:left">Type</th>
  <th style="padding:8px;text-align:left">Tier</th>
  <th style="padding:8px;text-align:left">Confidence</th>
</tr></thead>
<tbody>${hospitalRows}</tbody>
</table>

<p><a href="${reviewUrl}" style="background:#1a73e8;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;margin-top:8px">
  Review &amp; Approve Batch
</a></p>
<p style="color:#666;font-size:12px">Suchi Navigator · This email was generated automatically by the daily research scheduler.</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ResearchResult {
  status: "no_pending" | "researched" | "error";
  batchId?: string;
  region?: string;
  hospitalsFound?: number;
  hospitalsRejected?: number;
  emailSent?: boolean;
  message?: string;
}

@Injectable()
export class NavigatorResearchService {
  private readonly logger = new Logger(NavigatorResearchService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly email: EmailService,
  ) {}

  async runResearch(): Promise<ResearchResult> {
    // 1. Load queue
    let queueRaw: string;
    try {
      queueRaw = await gcsRead(GCS_QUEUE_OBJECT);
    } catch (err) {
      this.logger.error("Failed to read queue from GCS", err);
      return { status: "error", message: `GCS read failed: ${String(err)}` };
    }

    const queue = JSON.parse(queueRaw) as QueueFile;
    const target = queue.batches.find((b) => b.status === "pending");

    if (!target) {
      this.logger.log("No pending batches — nothing to do");
      return { status: "no_pending" };
    }

    this.logger.log(`Researching batch: ${target.id} (${target.region})`);

    // 2. Call LLM
    let rawContent: string;
    try {
      rawContent = await this.llm.generate(
        "You are a hospital research assistant. Return only valid JSON, no markdown.",
        "",
        buildResearchPrompt(target.region),
      );
    } catch (err) {
      this.logger.error("LLM call failed", err);
      return { status: "error", batchId: target.id, message: `LLM failed: ${String(err)}` };
    }

    // 3. Parse
    let hospitals: HospitalDraft[];
    try {
      const cleaned = rawContent.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
      const parsed = JSON.parse(cleaned) as { hospitals: HospitalDraft[] };
      hospitals = parsed.hospitals;
    } catch (err) {
      this.logger.error("Failed to parse LLM response", rawContent.slice(0, 500));
      return { status: "error", batchId: target.id, message: "JSON parse failed" };
    }

    // 4. Validate
    const passed: HospitalDraft[] = [];
    let rejected = 0;
    for (const h of hospitals) {
      const result = passesInclusionCriteria(h);
      if (result.pass) {
        passed.push({ ...h, tier: h.tier ?? estimateTier(h, result.score), score: result.score });
      } else {
        rejected++;
        this.logger.warn(`Rejected ${h.name}: ${result.failures.join(", ")}`);
      }
    }

    if (passed.length === 0) {
      this.logger.warn(`No hospitals passed inclusion criteria for ${target.id}`);
      return { status: "error", batchId: target.id, region: target.region, hospitalsFound: 0, hospitalsRejected: rejected, message: "All hospitals failed inclusion criteria" };
    }

    const finalDrafts = passed.slice(0, 5);

    // 5. Build token and update queue
    const token = buildApprovalToken(target.id);
    target.hospitals = finalDrafts;
    target.status = "email_sent";
    (target as ResearchTarget & { approvalToken: string }).approvalToken = token;
    (target as ResearchTarget & { emailSentAt: string }).emailSentAt = new Date().toISOString();

    try {
      await gcsWrite(GCS_QUEUE_OBJECT, JSON.stringify(queue, null, 2) + "\n");
      this.logger.log(`Queue updated → batch "${target.id}" → email_sent`);
    } catch (err) {
      this.logger.error("Failed to write queue to GCS", err);
      return { status: "error", batchId: target.id, message: `GCS write failed: ${String(err)}` };
    }

    // 6. Send email
    const reviewers = [
      process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org",
      "divya.vats@dikshafoundation.org",
      "nisha.kumari@dikshafoundation.org",
    ];
    const emailSent = await this.email.sendEmail({
      to: reviewers.join(", "),
      subject: `Navigator: ${finalDrafts.length} hospitals ready for review — ${target.region}`,
      html: buildReviewEmail(target, token),
    });

    this.logger.log(`Batch "${target.id}" done — ${finalDrafts.length} hospitals, email: ${emailSent}`);

    return {
      status: "researched",
      batchId: target.id,
      region: target.region,
      hospitalsFound: finalDrafts.length,
      hospitalsRejected: rejected,
      emailSent,
    };
  }
}
