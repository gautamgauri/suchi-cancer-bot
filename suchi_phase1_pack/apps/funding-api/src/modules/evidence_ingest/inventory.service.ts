import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { getEvidenceConfig } from "../../config/evidence.config";
import { DriveClientService, DriveFileItem } from "./drive-client.service";

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly driveClient: DriveClientService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Run inventory: list Drive folder recursively, filter by config, upsert by drive_file_id.
   */
  async runInventory(sourceFolderLabel: string = "diksha_fundraising"): Promise<{ added: number; updated: number }> {
    const config = getEvidenceConfig({
      EVIDENCE_DRIVE_FOLDER_ID: this.configService.get<string>("EVIDENCE_DRIVE_FOLDER_ID"),
      EVIDENCE_CUTOFF_IST: this.configService.get<string>("EVIDENCE_CUTOFF_IST"),
      EVIDENCE_MIME_ALLOWLIST: this.configService.get<string>("EVIDENCE_MIME_ALLOWLIST"),
    });
    if (!config.folderId) {
      throw new Error("EVIDENCE_DRIVE_FOLDER_ID is required for inventory");
    }
    if (!this.driveClient.isConfigured()) {
      throw new Error("Google Drive client not configured");
    }

    const items = await this.driveClient.listFilesRecursive(config.folderId, config);
    this.logger.log(`Drive listing returned ${items.length} in-scope files`);

    let added = 0;
    let updated = 0;
    const versionKey = (f: DriveFileItem) => `${f.modifiedTime}_${f.size}`;

    for (const f of items) {
      const driveUrl = f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`;
      const existing = await this.prisma.evidenceDocument.findUnique({
        where: { driveFileId: f.id },
      });
      const payload = {
        sourceFolder: sourceFolderLabel,
        name: f.name,
        mimeType: f.mimeType,
        size: BigInt(f.size || "0"),
        createdTime: new Date(f.createdTime),
        modifiedTime: new Date(f.modifiedTime),
        parents: f.parents ? (f.parents as unknown as object) : undefined,
        driveUrl,
        owners: f.owners?.length
          ? JSON.stringify(f.owners.map((o) => o.emailAddress ?? o.displayName ?? ""))
          : undefined,
        versionKey: versionKey(f),
        needsProcessing: true,
      };
      if (existing) {
        const versionChanged = existing.versionKey !== payload.versionKey;
        if (versionChanged) {
          await this.prisma.evidenceDocument.update({
            where: { driveFileId: f.id },
            data: { ...payload, needsProcessing: true },
          });
          updated++;
        }
      } else {
        await this.prisma.evidenceDocument.create({
          data: {
            driveFileId: f.id,
            ...payload,
          },
        });
        added++;
      }
    }

    this.logger.log(`Inventory complete: ${added} added, ${updated} updated`);
    return { added, updated };
  }
}
