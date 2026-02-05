import { createHash } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { DriveClientService } from "./drive-client.service";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly driveClient: DriveClientService,
    private readonly prisma: PrismaService,
  ) {}

  private getStorageDir(): string {
    const dir = this.configService.get<string>("EVIDENCE_STORAGE_DIR");
    if (dir) return dir;
    return path.join(os.tmpdir(), "evidence");
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Download documents that need processing. Uses exponential backoff on transient failures.
   */
  async downloadPending(): Promise<{ success: number; failed: number }> {
    if (!this.driveClient.isConfigured()) {
      throw new Error("Google Drive not configured");
    }
    const storageDir = this.getStorageDir();
    await this.ensureDir(storageDir);

    const docs = await this.prisma.evidenceDocument.findMany({
      where: { needsProcessing: true },
      orderBy: { modifiedTime: "asc" },
    });
    let success = 0;
    let failed = 0;

    for (const doc of docs) {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const { buffer } = await this.driveClient.getFileContent(doc.driveFileId, doc.mimeType);
          const ext = doc.mimeType.includes("pdf")
            ? "pdf"
            : doc.mimeType.includes("document")
              ? "html"
              : "bin";
          const filename = `${doc.driveFileId}.${ext}`;
          const filePath = path.join(storageDir, filename);
          await fs.writeFile(filePath, buffer);
          const checksum = createHash("md5").update(buffer).digest("hex");
          await this.prisma.evidenceDocument.update({
            where: { id: doc.id },
            data: {
              rawStorageUri: filePath,
              downloadStatus: "success",
              downloadError: null,
              downloadedAt: new Date(),
              checksum,
            },
          });
          success++;
          lastError = null;
          break;
        } catch (e) {
          lastError = e as Error;
          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
            this.logger.warn(`Retry ${attempt + 1}/${MAX_RETRIES} for ${doc.driveFileId} in ${delay}ms`);
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      }
      if (lastError) {
        await this.prisma.evidenceDocument.update({
          where: { id: doc.id },
          data: {
            downloadStatus: "failed",
            downloadError: lastError.message,
            downloadedAt: new Date(),
          },
        });
        failed++;
        this.logger.error(`Download failed for ${doc.driveFileId}: ${lastError.message}`);
      }
    }

    this.logger.log(`Download complete: ${success} success, ${failed} failed`);
    return { success, failed };
  }
}
