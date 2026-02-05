import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { GmailClientService } from "./gmail-client.service";
import type { ParsedEmail } from "./gmail.types";

export interface IngestResult {
  processed: boolean;
  messageId: string;
  threadId: string;
  reason?: string;
  parsed?: ParsedEmail;
}

@Injectable()
export class GmailIngestService {
  private readonly logger = new Logger(GmailIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailClient: GmailClientService,
  ) {}

  /**
   * Returns true if the message was already processed (idempotency).
   */
  async isProcessed(messageId: string): Promise<boolean> {
    const row = await this.prisma.processedEmail.findUnique({
      where: { messageId },
    });
    return !!row;
  }

  /**
   * Mark a message as processed (call after successfully creating Opportunity or saving raw).
   * Uses upsert to prevent race conditions - if two concurrent requests try to mark the same
   * message, one will create and one will update (no error).
   */
  async markProcessed(params: {
    messageId: string;
    threadId: string;
    opportunityId?: string;
  }): Promise<void> {
    await this.prisma.processedEmail.upsert({
      where: { messageId: params.messageId },
      create: {
        messageId: params.messageId,
        threadId: params.threadId,
        opportunityId: params.opportunityId ?? null,
      },
      update: {
        // If already exists, update opportunityId if provided
        ...(params.opportunityId && { opportunityId: params.opportunityId }),
      },
    });
    this.logger.log(`Marked message ${params.messageId} as processed`);
  }

  /**
   * Fetch and parse one message. Idempotent: if messageId already in ProcessedEmail, returns processed: true without re-fetching.
   */
  async ingestOne(messageId: string): Promise<IngestResult> {
    const already = await this.isProcessed(messageId);
    if (already) {
      return { processed: false, messageId, threadId: "", reason: "already_processed" };
    }

    if (!this.gmailClient.isConfigured()) {
      return { processed: false, messageId, threadId: "", reason: "gmail_not_configured" };
    }

    const msg = await this.gmailClient.getMessage(messageId);
    const parsed = this.gmailClient.parseMessage(msg);
    return {
      processed: true,
      messageId: parsed.messageId,
      threadId: parsed.threadId,
      parsed,
    };
  }

  /**
   * Poll inbox for new messages and return only those not yet processed.
   */
  async listUnprocessed(options: {
    labelIds?: string[];
    maxResults?: number;
    q?: string;
  }): Promise<Array<{ id: string; threadId: string }>> {
    if (!this.gmailClient.isConfigured()) {
      return [];
    }
    const { messages, nextPageToken } = await this.gmailClient.listMessages({
      labelIds: options.labelIds ?? ["INBOX"],
      maxResults: options.maxResults ?? 20,
      q: options.q,
    });

    const unprocessed: Array<{ id: string; threadId: string }> = [];
    for (const m of messages) {
      const done = await this.isProcessed(m.id);
      if (!done) unprocessed.push(m);
    }
    return unprocessed;
  }

  /**
   * Get attachment content for a message (for Drive archival).
   */
  async getAttachmentContent(messageId: string, attachmentId: string): Promise<Buffer> {
    return this.gmailClient.getAttachment(messageId, attachmentId);
  }
}
