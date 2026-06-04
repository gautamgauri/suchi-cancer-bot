/**
 * Navigator Approve Service
 *
 * Handles HMAC-verified approval of hospital research batches from the
 * navigator pipeline. Called when Gautam or Divya clicks "Approve All"
 * in the review email.
 *
 * On approval:
 *   1. Verify HMAC token
 *   2. Load navigator/queue.json, validate batch status
 *   3. Convert HospitalDraft entries → hospitals.json schema
 *   4. Append to apps/landing/src/content/hospitals.json
 *   5. Update queue.json batch → "approved"
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Storage } from "@google-cloud/storage";

// ---------------------------------------------------------------------------
// GCS persistence helpers
// ---------------------------------------------------------------------------

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const GCS_QUEUE_OBJECT = process.env.QUEUE_GCS_OBJECT ?? "queue.json";
const GCS_HOSPITALS_OBJECT = process.env.HOSPITALS_GCS_OBJECT ?? "hospitals.json";

function getStorage(): Storage {
  return new Storage({ projectId: GCS_PROJECT });
}

async function gcsRead(object: string): Promise<string> {
  if (!GCS_BUCKET) throw new Error("GCS_BUCKET not configured");
  const storage = getStorage();
  const [contents] = await storage.bucket(GCS_BUCKET).file(object).download() as [Buffer];
  return contents.toString("utf-8");
}

async function gcsWrite(object: string, content: string): Promise<void> {
  if (!GCS_BUCKET) return;
  const storage = getStorage();
  await storage.bucket(GCS_BUCKET).file(object).save(content, { contentType: "application/json" });
}

/**
 * Read from GCS when bucket is configured, local file otherwise.
 * When GCS is configured and fails — throws immediately (no silent fallback).
 * Silent fallback only in local-dev mode (no bucket set).
 */
async function readJson(localPath: string, gcsObject: string): Promise<string> {
  if (GCS_BUCKET) {
    console.log(`[navigator-approve] Reading gs://${GCS_BUCKET}/${gcsObject}`);
    return gcsRead(gcsObject); // throws on failure — no silent degradation
  }
  console.log(`[navigator-approve] Reading local ${localPath}`);
  return fs.readFile(localPath, "utf-8");
}

/** Write to GCS when bucket configured; also attempt local write (best-effort). */
async function writeJson(localPath: string, gcsObject: string, content: string): Promise<void> {
  if (GCS_BUCKET) {
    console.log(`[navigator-approve] Writing gs://${GCS_BUCKET}/${gcsObject}`);
    await gcsWrite(gcsObject, content); // throws on failure
  }
  // Best-effort local write (may fail in Cloud Run — that's fine)
  await fs.writeFile(localPath, content, "utf-8").catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Inline types (duplicated from navigator/types.ts — don't import across tree)
// ---------------------------------------------------------------------------

type BatchStatus = "pending" | "researched" | "email_sent" | "approved" | "rejected";

export interface HospitalDraft {
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
  contact: {
    phone: string | null;
    address: string | null;
    website?: string | null;
  };
  key_doctors: Array<{ name: string; role: string }>;
  notes: string;
  tier: "A" | "B" | "C" | "D" | null;
  navigation_notes: string[];
  score: number | null;
  verified_date: string;
  status: "draft";
  confidence: "high" | "medium" | "low";
  sources: string[];
}

export interface ResearchTarget {
  id: string;
  region: string;
  status: BatchStatus;
  hospitals: HospitalDraft[];
  createdAt: string;
  emailSentAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalToken?: string;
}

interface QueueFile {
  batches: ResearchTarget[];
}

export interface HospitalUpdates {
  name?: string;
  short_name?: string;
  type?: string;
  tier?: "A" | "B" | "C" | "D" | null;
  score?: number | null;
  confidence?: "high" | "medium" | "low";
  notes?: string;
  cost_tier?: string | null;
  ncg_member?: boolean | null;
  pmjay_empanelled?: boolean | null;
  accreditation?: string[];
  departments?: string[];
  navigation_notes?: string[];
  key_doctors?: Array<{ name: string; role: string }>;
  sources?: string[];
  contact?: {
    phone?: string | null;
    address?: string | null;
    website?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface ApproveResult {
  approved: boolean;
  batchId: string;
  hospitalsAdded: number;
  hospitalNames: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try each candidate path; return the first that exists. */
async function resolveFirstExisting(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // not found — try next
    }
  }
  throw new Error(
    `None of the candidate paths exist:\n${candidates.join("\n")}`,
  );
}

/** Convert a HospitalDraft to a full hospitals.json entry. */
function draftToEntry(draft: HospitalDraft): object {
  return {
    id: draft.id,
    name: draft.name,
    short_name: draft.short_name,
    city: draft.city,
    state: draft.state,
    region: draft.region || "East India",
    type: draft.type,
    accreditation: draft.accreditation,
    ncg_member: draft.ncg_member ?? false,
    tmc_affiliated: draft.accreditation?.includes("TMC_AFFILIATED") ?? false,
    specialization: "Comprehensive",
    departments: draft.departments,
    cost_tier: draft.cost_tier ?? "Medium",
    pmjay_empanelled: draft.pmjay_empanelled ?? null,
    referral_required: false,
    contact: {
      phone: draft.contact.phone ?? null,
      address: draft.contact.address ?? null,
      ...(draft.contact.website ? { website: draft.contact.website } : {}),
    },
    key_doctors: draft.key_doctors ?? [],
    notes: draft.notes ?? "",
    sccf_affiliated: false,
    sccf_notes: "",
    tier: draft.tier ?? null,
    cost_ranges: {
      opd_min: null,
      opd_max: null,
      chemo_day_min: null,
      chemo_day_max: null,
      surgery_package_min: null,
      surgery_package_max: null,
      currency: "INR",
    },
    logistics: {
      nearest_railway: null,
      nearest_airport: null,
      lodging_nearby: null,
      patient_guesthouse: null,
      languages: [],
      telemedicine: null,
    },
    trust_signals: {
      tumor_board: null,
      case_volume_annual: null,
      academic_affiliation: null,
    },
    navigation_notes: draft.navigation_notes ?? [],
    score: draft.score ?? 5,
    score_breakdown: {
      quality: 2,
      cost: 2,
      location: 1,
      pmjay: 0,
      risk: 0,
    },
    verified_date: draft.verified_date,
    status: "active",
    national_referral: (draft as any).national_referral === true ? true : undefined,
  };
}

/** Today's date as YYYY-MM-DD. */
function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class NavigatorApproveService {
  private readonly logger = new Logger(NavigatorApproveService.name);

  constructor() {
    this.logger.log(
      `QUEUE_GCS_BUCKET=${GCS_BUCKET ?? "(not set — local mode)"}`,
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private verifyHmac(batchId: string, token: string): void {
    const secret =
      process.env.NAVIGATOR_APPROVAL_SECRET || "suchi-nav-dev-secret";
    const expected = createHmac("sha256", secret).update(batchId).digest("hex");
    let tokenBuf: Buffer;
    try {
      tokenBuf = Buffer.from(token, "hex");
    } catch {
      throw new UnauthorizedException("Invalid approval token");
    }
    const expectedBuf = Buffer.from(expected, "hex");
    if (
      tokenBuf.length !== expectedBuf.length ||
      !timingSafeEqual(tokenBuf, expectedBuf)
    ) {
      throw new UnauthorizedException("Invalid approval token");
    }
  }

  private async resolveQueuePath(): Promise<string> {
    const candidates = [
      path.resolve(process.cwd(), "navigator/queue.json"),
      path.resolve(__dirname, "../../../../../navigator/queue.json"),
      "/tmp/navigator-queue.json",
    ];
    return resolveFirstExisting(candidates).catch(() => "/tmp/navigator-queue.json");
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  async getBatchForReview(batchId: string, token: string): Promise<ResearchTarget> {
    this.verifyHmac(batchId, token);
    const queuePath = await this.resolveQueuePath();
    const queueRaw = await readJson(queuePath, GCS_QUEUE_OBJECT);
    const queueData = JSON.parse(queueRaw) as QueueFile;
    const batch = queueData.batches.find((b) => b.id === batchId) ?? null;
    if (!batch) throw new NotFoundException(`Batch "${batchId}" not found in queue`);
    return batch;
  }

  async updateBatchHospital(
    batchId: string,
    token: string,
    hospitalId: string,
    updates: HospitalUpdates,
  ): Promise<void> {
    this.verifyHmac(batchId, token);
    const queuePath = await this.resolveQueuePath();
    const queueRaw = await readJson(queuePath, GCS_QUEUE_OBJECT);
    const queueData = JSON.parse(queueRaw) as QueueFile;

    const batch = queueData.batches.find((b) => b.id === batchId) ?? null;
    if (!batch) throw new NotFoundException(`Batch "${batchId}" not found`);
    if (batch.status === "approved")
      throw new BadRequestException("Cannot edit an approved batch");

    const hospital = batch.hospitals.find((h) => h.id === hospitalId) ?? null;
    if (!hospital)
      throw new NotFoundException(`Hospital "${hospitalId}" not found in batch`);

    const scalarFields = [
      "name", "short_name", "type", "tier", "score",
      "confidence", "notes", "cost_tier", "ncg_member", "pmjay_empanelled",
    ] as const;
    for (const field of scalarFields) {
      if (field in updates && updates[field] !== undefined) {
        (hospital as unknown as Record<string, unknown>)[field] = updates[field];
      }
    }

    if (updates.accreditation !== undefined) hospital.accreditation = updates.accreditation;
    if (updates.departments !== undefined) hospital.departments = updates.departments;
    if (updates.navigation_notes !== undefined) hospital.navigation_notes = updates.navigation_notes;
    if (updates.key_doctors !== undefined) hospital.key_doctors = updates.key_doctors;
    if (updates.sources !== undefined) hospital.sources = updates.sources;

    if (updates.contact) {
      if (updates.contact.phone !== undefined) hospital.contact.phone = updates.contact.phone;
      if (updates.contact.address !== undefined) hospital.contact.address = updates.contact.address;
      if (updates.contact.website !== undefined) hospital.contact.website = updates.contact.website;
    }

    const queueJson = JSON.stringify(queueData, null, 2) + "\n";
    await writeJson(queuePath, GCS_QUEUE_OBJECT, queueJson);
    this.logger.log(`Updated hospital "${hospitalId}" in batch "${batchId}"`);
  }

  async approveNavigatorBatch(
    batchId: string,
    token: string,
    approver?: string,
  ): Promise<ApproveResult> {
    // -----------------------------------------------------------------------
    // 1. Verify HMAC token
    // -----------------------------------------------------------------------
    this.verifyHmac(batchId, token);

    // -----------------------------------------------------------------------
    // 2. Resolve local fallback paths (used when GCS is unavailable)
    // -----------------------------------------------------------------------
    const queueLocalCandidates = [
      path.resolve(process.cwd(), "navigator/queue.json"),
      path.resolve(__dirname, "../../../../../navigator/queue.json"),
      "/tmp/navigator-queue.json",
    ];
    const hospitalsLocalCandidates = [
      path.resolve(process.cwd(), "data/hospitals.json"),
      path.resolve(process.cwd(), "apps/landing/src/content/hospitals.json"),
      path.resolve(__dirname, "../../../../../apps/landing/src/content/hospitals.json"),
    ];

    const queuePath = await resolveFirstExisting(queueLocalCandidates).catch(() => "/tmp/navigator-queue.json");
    const hospitalsPath = await resolveFirstExisting(hospitalsLocalCandidates).catch(() => "/tmp/hospitals.json");

    this.logger.log(GCS_BUCKET
      ? `Using GCS bucket: ${GCS_BUCKET} (local fallback: ${queuePath})`
      : `GCS not configured — reading from local: ${queuePath}`
    );

    // -----------------------------------------------------------------------
    // 3. Load and validate queue (GCS primary, local fallback)
    // -----------------------------------------------------------------------
    let queueRaw: string;
    try {
      queueRaw = await readJson(queuePath, GCS_QUEUE_OBJECT);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Cannot load queue: ${(err as Error).message}. Ensure QUEUE_GCS_BUCKET is set or navigator/queue.json is accessible.`
      );
    }
    const queueData = JSON.parse(queueRaw) as QueueFile;
    const batches: ResearchTarget[] = queueData.batches ?? [];

    const batch = batches.find((b) => b.id === batchId) ?? null;

    if (!batch) {
      throw new NotFoundException(`Batch "${batchId}" not found in queue`);
    }

    if (batch.status === "approved") {
      this.logger.log(`Batch ${batchId} already approved — returning early`);
      return {
        approved: true,
        batchId,
        hospitalsAdded: 0,
        hospitalNames: [],
        error: "Already approved",
      };
    }

    if (batch.status !== "email_sent") {
      throw new BadRequestException(
        `Batch not ready for approval (status: ${batch.status})`,
      );
    }

    // -----------------------------------------------------------------------
    // 4. Convert drafts → hospitals.json entries
    // -----------------------------------------------------------------------
    const drafts = batch.hospitals ?? [];
    const entries = drafts.map(draftToEntry);
    const hospitalNames = drafts.map((d) => d.name);

    // -----------------------------------------------------------------------
    // 5. Append to hospitals.json (GCS primary, local fallback)
    // -----------------------------------------------------------------------
    let hospitalsRaw: string;
    try {
      hospitalsRaw = await readJson(hospitalsPath, GCS_HOSPITALS_OBJECT);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Failed to read hospitals.json: ${(err as Error).message}`,
      );
    }

    let hospitalsData: { _meta: { total_hospitals: number; last_updated: string; [key: string]: unknown }; hospitals: object[]; [key: string]: unknown };
    try {
      hospitalsData = JSON.parse(hospitalsRaw);
    } catch (err) {
      throw new ServiceUnavailableException(
        `hospitals.json is malformed: ${(err as Error).message}`,
      );
    }

    for (const entry of entries) {
      hospitalsData.hospitals.push(entry);
    }
    hospitalsData._meta.total_hospitals =
      (hospitalsData._meta.total_hospitals ?? 0) + entries.length;
    hospitalsData._meta.last_updated = todayIso();

    const hospitalsJson = JSON.stringify(hospitalsData, null, 2) + "\n";
    await writeJson(hospitalsPath, GCS_HOSPITALS_OBJECT, hospitalsJson);

    this.logger.log(
      `Appended ${entries.length} hospital(s) to hospitals.json for batch ${batchId}`,
    );

    // -----------------------------------------------------------------------
    // 6. Update queue.json batch → "approved"
    // -----------------------------------------------------------------------
    const updatedBatches: ResearchTarget[] = batches.map((b) =>
      b.id === batchId
        ? {
            ...b,
            status: "approved" as BatchStatus,
            approvedAt: new Date().toISOString(),
            approvedBy: approver ?? "portal_approval",
          }
        : b,
    );

    const queueJson = JSON.stringify({ batches: updatedBatches }, null, 2) + "\n";
    await writeJson(queuePath, GCS_QUEUE_OBJECT, queueJson);

    this.logger.log(`Batch ${batchId} approved — ${entries.length} hospital(s) added`);

    return {
      approved: true,
      batchId,
      hospitalsAdded: entries.length,
      hospitalNames,
    };
  }
}
