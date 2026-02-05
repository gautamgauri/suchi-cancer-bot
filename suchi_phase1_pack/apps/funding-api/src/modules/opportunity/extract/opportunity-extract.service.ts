import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import type { ParsedEmail } from "../../gmail/gmail.types";
import type { ArchiveResult } from "../opportunity-archive.service";
import type { OpportunityDocument, OpportunityPayload } from "../opportunity.types";
import { RfpTextExtractService } from "./rfp-text-extract.service";
import { RfpConstraintsExtractService, type ExtractedConstraints } from "./rfp-constraints-extract.service";
import { AnnexureSchemaService, type SheetSchema } from "./annexure-schema.service";

const RFP_STAGE = "RFP_received";

// Default owner/reviewer configuration (loaded from env if available)
interface DefaultContact {
  name: string;
  email: string;
  role?: string;
}

export interface ExtractInput {
  parsed: ParsedEmail;
  archive: ArchiveResult;
  attachmentBuffers: Array<{
    filename: string;
    mimeType: string;
    buffer: Buffer;
    driveFileId: string;
    driveUrl?: string;
    checksum: string;
    sizeBytes: number;
  }>;
  defaultOwner?: { name: string; email: string; role?: string };
  defaultReviewers?: Array<{ name: string; email: string; role?: string }>;
}

@Injectable()
export class OpportunityExtractService {
  private readonly logger = new Logger(OpportunityExtractService.name);
  private readonly defaultOwnerConfig: DefaultContact | null;
  private readonly defaultReviewersConfig: DefaultContact[];

  constructor(
    private readonly configService: ConfigService,
    private readonly rfpText: RfpTextExtractService,
    private readonly rfpConstraints: RfpConstraintsExtractService,
    private readonly annexureSchema: AnnexureSchemaService,
  ) {
    // Load default owner from env (format: "Name|email@domain.com|Role")
    const ownerEnv = this.configService.get<string>("FUNDING_DEFAULT_OWNER");
    if (ownerEnv) {
      const parts = ownerEnv.split("|");
      if (parts.length >= 2) {
        this.defaultOwnerConfig = {
          name: parts[0].trim(),
          email: parts[1].trim(),
          role: parts[2]?.trim(),
        };
      } else {
        this.defaultOwnerConfig = null;
      }
    } else {
      this.defaultOwnerConfig = null;
    }

    // Load default reviewers from env (format: "Name1|email1|Role1,Name2|email2|Role2")
    const reviewersEnv = this.configService.get<string>("FUNDING_DEFAULT_REVIEWERS");
    this.defaultReviewersConfig = [];
    if (reviewersEnv) {
      for (const entry of reviewersEnv.split(",")) {
        const parts = entry.split("|");
        if (parts.length >= 2) {
          this.defaultReviewersConfig.push({
            name: parts[0].trim(),
            email: parts[1].trim(),
            role: parts[2]?.trim(),
          });
        }
      }
    }
  }

  private getDefaultOwner(): DefaultContact {
    return this.defaultOwnerConfig ?? { name: "Default Owner", email: "owner@example.com", role: "Fundraising" };
  }

  private getDefaultReviewers(): DefaultContact[] {
    return this.defaultReviewersConfig.length > 0
      ? this.defaultReviewersConfig
      : [{ name: "Default Reviewer", email: "reviewer@example.com", role: "Review" }];
  }

  /**
   * Build full Opportunity JSON from email, archive, and extracted constraints.
   */
  async buildOpportunityDocument(input: ExtractInput): Promise<OpportunityDocument> {
    const { parsed, archive, attachmentBuffers, defaultOwner, defaultReviewers } = input;
    const bodyHash = parsed.bodyPlain
      ? "sha256:" + createHash("sha256").update(parsed.bodyPlain).digest("hex")
      : undefined;

    const sourceAttachments = attachmentBuffers.map((a) => ({
      fileName: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      driveFileId: a.driveFileId,
      driveUrl: a.driveUrl,
      checksum: a.checksum,
    }));

    let constraints: ExtractedConstraints = {};
    const rfpBuffer = attachmentBuffers.find(
      (a) =>
        a.mimeType === "application/pdf" ||
        a.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    if (rfpBuffer) {
      const text = await this.rfpText.extractText(rfpBuffer.mimeType, rfpBuffer.buffer);
      if (text) {
        constraints = await this.rfpConstraints.extract(text, parsed.subject);
      }
    }

    const requiredTemplates = attachmentBuffers.map((a) => ({
      templateName: a.filename.replace(/\.[^.]*$/, ""),
      sourceFile: a.filename,
      driveFileId: a.driveFileId,
      outputArtifact: this.annexureSchema.isSpreadsheet(a.mimeType) ? ("sheet" as const) : ("doc" as const),
    }));

    const opportunityId = this.deriveOpportunityId(parsed.subject, parsed.messageId, constraints);

    const payload: OpportunityPayload = {
      opportunityId,
      sourceType: "email",
      source: {
        emailMessageId: parsed.messageId,
        threadId: parsed.threadId,
        receivedAt: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        subject: parsed.subject,
        bodyHash,
        attachments: sourceAttachments,
      },
      funder: {
        name: constraints.funderName ?? parsed.from.name ?? parsed.from.email,
        programName: constraints.programName,
        grantCycle: constraints.grantCycle,
        funderType: "foundation",
        submissionEmail: constraints.submissionEmail ?? parsed.from.email,
      },
      keyConstraints: {
        maxGrantAmountINR: constraints.maxGrantAmountINR,
        projectDurationMonthsMax: constraints.projectDurationMonthsMax,
        deadline: constraints.deadline,
        geography: constraints.geography,
      },
      themes: constraints.themes,
      eligibility: { notes: "Populate from RFP parsing when available", mustHaves: [], niceToHaves: [], exclusions: [] },
      requiredTemplates,
      extractedRequirements: {
        summary: constraints.summary,
        scoringSignals: constraints.scoringSignals,
        reportingCadence: constraints.reportingCadence,
        mandatorySections: [],
        complianceDocuments: [],
      },
      internal: {
        org: this.configService.get<string>("FUNDING_ORG_NAME") ?? "Diksha Foundation",
        owner: defaultOwner ?? this.getDefaultOwner(),
        reviewers: defaultReviewers ?? this.getDefaultReviewers(),
        pipelineStage: RFP_STAGE,
        priority: "high",
        driveFolder: {
          path: archive.folderPath,
          driveFolderId: archive.driveFolderId,
          driveUrl: archive.driveFolderUrl,
        },
      },
      automationPlan: {
        actions: [
          { type: "create_tracker_row", status: "pending" },
          { type: "generate_ack_email_draft", status: "pending" },
          { type: "generate_proposal_outline", status: "pending" },
          { type: "populate_annexure_1_gantt", status: "pending" },
          { type: "populate_annexure_2_mel", status: "pending" },
        ],
        missingInputs: [],
      },
      audit: {
        createdAt: new Date().toISOString(),
        createdBy: "funding-bot",
        lastUpdatedAt: new Date().toISOString(),
        lastUpdatedBy: "funding-bot",
      },
    };

    return { schemaVersion: "1.0", opportunity: payload };
  }

  /**
   * Parse annexure (XLSX) buffers and return sheet schemas for pre-fill.
   */
  getAnnexureSchemas(attachmentBuffers: Array<{ mimeType: string; buffer: Buffer }>): Map<string, SheetSchema[]> {
    const map = new Map<string, SheetSchema[]>();
    for (const a of attachmentBuffers) {
      if (!this.annexureSchema.isSpreadsheet(a.mimeType)) continue;
      const schemas = this.annexureSchema.parseSheetSchema(a.buffer);
      map.set(a.mimeType + ":" + a.buffer.length, schemas);
    }
    return map;
  }

  private deriveOpportunityId(subject: string, messageId: string, c: ExtractedConstraints): string {
    const slug = (c.funderName ?? "RF")
      .replace(/\s+/g, "")
      .slice(0, 20);
    const cycle = (c.grantCycle ?? new Date().getFullYear().toString()).replace(/\s/g, "");
    const shortId = messageId.slice(-8);
    return `${slug}-${cycle}-${shortId}`;
  }
}
