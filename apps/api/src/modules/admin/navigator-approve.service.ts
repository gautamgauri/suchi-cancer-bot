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

// ---------------------------------------------------------------------------
// GCS persistence helpers (opt-in via QUEUE_GCS_BUCKET env var)
// ---------------------------------------------------------------------------

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";

async function gcsWrite(object: string, content: string): Promise<void> {
  if (!GCS_BUCKET) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const { Storage } = require("@google-cloud/storage") as any;
    const storage = new Storage({ projectId: GCS_PROJECT });
    await storage.bucket(GCS_BUCKET).file(object).save(content, { contentType: "application/json" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log but don't throw — local write already succeeded
    console.warn(`[navigator-approve] GCS write failed for ${object}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Inline types (duplicated from navigator/types.ts — don't import across tree)
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

interface ResearchTarget {
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

  async approveNavigatorBatch(
    batchId: string,
    token: string,
  ): Promise<ApproveResult> {
    // -----------------------------------------------------------------------
    // 1. Verify HMAC token
    // -----------------------------------------------------------------------
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

    // Lengths must match before timingSafeEqual or it throws
    if (
      tokenBuf.length !== expectedBuf.length ||
      !timingSafeEqual(tokenBuf, expectedBuf)
    ) {
      throw new UnauthorizedException("Invalid approval token");
    }

    // -----------------------------------------------------------------------
    // 2. Resolve file paths
    // -----------------------------------------------------------------------
    const queuePath = await resolveFirstExisting([
      path.resolve(process.cwd(), "navigator/queue.json"),
      path.resolve(__dirname, "../../../../../navigator/queue.json"),
    ]).catch(() => {
      throw new Error("navigator/queue.json not found — check working directory");
    });

    const hospitalsPath = await resolveFirstExisting([
      path.resolve(process.cwd(), "apps/landing/src/content/hospitals.json"),
      path.resolve(
        __dirname,
        "../../../../../apps/landing/src/content/hospitals.json",
      ),
    ]).catch(() => {
      throw new Error(
        "apps/landing/src/content/hospitals.json not found — check working directory",
      );
    });

    this.logger.log(`Resolved queue: ${queuePath}`);
    this.logger.log(`Resolved hospitals: ${hospitalsPath}`);

    // -----------------------------------------------------------------------
    // 3. Load and validate queue
    // -----------------------------------------------------------------------
    const queueRaw = await fs.readFile(queuePath, "utf-8");
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
    // 5. Append to hospitals.json
    // -----------------------------------------------------------------------
    let hospitalsRaw: string;
    try {
      hospitalsRaw = await fs.readFile(hospitalsPath, "utf-8");
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
    try {
      await fs.writeFile(hospitalsPath, hospitalsJson, "utf-8");
    } catch (err) {
      throw new ServiceUnavailableException(
        `Failed to write hospitals.json: ${(err as Error).message}`,
      );
    }
    // Mirror to GCS so the daily-researcher job and the next API deploy see the updated list
    await gcsWrite(process.env.HOSPITALS_GCS_OBJECT ?? "hospitals.json", hospitalsJson);

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
            approvedBy: "email_approval",
          }
        : b,
    );

    const queueJson = JSON.stringify({ batches: updatedBatches }, null, 2) + "\n";
    try {
      await fs.writeFile(queuePath, queueJson, "utf-8");
    } catch (err) {
      // hospitals.json already updated — log the inconsistency but don't throw
      this.logger.error(
        `WARNING: hospitals.json updated but queue.json write failed: ${(err as Error).message}`,
      );
    }
    await gcsWrite(process.env.QUEUE_GCS_OBJECT ?? "queue.json", queueJson);

    this.logger.log(`Batch ${batchId} approved — ${entries.length} hospital(s) added`);

    return {
      approved: true,
      batchId,
      hospitalsAdded: entries.length,
      hospitalNames,
    };
  }
}
