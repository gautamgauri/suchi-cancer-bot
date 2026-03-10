import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { SccfDriveClientService } from "./drive-client.service";
import { SccfGmailAttachmentService } from "./gmail-attachment.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { ChunkingService } from "../evidence_ingest/chunking.service";
import { EmbeddingService } from "../evidence_ingest/embedding.service";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ numpages: number; text: string }>;

const MIN_TEXT_LENGTH = 50;

const VALID_CATEGORIES = [
  "clinical_protocol", "patient_education", "report", "proposal",
  "budget", "research", "training_material", "policy",
  "communications", "admin", "other",
] as const;

function htmlToPlainText(html: string): string {
  let text = html
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.join("\n\n");
}

function normalizeCleanText(text: string): string {
  if (!text?.trim()) return text || "";
  let out = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const lines = out.split("\n");
  const seen = new Map<string, number>();
  const deduped: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { deduped.push(""); continue; }
    const count = (seen.get(t) ?? 0) + 1;
    seen.set(t, count);
    if (count <= 2) deduped.push(line);
  }
  return deduped.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface IndexSourceResult {
  added: number;
  unchanged: number;
}

export interface IndexAllResult {
  drive: IndexSourceResult;
  gmail: IndexSourceResult;
  total: { added: number; unchanged: number };
}

export interface CategorizeResult {
  categorized: number;
  failed: number;
}

export interface IngestResult {
  ingested: number;
  skipped: number;
  failed: number;
}

@Injectable()
export class SccfIngestService {
  private readonly logger = new Logger(SccfIngestService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly driveClient: SccfDriveClientService,
    private readonly gmailClient: SccfGmailAttachmentService,
    private readonly prisma: PrismaService,
    private readonly llm: FundingLlmService,
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
  ) {}

  async indexDrive(): Promise<IndexSourceResult> {
    const folderId = this.configService.get<string>("SCCF_DRIVE_FOLDER_ID");
    if (!folderId) throw new Error("SCCF_DRIVE_FOLDER_ID is required for Drive indexing");
    if (!this.driveClient.isConfigured()) throw new Error("SCCF Drive client not configured");

    const files = await this.driveClient.listFilesRecursive(folderId);
    this.logger.log(`Drive listing returned ${files.length} files`);

    let added = 0;
    let unchanged = 0;

    for (const f of files) {
      const driveUrl = f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`;
      const existing = await this.prisma.sccfDocument.findUnique({
        where: { externalId: f.id },
      });

      if (existing) {
        unchanged++;
      } else {
        await this.prisma.sccfDocument.create({
          data: {
            sourceType: "drive",
            externalId: f.id,
            name: f.name,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes || null,
            driveUrl,
            modifiedTime: f.modifiedTime ? new Date(f.modifiedTime) : null,
          },
        });
        added++;
      }
    }

    this.logger.log(`Drive index complete: ${added} added, ${unchanged} unchanged`);
    return { added, unchanged };
  }

  async indexGmail(): Promise<IndexSourceResult> {
    if (!this.gmailClient.isConfigured()) throw new Error("SCCF Gmail client not configured");

    const attachments = await this.gmailClient.searchAttachments();
    this.logger.log(`Gmail scan returned ${attachments.length} attachments`);

    let added = 0;
    let unchanged = 0;

    for (const att of attachments) {
      const existing = await this.prisma.sccfDocument.findUnique({
        where: { externalId: att.externalId },
      });

      if (existing) {
        unchanged++;
      } else {
        await this.prisma.sccfDocument.create({
          data: {
            sourceType: "gmail_attachment",
            externalId: att.externalId,
            name: att.filename,
            mimeType: att.mimeType,
            sizeBytes: att.sizeBytes || null,
            emailSubject: att.emailSubject || null,
            emailFrom: att.emailFrom || null,
            emailDate: att.emailDate,
          },
        });
        added++;
      }
    }

    this.logger.log(`Gmail index complete: ${added} added, ${unchanged} unchanged`);
    return { added, unchanged };
  }

  async indexAll(): Promise<IndexAllResult> {
    const [drive, gmail] = await Promise.allSettled([
      this.indexDrive(),
      this.indexGmail(),
    ]);

    const driveResult = drive.status === "fulfilled" ? drive.value : { added: 0, unchanged: 0 };
    const gmailResult = gmail.status === "fulfilled" ? gmail.value : { added: 0, unchanged: 0 };

    if (drive.status === "rejected") this.logger.error("Drive indexing failed", (drive.reason as Error)?.message);
    if (gmail.status === "rejected") this.logger.error("Gmail indexing failed", (gmail.reason as Error)?.message);

    return {
      drive: driveResult,
      gmail: gmailResult,
      total: {
        added: driveResult.added + gmailResult.added,
        unchanged: driveResult.unchanged + gmailResult.unchanged,
      },
    };
  }

  async listDocuments(params: { page?: number; pageSize?: number }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.sccfDocument.findMany({ skip, take: pageSize, orderBy: { indexedAt: "desc" } }),
      this.prisma.sccfDocument.count(),
    ]);

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getSummary() {
    const [bySource, byMime, byStatus] = await Promise.all([
      this.prisma.sccfDocument.groupBy({ by: ["sourceType"], _count: { id: true } }),
      this.prisma.sccfDocument.groupBy({ by: ["mimeType"], _count: { id: true }, orderBy: { _count: { id: "desc" } } }),
      this.prisma.sccfDocument.groupBy({ by: ["ingestStatus"], _count: { id: true } }),
    ]);

    return {
      bySourceType: Object.fromEntries(bySource.map((r) => [r.sourceType, r._count.id])),
      byMimeType: Object.fromEntries(byMime.map((r) => [r.mimeType, r._count.id])),
      byIngestStatus: Object.fromEntries(byStatus.map((r) => [r.ingestStatus, r._count.id])),
    };
  }

  /**
   * Phase 2: LLM categorization of uncategorized SccfDocuments.
   */
  async categorizeDocuments(options?: { limit?: number }): Promise<CategorizeResult> {
    const batchLimit = options?.limit ?? 100;
    const docs = await this.prisma.sccfDocument.findMany({
      where: { category: null },
      take: batchLimit,
    });
    this.logger.log(`Found ${docs.length} uncategorized SCCF documents`);

    let categorized = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        const systemPrompt = `You are a document classifier for a cancer care foundation (SCCF — Suchitra Cancer Care Foundation).
Classify the document into exactly one category from this list:
${VALID_CATEGORIES.join(", ")}

Respond with valid JSON only: {"category":"...","topicTags":["..."],"note":"one-line reason"}`;

        const context = [
          `Filename: ${doc.name}`,
          `MIME type: ${doc.mimeType}`,
          doc.emailSubject ? `Email subject: ${doc.emailSubject}` : null,
          doc.emailFrom ? `From: ${doc.emailFrom}` : null,
        ].filter(Boolean).join("\n");

        const raw = await this.llm.generatePlain(systemPrompt, context, "Classify this document.");
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          this.logger.warn(`No JSON in LLM response for ${doc.name}: ${raw.slice(0, 200)}`);
          failed++;
          continue;
        }
        const parsed = JSON.parse(jsonMatch[0]) as { category: string; topicTags?: string[]; note?: string };
        const category = VALID_CATEGORIES.includes(parsed.category as typeof VALID_CATEGORIES[number])
          ? parsed.category
          : "other";

        await this.prisma.sccfDocument.update({
          where: { id: doc.id },
          data: {
            category,
            topicTags: parsed.topicTags ?? [],
            categoryNote: parsed.note ?? null,
          },
        });
        categorized++;
      } catch (e) {
        failed++;
        this.logger.warn(`Categorization failed for ${doc.name}: ${(e as Error).message}`);
      }
    }

    this.logger.log(`Categorization complete: ${categorized} categorized, ${failed} failed`);
    return { categorized, failed };
  }

  /**
   * Phase 3: Download, extract text, and create EvidenceDocument records for pending SccfDocuments.
   */
  async ingestToEvidenceLibrary(options?: { category?: string; limit?: number }): Promise<IngestResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { ingestStatus: "pending" };
    if (options?.category) where.category = options.category;

    const batchLimit = options?.limit ?? 50; // process in batches to avoid Cloud Run timeouts
    const docs = await this.prisma.sccfDocument.findMany({ where, take: batchLimit });
    this.logger.log(`Found ${docs.length} pending SCCF documents for ingestion`);

    let ingested = 0;
    let skipped = 0;
    let failed = 0;

    for (const doc of docs) {
      try {
        // 1. Download content
        let buffer: Buffer;
        let exportMime: string | undefined;

        if (doc.sourceType === "drive") {
          const result = await this.driveClient.getFileContent(doc.externalId, doc.mimeType);
          buffer = result.buffer;
          exportMime = result.exportMime;
        } else if (doc.sourceType === "gmail_attachment") {
          const [messageId, attachmentId] = doc.externalId.split("::");
          if (!messageId || !attachmentId) {
            this.logger.warn(`Invalid externalId for gmail attachment: ${doc.externalId}`);
            failed++;
            continue;
          }
          buffer = await this.gmailClient.downloadAttachment(messageId, attachmentId);
        } else {
          this.logger.warn(`Unknown sourceType: ${doc.sourceType} for ${doc.name}`);
          failed++;
          continue;
        }

        // 2. Extract text
        let rawText: string;
        const isGoogleDoc = doc.mimeType.startsWith("application/vnd.google-apps.");
        const isPdf = doc.mimeType === "application/pdf";

        if (isGoogleDoc || exportMime === "text/html") {
          rawText = htmlToPlainText(buffer.toString("utf-8"));
        } else if (isPdf) {
          const parsed = await pdfParse(buffer);
          rawText = (parsed.text || "").trim();
        } else if (exportMime === "text/plain" || doc.mimeType.startsWith("text/")) {
          rawText = buffer.toString("utf-8").trim();
        } else {
          this.logger.log(`Unsupported mimeType ${doc.mimeType} for ${doc.name}, skipping`);
          await this.prisma.sccfDocument.update({
            where: { id: doc.id },
            data: { ingestStatus: "skipped" },
          });
          skipped++;
          continue;
        }

        // 3. Skip if too short
        if (rawText.length < MIN_TEXT_LENGTH) {
          this.logger.log(`Text too short (${rawText.length} chars) for ${doc.name}, skipping`);
          await this.prisma.sccfDocument.update({
            where: { id: doc.id },
            data: { ingestStatus: "skipped" },
          });
          skipped++;
          continue;
        }

        const cleanText = normalizeCleanText(rawText);

        // 4. Create EvidenceDocument
        const now = new Date();
        const evidenceDoc = await this.prisma.evidenceDocument.create({
          data: {
            sourceFolder: "sccf_ingest",
            corpus: "sccf_internal",
            orgId: "sccf",
            qualityTier: "A",
            qualityScore: 85,
            driveFileId: `sccf::${doc.externalId}`,
            name: doc.name,
            mimeType: doc.mimeType,
            createdTime: doc.emailDate ?? doc.modifiedTime ?? now,
            modifiedTime: doc.modifiedTime ?? now,
            downloadStatus: "success",
            rawText,
            cleanText,
            extractionStatus: "success",
            extractionMeta: {
              source: "sccf_ingest",
              sccfDocId: doc.id,
              category: doc.category,
              emailSubject: doc.emailSubject,
            },
          },
        });

        // 5. Update SccfDocument
        await this.prisma.sccfDocument.update({
          where: { id: doc.id },
          data: {
            ingestStatus: "ingested",
            kbDocId: evidenceDoc.id,
          },
        });

        ingested++;
        this.logger.log(`Ingested ${doc.name} → EvidenceDocument ${evidenceDoc.id}`);
      } catch (e) {
        failed++;
        const errMsg = (e as Error).message || "unknown error";
        this.logger.warn(`Ingestion failed for ${doc.name}: ${errMsg}`);
        // Mark as failed so we don't retry the same broken doc forever
        try {
          await this.prisma.sccfDocument.update({
            where: { id: doc.id },
            data: { ingestStatus: "failed" },
          });
        } catch (updateErr) {
          this.logger.error(`Could not mark ${doc.name} as failed: ${(updateErr as Error).message}`);
        }
      }
    }

    this.logger.log(`Ingestion complete: ${ingested} ingested, ${skipped} skipped, ${failed} failed`);
    return { ingested, skipped, failed };
  }

  /**
   * Full pipeline: categorize → ingest → chunk → embed.
   */
  async ingestFull(options?: { category?: string }): Promise<{
    categorize: CategorizeResult;
    ingest: IngestResult;
    chunk: { created: number };
    embed: { embedded: number };
  }> {
    // Phase 2
    const categorize = await this.categorizeDocuments();

    // Phase 3
    const ingest = await this.ingestToEvidenceLibrary(options);

    // Chunk new evidence docs from sccf_ingest
    const chunkResult = await this.chunking.chunkEligibleDocuments();

    // Embed pending chunks
    const embedResult = await this.embedding.embedPendingChunks();

    return {
      categorize,
      ingest,
      chunk: { created: chunkResult.createdChunks },
      embed: { embedded: embedResult.embedded },
    };
  }
}
