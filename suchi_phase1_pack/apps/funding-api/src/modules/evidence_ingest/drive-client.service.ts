import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, drive_v3 } from "googleapis";
import { JWT } from "google-auth-library";
import { EvidenceConfig } from "../../config/evidence.config";

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  createdTime: string;
  modifiedTime: string;
  parents?: string[];
  webViewLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

@Injectable()
export class DriveClientService {
  private readonly logger = new Logger(DriveClientService.name);
  private readonly auth: JWT | null = null;

  constructor(private readonly configService: ConfigService) {
    const raw = this.configService.get<string>("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON");
    if (raw) {
      try {
        const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
        if (credentials.client_email && credentials.private_key) {
          this.auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key.replace(/\\n/g, "\n"),
            scopes: [
              "https://www.googleapis.com/auth/drive.readonly",
              "https://www.googleapis.com/auth/drive.metadata.readonly",
            ],
          });
          this.logger.log("Drive client configured for evidence ingestion");
        } else {
          this.logger.warn("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
        }
      } catch (e) {
        this.logger.warn("Failed to parse FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON", (e as Error).message);
      }
    }
  }

  isConfigured(): boolean {
    return !!this.auth;
  }

  private async getDrive(): Promise<drive_v3.Drive> {
    if (!this.auth) throw new Error("Google Drive not configured");
    return google.drive({ version: "v3", auth: this.auth });
  }

  /**
   * Recursively list files under a folder, filtered by modifiedTime >= cutoff and mime in allowlist.
   */
  async listFilesRecursive(
    folderId: string,
    config: EvidenceConfig,
  ): Promise<DriveFileItem[]> {
    const drive = await this.getDrive();
    const results: DriveFileItem[] = [];
    await this.collectFolderRecursive(drive, folderId, config, results);
    return results;
  }

  private async collectFolderRecursive(
    drive: drive_v3.Drive,
    folderId: string,
    config: EvidenceConfig,
    out: DriveFileItem[],
  ): Promise<void> {
    const mimeSet = new Set(config.mimeAllowlist);
    const cutoff = config.cutoffDate;
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: 100,
        pageToken: pageToken ?? undefined,
        fields: "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, owners)",
      });
      const files = res.data.files ?? [];
      for (const f of files) {
        const mimeType = f.mimeType ?? "application/octet-stream";
        if (mimeType === "application/vnd.google-apps.folder") {
          await this.collectFolderRecursive(drive, f.id!, config, out);
        } else if (mimeSet.has(mimeType)) {
          const modifiedTime = f.modifiedTime ? new Date(f.modifiedTime) : null;
          if (cutoff && modifiedTime && modifiedTime < cutoff) continue;
          out.push(this.toDriveFileItem(f));
        }
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  private toDriveFileItem(f: drive_v3.Schema$File): DriveFileItem {
    return {
      id: f.id!,
      name: f.name ?? "",
      mimeType: f.mimeType ?? "application/octet-stream",
      size: f.size ?? "0",
      createdTime: f.createdTime ?? new Date(0).toISOString(),
      modifiedTime: f.modifiedTime ?? new Date(0).toISOString(),
      parents: f.parents ?? undefined,
      webViewLink: f.webViewLink ?? undefined,
      owners: f.owners as DriveFileItem["owners"],
    };
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
      const res = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: "arraybuffer" },
      );
      const buf = Buffer.from(res.data as ArrayBuffer);
      return { buffer: buf, exportMime };
    }
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    return { buffer: Buffer.from(res.data as ArrayBuffer) };
  }
}
