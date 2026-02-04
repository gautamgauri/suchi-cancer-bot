import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { GmailIngestService } from "../gmail/gmail-ingest.service";
import { GmailClientService } from "../gmail/gmail-client.service";
import { OpportunityArchiveService } from "./opportunity-archive.service";
import { OpportunityExtractService } from "./extract/opportunity-extract.service";
import { OpportunityService } from "./opportunity.service";
import { OpportunityPipelineService } from "./opportunity-pipeline.service";

export interface IntakeFromEmailResult {
  success: boolean;
  messageId: string;
  opportunityId?: string;
  pipelineEntryId?: string;
  error?: string;
}

@Injectable()
export class OpportunityIntakeService {
  private readonly logger = new Logger(OpportunityIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailIngest: GmailIngestService,
    private readonly gmailClient: GmailClientService,
    private readonly archive: OpportunityArchiveService,
    private readonly extract: OpportunityExtractService,
    private readonly opportunityService: OpportunityService,
    private readonly pipelineService: OpportunityPipelineService,
  ) {}

  /**
   * Ingest one email by messageId: fetch, archive to Drive, extract Opportunity, create tracker row.
   *
   * Idempotency is handled via transaction:
   * 1. Check if already processed (ProcessedEmail exists)
   * 2. Claim the message by creating ProcessedEmail record immediately
   * 3. Do all work (archive, extract, create opportunity, create tracker)
   * 4. Update ProcessedEmail with opportunityId on success
   *
   * If any step fails after claiming, the ProcessedEmail record remains (preventing retry storms),
   * and the error is logged for manual investigation.
   */
  async intakeFromEmail(messageId: string): Promise<IntakeFromEmailResult> {
    const result: IntakeFromEmailResult = { success: false, messageId };

    try {
      // Step 1: Check idempotency and configuration outside transaction
      const alreadyProcessed = await this.gmailIngest.isProcessed(messageId);
      if (alreadyProcessed) {
        result.error = "already_processed";
        return result;
      }

      if (!this.gmailClient.isConfigured()) {
        result.error = "gmail_not_configured";
        return result;
      }

      if (!this.archive.isConfigured()) {
        result.error = "drive_archive_not_configured";
        return result;
      }

      // Step 2: Fetch email and attachments (outside transaction - can be retried)
      const msg = await this.gmailClient.getMessage(messageId);
      const parsed = this.gmailClient.parseMessage(msg);

      const attachmentBuffers: Array<{ filename: string; mimeType: string; buffer: Buffer }> = [];
      for (const att of parsed.attachmentIds) {
        try {
          const buffer = await this.gmailIngest.getAttachmentContent(messageId, att.attachmentId);
          attachmentBuffers.push({
            filename: att.filename ?? "attachment",
            mimeType: att.mimeType ?? "application/octet-stream",
            buffer,
          });
        } catch (e) {
          this.logger.warn(`Failed to fetch attachment ${att.attachmentId}`, (e as Error).message);
        }
      }

      // Step 3: Archive to Drive (outside transaction - idempotent by folder name)
      const archiveResult = await this.archive.archive(parsed, attachmentBuffers);

      // Step 4: Extract opportunity document
      const attachmentBuffersForExtract = archiveResult.attachmentResults.map((ar, i) => ({
        filename: ar.fileName,
        mimeType: attachmentBuffers[i]?.mimeType ?? "application/octet-stream",
        buffer: attachmentBuffers[i]?.buffer ?? Buffer.from([]),
        driveFileId: ar.driveFileId,
        driveUrl: ar.driveUrl,
        checksum: ar.checksum,
        sizeBytes: ar.sizeBytes,
      }));
      const extractInput = {
        parsed,
        archive: archiveResult,
        attachmentBuffers: attachmentBuffersForExtract,
      };

      const doc = await this.extract.buildOpportunityDocument(extractInput);
      const opportunityId = doc.opportunity.opportunityId;

      // Step 5: Database operations in transaction
      // This ensures atomicity: either all DB records are created or none
      const { created, entry } = await this.prisma.$transaction(async (tx) => {
        // Claim the message first (prevents concurrent processing)
        await tx.processedEmail.upsert({
          where: { messageId: parsed.messageId },
          create: {
            messageId: parsed.messageId,
            threadId: parsed.threadId,
          },
          update: {}, // If exists, do nothing (already claimed)
        });

        // Check if opportunity already exists (idempotent)
        const existingOpp = await tx.opportunity.findUnique({
          where: { emailMessageId: parsed.messageId },
        });
        if (existingOpp) {
          // Already processed in a previous attempt
          const existingEntry = existingOpp.pipelineEntryId
            ? await tx.pipelineEntry.findUnique({ where: { id: existingOpp.pipelineEntryId } })
            : null;
          return {
            created: existingOpp,
            entry: existingEntry ?? { id: "existing" },
          };
        }

        // Create opportunity
        const createdOpp = await tx.opportunity.create({
          data: {
            opportunityId,
            schemaVersion: "1.0",
            emailMessageId: parsed.messageId,
            threadId: parsed.threadId,
            driveFolderId: archiveResult.driveFolderId,
            driveFolderUrl: archiveResult.driveFolderUrl,
            jsonBlob: doc as unknown as object,
            status: "extracted",
          },
        });

        // Create pipeline entry
        const newEntry = await this.pipelineService.createTrackerRowFromOpportunityTx(
          tx,
          {
            id: createdOpp.id,
            opportunityId: createdOpp.opportunityId,
            jsonBlob: doc,
          } as Parameters<typeof this.pipelineService.createTrackerRowFromOpportunityTx>[1],
        );

        // Link opportunity to pipeline entry
        await tx.opportunity.update({
          where: { id: createdOpp.id },
          data: { pipelineEntryId: newEntry.id },
        });

        // Update ProcessedEmail with opportunityId
        await tx.processedEmail.update({
          where: { messageId: parsed.messageId },
          data: { opportunityId },
        });

        return { created: createdOpp, entry: newEntry };
      });

      result.success = true;
      result.opportunityId = created.opportunityId;
      result.pipelineEntryId = entry.id;
      this.logger.log(`Intake completed: ${opportunityId} -> tracker ${entry.id}`);
    } catch (e) {
      result.error = (e as Error).message;
      this.logger.error(`Intake failed for ${messageId}`, (e as Error).stack);
    }

    return result;
  }
}
