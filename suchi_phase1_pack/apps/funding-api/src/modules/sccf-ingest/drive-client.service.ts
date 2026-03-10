import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, drive_v3 } from "googleapis";
import { JWT } from "google-auth-library";

export interface SccfDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedTime: string;
  webViewLink?: string;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

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
export class SccfDriveClientService {
  private readonly logger = new Logger(SccfDriveClientService.name);
  private readonly auth: JWT | null = null;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON");
    const user = this.configService.get<string>("FUNDING_GMAIL_USER");
    if (raw && user) {
      try {
        const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
        if (credentials.client_email && credentials.private_key) {
          this.auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key.replace(/\\n/g, "\n"),
            scopes: ["https://www.googleapis.com/auth/drive.readonly"],
            subject: user, // impersonate the Diksha user who owns the SCCF folder
          });
          this.logger.log(`SCCF Drive client configured (impersonating ${user})`);
        } else {
          this.logger.warn("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
        }
      } catch (e) {
        this.logger.warn("Failed to parse FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON", (e as Error).message);
      }
    } else {
      this.logger.warn("SCCF Drive not configured: set FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON and FUNDING_GMAIL_USER");
    }
  }

  isConfigured(): boolean {
    return !!this.auth;
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (!this.auth) throw new Error("SCCF Drive client not configured");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return google.drive({ version: "v3", auth: this.auth as any });
  }

  /** Recursively list all non-folder files under a Drive folder. */
  async listFilesRecursive(folderId: string): Promise<SccfDriveFileItem[]> {
    const drive = await this.getDrive();
    const results: SccfDriveFileItem[] = [];
    await this.collectFolderRecursive(drive, folderId, results);
    return results;
  }

  /**
   * Download file content. For Google Docs exports to HTML; for binary (PDF, etc.) returns raw bytes.
   */
  async getFileContent(fileId: string, mimeType: string): Promise<{ buffer: Buffer; exportMime?: string }> {
    const drive = await this.getDrive();
    const isGoogleDoc = mimeType.startsWith("application/vnd.google-apps.");
    if (isGoogleDoc) {
      const exportMime = mimeType === "application/vnd.google-apps.document"
        ? "text/html"
        : "text/plain";
      const res = await withRetry(
        () => drive.files.export(
          { fileId, mimeType: exportMime },
          { responseType: "arraybuffer" },
        ),
        this.logger,
        `exportFile(${fileId})`,
      );
      const buf = Buffer.from(res.data as ArrayBuffer);
      return { buffer: buf, exportMime };
    }
    const res = await withRetry(
      () => drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" },
      ),
      this.logger,
      `downloadFile(${fileId})`,
    );
    return { buffer: Buffer.from(res.data as ArrayBuffer) };
  }

  private async collectFolderRecursive(
    drive: drive_v3.Drive,
    folderId: string,
    out: SccfDriveFileItem[],
  ): Promise<void> {
    let pageToken: string | undefined;
    do {
      const res = await withRetry(
        () =>
          drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            pageSize: 100,
            pageToken: pageToken ?? undefined,
            fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink)",
          }),
        this.logger,
        `listFiles(${folderId})`,
      );
      const files = res.data.files ?? [];
      for (const f of files) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          await this.collectFolderRecursive(drive, f.id!, out);
        } else {
          out.push({
            id: f.id!,
            name: f.name ?? "",
            mimeType: f.mimeType ?? "application/octet-stream",
            sizeBytes: parseInt(f.size ?? "0", 10) || 0,
            modifiedTime: f.modifiedTime ?? new Date(0).toISOString(),
            webViewLink: f.webViewLink ?? undefined,
          });
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
}
