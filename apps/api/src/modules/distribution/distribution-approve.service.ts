import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// GCS persistence helpers — mirrors navigator-approve.service.ts and the
// distribution/daily-publisher.ts pattern (same env var names so the API and
// the scheduled publisher read/write the exact same queue object).
// ---------------------------------------------------------------------------

const GCS_BUCKET = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const GCS_QUEUE_OBJECT = process.env.DIST_QUEUE_GCS_OBJECT ?? "dist-queue.json";

console.log(
  `[distribution-approve] QUEUE_GCS_BUCKET=${GCS_BUCKET ?? "(not set — local mode)"}`,
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getStorage(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const { Storage } = require("@google-cloud/storage") as any;
  return new Storage({ projectId: GCS_PROJECT });
}

async function gcsRead(object: string): Promise<string> {
  if (!GCS_BUCKET) throw new Error("GCS_BUCKET not configured");
  const storage = await getStorage();
  const [contents] = (await storage
    .bucket(GCS_BUCKET)
    .file(object)
    .download()) as [Buffer];
  return contents.toString("utf-8");
}

async function gcsWrite(object: string, content: string): Promise<void> {
  if (!GCS_BUCKET) return;
  const storage = await getStorage();
  await storage
    .bucket(GCS_BUCKET)
    .file(object)
    .save(content, { contentType: "application/json" });
}

/**
 * Read from GCS when bucket is configured, local file otherwise.
 * When GCS is configured and fails — throws immediately (no silent fallback).
 */
async function readJson(localPath: string, gcsObject: string): Promise<string> {
  if (GCS_BUCKET) {
    console.log(`[distribution-approve] Reading gs://${GCS_BUCKET}/${gcsObject}`);
    return gcsRead(gcsObject);
  }
  console.log(`[distribution-approve] Reading local ${localPath}`);
  return fs.readFile(localPath, "utf-8");
}

/** Write to GCS when bucket configured; also attempt local write (best-effort). */
async function writeJson(
  localPath: string,
  gcsObject: string,
  content: string,
): Promise<void> {
  if (GCS_BUCKET) {
    console.log(`[distribution-approve] Writing gs://${GCS_BUCKET}/${gcsObject}`);
    await gcsWrite(gcsObject, content);
  }
  await fs.writeFile(localPath, content, "utf-8").catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Queue types — kept in sync with distribution/daily-publisher.ts.
// (Duplicated rather than imported to avoid a cross-tree import into the
// standalone distribution/ TypeScript project.)
// ---------------------------------------------------------------------------

type QueueStatus =
  | "pending"
  | "generated"
  | "email_sent"
  | "approved"
  | "posted"
  | "failed"
  | "changes_requested";

interface QueueEntry {
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DistributionApproveService {
  private readonly logger = new Logger(DistributionApproveService.name);

  // Repo-root distribution/queue.json. apps/api is the cwd in Cloud Run and in
  // local dev, so resolve relative to cwd up one level into distribution/.
  private readonly queueLocalPath = path.resolve(
    process.cwd(),
    "../../distribution/queue.json",
  );

  private verifyToken(slug: string, token: string): void {
    const secret =
      process.env.DISTRIBUTION_APPROVAL_SECRET || "suchi-dist-dev-secret";
    const expected = createHmac("sha256", secret).update(slug).digest("hex");

    let tokenBuf: Buffer;
    try {
      tokenBuf = Buffer.from(token ?? "", "hex");
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

  private async loadQueue(): Promise<{ entries: QueueEntry[] }> {
    let queueRaw: string;
    try {
      queueRaw = await readJson(this.queueLocalPath, GCS_QUEUE_OBJECT);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Cannot load distribution queue: ${(err as Error).message}`,
      );
    }
    const raw = JSON.parse(queueRaw) as QueueFile;
    return { entries: raw.articles ?? [] };
  }

  private async saveQueue(entries: QueueEntry[]): Promise<void> {
    const content = JSON.stringify({ articles: entries }, null, 2) + "\n";
    await writeJson(this.queueLocalPath, GCS_QUEUE_OBJECT, content);
  }

  /**
   * Approve a pack: flip its queue status to "approved". The scheduled
   * distribution/daily-publisher.ts picks up "approved" entries and posts
   * them to the social platforms — keeping posting decoupled from this HTTP
   * surface (no synchronous posting on the request path).
   */
  async approvePack(
    slug: string,
    token: string,
    approvedBy?: string,
  ): Promise<{ ok: true } | { error: string }> {
    this.verifyToken(slug, token);

    const { entries } = await this.loadQueue();
    const entry = entries.find((e) => e.slug === slug);
    if (!entry) {
      throw new NotFoundException(`Pack "${slug}" not found in queue`);
    }

    if (
      entry.status === "approved" ||
      entry.status === "posted"
    ) {
      this.logger.log(`Pack ${slug} already ${entry.status} — returning early`);
      return { error: "Already approved" };
    }

    const updatedEntries = entries.map((e) =>
      e.slug === slug
        ? {
            ...e,
            status: "approved" as QueueStatus,
            approvedBy: approvedBy ?? "email_approval",
            approvedAt: new Date().toISOString(),
          }
        : e,
    );
    await this.saveQueue(updatedEntries);

    this.logger.log(`Pack ${slug} approved — queued for the daily publisher`);
    return { ok: true };
  }

  async rejectPack(
    slug: string,
    token: string,
  ): Promise<{ ok: true } | { error: string }> {
    this.verifyToken(slug, token);

    const { entries } = await this.loadQueue();
    const entry = entries.find((e) => e.slug === slug);
    if (!entry) {
      throw new NotFoundException(`Pack "${slug}" not found in queue`);
    }

    if (entry.status === "changes_requested") {
      return { error: "Already rejected" };
    }

    const updatedEntries = entries.map((e) =>
      e.slug === slug
        ? {
            ...e,
            status: "changes_requested" as QueueStatus,
            processedAt: new Date().toISOString(),
          }
        : e,
    );
    await this.saveQueue(updatedEntries);

    this.logger.log(`Pack ${slug} marked as changes_requested`);
    return { ok: true };
  }
}
