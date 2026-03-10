import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, gmail_v1 } from "googleapis";
import { JWT } from "google-auth-library";
import type { GmailMessagePayload, ParsedEmail } from "./gmail.types";

// Path traversal prevention pattern
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9._\-() ]+$/;
const MAX_FILENAME_LENGTH = 255;

// HTML sanitization - remove script tags and event handlers
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=/gi, " data-removed=")
    .replace(/<iframe\b[^>]*>/gi, "<!-- iframe removed -->")
    .replace(/<object\b[^>]*>/gi, "<!-- object removed -->")
    .replace(/<embed\b[^>]*>/gi, "<!-- embed removed -->");
}

// Validate and sanitize filename to prevent path traversal
function sanitizeFilename(filename: string): string {
  // Remove path separators and null bytes
  let safe = filename.replace(/[/\\:\x00]/g, "_");
  // Remove leading dots (hidden files, parent dir)
  safe = safe.replace(/^\.+/, "");
  // Truncate to max length
  safe = safe.slice(0, MAX_FILENAME_LENGTH);
  // If empty or still suspicious, use default
  if (!safe || safe === "." || safe === "..") {
    safe = "attachment";
  }
  return safe;
}

// Retry configuration
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;

// Transient error codes that should be retried
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Execute a function with exponential backoff retry for transient failures.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  logger: Logger,
  options: { maxRetries?: number; initialDelayMs?: number; context?: string } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const context = options.context ?? "Gmail API";

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      const statusCode = (e as { code?: number }).code;

      // Check if error is retryable
      const isRetryable =
        RETRYABLE_STATUS_CODES.includes(statusCode ?? 0) ||
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("ETIMEDOUT") ||
        lastError.message.includes("socket hang up");

      if (!isRetryable || attempt >= maxRetries) {
        throw lastError;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt);
      logger.warn(`${context} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms: ${lastError.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

@Injectable()
export class GmailClientService {
  private readonly logger = new Logger(GmailClientService.name);
  private readonly auth: JWT | null = null;
  private readonly user: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON");
    this.user = this.configService.get<string>("FUNDING_GMAIL_USER");

    if (raw && this.user) {
      try {
        const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
        if (credentials.client_email && credentials.private_key) {
          this.auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key.replace(/\\n/g, "\n"),
            scopes: [
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/gmail.send",
            ],
            subject: this.user,
          });
          this.logger.log(`Gmail client configured for ${this.user}`);
        } else {
          this.logger.warn("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
        }
      } catch (e) {
        this.logger.warn("Failed to parse FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON", (e as Error).message);
      }
    } else {
      this.logger.warn("Gmail not configured: set FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON and FUNDING_GMAIL_USER");
    }
  }

  isConfigured(): boolean {
    return !!(this.auth && this.user);
  }

  private async getGmail(): Promise<gmail_v1.Gmail> {
    if (!this.auth) throw new Error("Gmail not configured");
    const gmail = google.gmail({ version: "v1", auth: this.auth });
    return gmail;
  }

  /**
   * List message IDs in the inbox (or a given label). Uses maxResults for polling.
   * Includes retry logic for transient failures.
   */
  async listMessages(options: {
    labelIds?: string[];
    maxResults?: number;
    pageToken?: string;
    q?: string;
  }): Promise<{ messages: Array<{ id: string; threadId: string }>; nextPageToken?: string }> {
    return withRetry(
      async () => {
        const gmail = await this.getGmail();
        const res = await gmail.users.messages.list({
          userId: "me",
          labelIds: options.labelIds ?? ["INBOX"],
          maxResults: options.maxResults ?? 50,
          pageToken: options.pageToken,
          q: options.q,
        });

        const messages = (res.data.messages ?? []).map((m) => ({
          id: m.id!,
          threadId: m.threadId!,
        }));
        return {
          messages,
          nextPageToken: res.data.nextPageToken ?? undefined,
        };
      },
      this.logger,
      { context: "listMessages" },
    );
  }

  /**
   * Get a single message by ID with full payload and attachment metadata.
   * Includes retry logic for transient failures.
   */
  async getMessage(messageId: string): Promise<GmailMessagePayload> {
    return withRetry(
      async () => {
        const gmail = await this.getGmail();
        const res = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        const payload = res.data.payload;
        const partList = payload?.parts ?? (payload ? [payload] : []);

        const headers = (payload?.headers ?? []).reduce(
          (acc, h) => {
            if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
            return acc;
          },
          {} as Record<string, string>,
        );

        const attachmentIds: ParsedEmail["attachmentIds"] = [];
        for (const part of partList) {
          if (part.body?.attachmentId && (part.filename || part.mimeType)) {
            attachmentIds.push({
              attachmentId: part.body.attachmentId,
              filename: part.filename ?? undefined,
              mimeType: part.mimeType ?? undefined,
              size: part.body.size ?? undefined,
            });
          }
        }

        return {
          id: res.data.id!,
          threadId: res.data.threadId!,
          labelIds: res.data.labelIds ?? undefined,
          snippet: res.data.snippet ?? undefined,
          payload: {
            partId: payload?.partId,
            mimeType: payload?.mimeType,
            filename: payload?.filename,
            headers: (payload?.headers ?? []) as Array<{ name?: string; value?: string }>,
            body: payload?.body,
            parts: partList as GmailMessagePayload["payload"]["parts"],
          },
        };
      },
      this.logger,
      { context: `getMessage(${messageId})` },
    );
  }

  /**
   * Get attachment body (base64url decoded to buffer).
   * Includes retry logic for transient failures.
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    return withRetry(
      async () => {
        const gmail = await this.getGmail();
        const res = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        });
        const data = res.data.data;
        if (!data) {
          throw new Error(`No data for attachment ${attachmentId}`);
        }
        return Buffer.from(data, "base64url");
      },
      this.logger,
      { context: `getAttachment(${messageId}, ${attachmentId})` },
    );
  }

  /**
   * Send an email via the Gmail API (requires gmail.send scope in DWD).
   * Sends as the configured FUNDING_GMAIL_USER.
   */
  async sendEmail(options: {
    to: string[];
    subject: string;
    body: string;
    isHtml?: boolean;
  }): Promise<{ messageId: string }> {
    return withRetry(
      async () => {
        const gmail = await this.getGmail();

        const toHeader = options.to.join(", ");
        const mimeType = options.isHtml ? "text/html" : "text/plain";
        const rawMessage = [
          `From: Bodh AI Funding Bot <${this.user}>`,
          `To: ${toHeader}`,
          `Subject: ${options.subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: ${mimeType}; charset=UTF-8`,
          "",
          options.body,
        ].join("\r\n");

        const encoded = Buffer.from(rawMessage)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encoded },
        });

        this.logger.log(`Gmail API email sent: ${res.data.id} to ${toHeader}`);
        return { messageId: res.data.id! };
      },
      this.logger,
      { context: "sendEmail" },
    );
  }

  /**
   * Parse Gmail message payload into a simple ParsedEmail (headers + body + attachment refs).
   */
  parseMessage(msg: GmailMessagePayload): ParsedEmail {
    const payload = msg.payload;
    const headers = (payload?.headers ?? []).reduce(
      (acc, h) => {
        if (h.name && h.value) acc[h.name.toLowerCase()] = h.value;
        return acc;
      },
      {} as Record<string, string>,
    );

    const getHeader = (name: string) => headers[name] ?? "";

    let bodyPlain: string | undefined;
    let bodyHtml: string | undefined;
    const parts = payload?.parts ?? (payload ? [payload] : []);
    for (const part of parts) {
      const mime = (part.mimeType ?? "").toLowerCase();
      const data = part.body?.data;
      if (!data) continue;
      const decoded = Buffer.from(data, "base64url").toString("utf-8");
      if (mime === "text/plain") bodyPlain = decoded;
      else if (mime === "text/html") bodyHtml = sanitizeHtml(decoded);
      else if (!bodyPlain && (mime.startsWith("text/") || !mime)) bodyPlain = decoded;
    }

    const attachmentIds = (payload?.parts ?? [])
      .filter((p) => p.body?.attachmentId)
      .map((p) => ({
        attachmentId: p.body!.attachmentId!,
        // Sanitize filename to prevent path traversal
        filename: p.filename ? sanitizeFilename(p.filename) : undefined,
        mimeType: p.mimeType ?? undefined,
        size: p.body?.size ?? undefined,
      }));

    const from = parseAddress(getHeader("from"));

    return {
      messageId: msg.id,
      threadId: msg.threadId,
      subject: getHeader("subject"),
      from,
      to: parseAddressList(getHeader("to")),
      cc: parseAddressList(getHeader("cc")),
      date: getHeader("date"),
      bodyPlain,
      bodyHtml,
      snippet: msg.snippet,
      attachmentIds,
    };
  }
}

function parseAddress(raw: string): { name?: string; email: string } {
  const match = raw.match(/^(?:(.+?)\s*)?<([^>]+)>$|^([^\s@]+@[^\s@]+)$/);
  if (match) {
    if (match[2]) {
      return { name: match[1]?.trim(), email: match[2].trim().toLowerCase() };
    }
    return { email: (match[3] ?? raw).trim().toLowerCase() };
  }
  return { email: raw.trim().toLowerCase() };
}

function parseAddressList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((a) => parseAddress(a.trim()).email);
}
