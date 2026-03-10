import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, gmail_v1 } from "googleapis";
import { JWT } from "google-auth-library";

export interface SccfGmailAttachmentItem {
  externalId: string; // "{messageId}::{attachmentId}"
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  emailSubject: string;
  emailFrom: string;
  emailDate: Date | null;
}

const DEFAULT_SEARCH_QUERY =
  'has:attachment (sccf OR "suchitra cancer" OR "Suchitra Foundation" OR "cancer care" OR "cancer screening" OR "cancer navigation" OR "cancer bot" OR "suchi bot" OR "SCCF board" OR "SCCF strategy" OR "community health worker" cancer)';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

function sanitizeFilename(filename: string): string {
  let safe = filename.replace(/[/\\:\x00]/g, "_");
  safe = safe.replace(/^\.+/, "");
  safe = safe.slice(0, 255);
  if (!safe || safe === "." || safe === "..") safe = "attachment";
  return safe;
}

async function withRetry<T>(fn: () => Promise<T>, logger: Logger, context: string): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      const statusCode = (e as { code?: number }).code;
      const isRetryable =
        RETRYABLE_STATUS_CODES.includes(statusCode ?? 0) ||
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("ETIMEDOUT") ||
        lastError.message.includes("socket hang up");
      if (!isRetryable || attempt >= DEFAULT_MAX_RETRIES) throw lastError;
      const delayMs = DEFAULT_INITIAL_DELAY_MS * Math.pow(2, attempt);
      logger.warn(`${context} failed (attempt ${attempt + 1}/${DEFAULT_MAX_RETRIES + 1}), retrying in ${delayMs}ms: ${lastError.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

@Injectable()
export class SccfGmailAttachmentService {
  private readonly logger = new Logger(SccfGmailAttachmentService.name);
  private readonly auth: JWT | null = null;
  private readonly user: string | undefined;
  private readonly searchQuery: string;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON");
    this.user = this.configService.get<string>("FUNDING_GMAIL_USER");
    this.searchQuery =
      this.configService.get<string>("SCCF_GMAIL_SEARCH_QUERY") ?? DEFAULT_SEARCH_QUERY;

    if (raw && this.user) {
      try {
        const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
        if (credentials.client_email && credentials.private_key) {
          this.auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key.replace(/\\n/g, "\n"),
            scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
            subject: this.user,
          });
          this.logger.log(`SCCF Gmail client configured for ${this.user} (using Diksha SA)`);
        } else {
          this.logger.warn("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
        }
      } catch (e) {
        this.logger.warn("Failed to parse FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON", (e as Error).message);
      }
    } else {
      this.logger.warn("SCCF Gmail not configured: set FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON and FUNDING_GMAIL_USER");
    }
  }

  isConfigured(): boolean {
    return !!(this.auth && this.user);
  }

  private async getGmail(): Promise<gmail_v1.Gmail> {
    if (!this.auth) throw new Error("SCCF Gmail client not configured");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return google.gmail({ version: "v1", auth: this.auth as any });
  }

  /**
   * Download a specific Gmail attachment by messageId and attachmentId.
   * Returns the raw bytes as a Buffer.
   */
  async downloadAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const gmail = await this.getGmail();
    const res = await withRetry(
      () =>
        gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        }),
      this.logger,
      `getAttachment(${messageId}::${attachmentId})`,
    );
    const data = res.data.data;
    if (!data) throw new Error(`No data in attachment ${messageId}::${attachmentId}`);
    // Gmail returns base64url-encoded data
    return Buffer.from(data, "base64url");
  }

  /**
   * Search Gmail for messages with attachments matching the configured query.
   * Returns attachment metadata only — does NOT download attachment bytes.
   */
  async searchAttachments(queryOverride?: string): Promise<SccfGmailAttachmentItem[]> {
    const query = queryOverride ?? this.searchQuery;
    this.logger.log(`Searching SCCF Gmail attachments with query: ${query}`);

    const gmail = await this.getGmail();
    const results: SccfGmailAttachmentItem[] = [];
    let pageToken: string | undefined;

    do {
      const listRes = await withRetry(
        () =>
          gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults: 100,
            pageToken: pageToken ?? undefined,
          }),
        this.logger,
        "listMessages",
      );

      const messageRefs = listRes.data.messages ?? [];
      this.logger.log(`Found ${messageRefs.length} messages in this page`);

      for (const ref of messageRefs) {
        if (!ref.id) continue;
        const msg = await withRetry(
          () =>
            gmail.users.messages.get({
              userId: "me",
              id: ref.id!,
              format: "full",
            }),
          this.logger,
          `getMessage(${ref.id})`,
        );

        const headers = (msg.data.payload?.headers ?? []).reduce(
          (acc, h) => {
            if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
            return acc;
          },
          {} as Record<string, string>,
        );

        const subject = headers["subject"] ?? "";
        const from = headers["from"] ?? "";
        const dateStr = headers["date"] ?? "";
        const emailDate = dateStr ? new Date(dateStr) : null;

        // Recursively collect attachment parts (handles nested multipart MIME)
        const attachmentParts: gmail_v1.Schema$MessagePart[] = [];
        const collectParts = (parts: gmail_v1.Schema$MessagePart[] | undefined) => {
          if (!parts) return;
          for (const part of parts) {
            if (part.body?.attachmentId) {
              attachmentParts.push(part);
            }
            if (part.parts) collectParts(part.parts);
          }
        };
        collectParts(msg.data.payload?.parts);

        for (const part of attachmentParts) {
          const attachmentId = part.body!.attachmentId!;
          results.push({
            externalId: `${ref.id}::${attachmentId}`,
            messageId: ref.id,
            attachmentId,
            filename: sanitizeFilename(part.filename ?? "attachment"),
            mimeType: part.mimeType ?? "application/octet-stream",
            sizeBytes: part.body?.size ?? 0,
            emailSubject: subject,
            emailFrom: from,
            emailDate: emailDate && !isNaN(emailDate.getTime()) ? emailDate : null,
          });
        }
      }

      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken);

    this.logger.log(`SCCF Gmail scan complete: ${results.length} attachments found`);
    return results;
  }
}
