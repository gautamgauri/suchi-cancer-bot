import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import { DriveClientService } from "../evidence_ingest/drive-client.service";
import type { ParsedEmail } from "../gmail/gmail.types";

export interface ArchiveResult {
  driveFolderId: string;
  driveFolderUrl?: string;
  folderPath: string;
  attachmentResults: Array<{
    fileName: string;
    driveFileId: string;
    driveUrl?: string;
    checksum: string;
    sizeBytes: number;
  }>;
  rawEmailFileId?: string;
}

/**
 * Creates standardized opportunity folder in Drive and uploads raw email + attachments with checksums.
 * Folder path: Fundbot/Opportunities/{year}/{FunderName}_{Program}_{Year}/
 */
@Injectable()
export class OpportunityArchiveService {
  private readonly logger = new Logger(OpportunityArchiveService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly driveClient: DriveClientService,
  ) {}

  getArchiveRootId(): string | null {
    return this.configService.get<string>("FUNDING_DRIVE_ARCHIVE_ROOT_ID") ?? null;
  }

  isConfigured(): boolean {
    return !!this.getArchiveRootId() && this.driveClient.isConfigured();
  }

  /**
   * Build folder name from email subject and date for path like "RelianceFoundation_ESA_2026-27".
   */
  buildFolderName(subject: string, dateIso?: string): string {
    const year = dateIso ? dateIso.slice(0, 4) : new Date().getFullYear().toString();
    const sanitized = subject
      .replace(/\s*\|\s*RFP\s*$/i, "")
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const slug = sanitized.replace(/\s/g, "_") || "Opportunity";
    return `${slug}_${year}`;
  }

  /**
   * Archive parsed email and attachments to Drive. Returns folder id and file metadata with checksums.
   */
  async archive(
    parsed: ParsedEmail,
    attachmentBuffers: Array<{ filename: string; mimeType: string; buffer: Buffer }>,
  ): Promise<ArchiveResult> {
    const rootId = this.getArchiveRootId();
    if (!rootId) {
      throw new Error("FUNDING_DRIVE_ARCHIVE_ROOT_ID not set");
    }
    if (!this.driveClient.isConfigured()) {
      throw new Error("Drive client not configured");
    }

    const year = parsed.date ? new Date(parsed.date).getFullYear() : new Date().getFullYear();
    const folderName = this.buildFolderName(parsed.subject, parsed.date ? new Date(parsed.date).toISOString() : undefined);
    const pathSegments = ["Fundbot", "Opportunities", String(year), folderName];
    const { id: driveFolderId, webViewLink: driveFolderUrl } =
      await this.driveClient.ensureFolderPath(rootId, pathSegments);
    const folderPath = pathSegments.join("/");

    const attachmentResults: ArchiveResult["attachmentResults"] = [];
    for (let i = 0; i < attachmentBuffers.length; i++) {
      const att = attachmentBuffers[i];
      const checksum = "sha256:" + createHash("sha256").update(att.buffer).digest("hex");
      const safeName = (att.filename || `attachment_${i}`).replace(/[/\\?*:]/g, "_");
      const uploaded = await this.driveClient.uploadFile({
        name: safeName,
        mimeType: att.mimeType,
        parentId: driveFolderId,
        buffer: att.buffer,
      });
      attachmentResults.push({
        fileName: safeName,
        driveFileId: uploaded.id,
        driveUrl: uploaded.webViewLink,
        checksum,
        sizeBytes: att.buffer.length,
      });
    }

    const rawEmailJson = JSON.stringify(
      {
        messageId: parsed.messageId,
        threadId: parsed.threadId,
        subject: parsed.subject,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        date: parsed.date,
        bodyPlain: parsed.bodyPlain?.slice(0, 50000),
        snippet: parsed.snippet,
        attachmentMeta: attachmentResults.map((a) => ({
          fileName: a.fileName,
          driveFileId: a.driveFileId,
          checksum: a.checksum,
          sizeBytes: a.sizeBytes,
        })),
      },
      null,
      2,
    );
    let rawEmailFileId: string | undefined;
    try {
      const uploaded = await this.driveClient.uploadFile({
        name: "raw_email.json",
        mimeType: "application/json",
        parentId: driveFolderId,
        buffer: Buffer.from(rawEmailJson, "utf-8"),
      });
      rawEmailFileId = uploaded.id;
    } catch (e) {
      this.logger.warn("Failed to upload raw_email.json", (e as Error).message);
    }

    this.logger.log(`Archived opportunity to ${folderPath} (${driveFolderId})`);
    return {
      driveFolderId,
      driveFolderUrl,
      folderPath,
      attachmentResults,
      rawEmailFileId,
    };
  }
}
