import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DriveClientService } from "../../evidence_ingest/drive-client.service";
import { ProposalRunArtifacts } from "../proposal.types";

@Injectable()
export class ArtifactExporterService {
  private readonly logger = new Logger(ArtifactExporterService.name);

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
   * Export proposal artifacts to Drive: draft doc, evidence pack, run log, compliance report.
   * Folder structure: {opportunityFolder}/Proposals/run_{timestamp}_v{version}/
   */
  async exportArtifacts(params: {
    opportunityFolderId: string;
    runId: string;
    draftText: string;
    evidencePack: Array<{ chunkId: string; docId: string; text: string; title?: string }>;
    runLog: Record<string, unknown>;
    complianceReport: Record<string, unknown>;
    funderName: string;
    programName?: string;
  }): Promise<ProposalRunArtifacts> {
    const rootId = this.getArchiveRootId();
    if (!rootId) {
      throw new Error("FUNDING_DRIVE_ARCHIVE_ROOT_ID not set");
    }
    if (!this.driveClient.isConfigured()) {
      throw new Error("Drive client not configured");
    }

    // Create Proposals subfolder if it doesn't exist
    const proposalsFolder = await this.driveClient.ensureFolderPath(params.opportunityFolderId, ["Proposals"]);
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const runFolderName = `run_${timestamp}_v1`;
    const runFolder = await this.driveClient.ensureFolderPath(proposalsFolder.id, [runFolderName]);

    const artifacts: ProposalRunArtifacts = {
      driveFolderId: runFolder.id,
      driveFolderUrl: runFolder.webViewLink,
    };

    // Upload draft as Google Doc
    const draftName = `Draft_${params.funderName.replace(/\s+/g, "_")}_${params.programName?.replace(/\s+/g, "_") || "Proposal"}.gdoc`;
    try {
      // Create Google Doc by uploading HTML content
      const htmlContent = `<html><body><pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${params.draftText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
      const draftFile = await this.driveClient.uploadFile({
        name: draftName,
        mimeType: "text/html",
        parentId: runFolder.id,
        buffer: Buffer.from(htmlContent, "utf-8"),
      });
      artifacts.docId = draftFile.id;
      artifacts.docUrl = draftFile.webViewLink;
    } catch (e) {
      this.logger.warn("Failed to create draft doc, uploading as text", (e as Error).message);
      const draftFile = await this.driveClient.uploadFile({
        name: draftName.replace(".gdoc", ".txt"),
        mimeType: "text/plain",
        parentId: runFolder.id,
        buffer: Buffer.from(params.draftText, "utf-8"),
      });
      artifacts.docId = draftFile.id;
      artifacts.docUrl = draftFile.webViewLink;
    }

    // Create Evidence Pack folder
    const evidencePackFolder = await this.driveClient.ensureFolderPath(runFolder.id, ["Evidence_Pack"]);
    artifacts.evidencePackId = evidencePackFolder.id;

    // Upload chunks.json
    const chunksJson = JSON.stringify(params.evidencePack, null, 2);
    await this.driveClient.uploadFile({
      name: "chunks.json",
      mimeType: "application/json",
      parentId: evidencePackFolder.id,
      buffer: Buffer.from(chunksJson, "utf-8"),
    });

    // Upload run_log.json
    const runLogJson = JSON.stringify(params.runLog, null, 2);
    const runLogFile = await this.driveClient.uploadFile({
      name: "run_log.json",
      mimeType: "application/json",
      parentId: runFolder.id,
      buffer: Buffer.from(runLogJson, "utf-8"),
    });
    artifacts.runLogFileId = runLogFile.id;

    // Upload compliance_report.json
    const complianceJson = JSON.stringify(params.complianceReport, null, 2);
    const complianceFile = await this.driveClient.uploadFile({
      name: "compliance_report.json",
      mimeType: "application/json",
      parentId: runFolder.id,
      buffer: Buffer.from(complianceJson, "utf-8"),
    });
    artifacts.complianceReportFileId = complianceFile.id;

    this.logger.log(`Exported proposal artifacts to ${runFolder.id}`);
    return artifacts;
  }
}
