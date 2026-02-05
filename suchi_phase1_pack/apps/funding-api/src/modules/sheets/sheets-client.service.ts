import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, sheets_v4 } from "googleapis";
import { JWT } from "google-auth-library";
import { ActivityRecord } from "../pipeline/pipeline.types";
import type { PipelineEntry, PipelineStage } from "../pipeline/pipeline.types";

const STAGES: PipelineStage[] = ["RFP_received", "lead", "qualified", "proposal_sent", "won", "lost"];

@Injectable()
export class SheetsClientService {
  private readonly logger = new Logger(SheetsClientService.name);
  private readonly spreadsheetId: string | undefined;
  private readonly pipelineTab: string;
  private readonly activitiesTab: string;
  private readonly auth: JWT | null = null;

  constructor(private readonly configService: ConfigService) {
    this.spreadsheetId = this.configService.get<string>("FUNDING_SHEETS_SPREADSHEET_ID");
    this.pipelineTab = this.configService.get<string>("FUNDING_SHEETS_PIPELINE_TAB") ?? "Pipeline";
    this.activitiesTab = this.configService.get<string>("FUNDING_SHEETS_ACTIVITIES_TAB") ?? "Activities";

    const raw = this.configService.get<string>("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON");
    if (this.spreadsheetId && raw) {
      try {
        const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
        if (credentials.client_email && credentials.private_key) {
          this.auth = new JWT({
            email: credentials.client_email,
            key: credentials.private_key.replace(/\\n/g, "\n"),
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
          });
          this.logger.log(`Sheets client configured for spreadsheet ${this.spreadsheetId}`);
        } else {
          this.logger.warn("FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key");
        }
      } catch (e) {
        this.logger.warn("Failed to parse FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON", (e as Error).message);
      }
    }
  }

  isConfigured(): boolean {
    return !!(this.spreadsheetId && this.auth);
  }

  private async getSheets(): Promise<sheets_v4.Sheets> {
    if (!this.auth) throw new Error("Google Sheets not configured");
    const sheets = google.sheets({ version: "v4", auth: this.auth });
    return sheets;
  }

  /**
   * Append one activity row to the Activities tab.
   * Columns: id, timestamp, donorId, orgId, type, notes, createdBy
   */
  async appendActivity(record: ActivityRecord, createdBy?: string): Promise<void> {
    if (!this.isConfigured()) return;
    const sheets = await this.getSheets();
    const row = [
      record.id,
      record.timestamp,
      record.donorId ?? "",
      record.orgId ?? "",
      record.type,
      record.notes ?? "",
      createdBy ?? record.createdBy ?? "",
    ];
    const range = `${this.activitiesTab}!A:G`;
    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId!,
      range,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    this.logger.log(`Appended activity ${record.id} to Sheets`);
  }

  /**
   * Overwrite the Pipeline tab (and optionally Activities tab) with data from DB.
   * Pipeline columns: id, orgName, contactName, stage, assignedTo, nextAction, nextActionDate, lastContactDate, probability, notes, sectorTags, geography, estimatedGrantSize.
   * Activities columns: id, timestamp, donorId, orgId, type, notes, createdBy.
   */
  async exportPipelineToSheet(
    entries: PipelineEntry[],
    activities?: ActivityRecord[],
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Google Sheets not configured");
    }
    const sheets = await this.getSheets();
    const pipelineHeader = [
      "id",
      "orgName",
      "contactName",
      "stage",
      "assignedTo",
      "nextAction",
      "nextActionDate",
      "lastContactDate",
      "probability",
      "notes",
      "sectorTags",
      "geography",
      "estimatedGrantSize",
    ];
    const pipelineRows = entries.map((e) => [
      e.id ?? "",
      e.orgName,
      e.contactName ?? "",
      e.stage,
      e.assignedTo ?? "",
      e.nextAction ?? "",
      e.nextActionDate ?? "",
      e.lastContactDate ?? "",
      e.probability ?? "",
      e.notes ?? "",
      Array.isArray(e.sectorTags) ? e.sectorTags.join(", ") : (e.sectorTags ?? ""),
      e.geography ?? "",
      e.estimatedGrantSize ?? "",
    ]);
    await sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId!,
      range: `${this.pipelineTab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [pipelineHeader, ...pipelineRows] },
    });
    this.logger.log(`Exported ${entries.length} pipeline entries to Sheet`);
    if (activities !== undefined && activities.length >= 0) {
      const activitiesHeader = ["id", "timestamp", "donorId", "orgId", "type", "notes", "createdBy"];
      const activitiesRows = activities.map((a) => [
        a.id,
        a.timestamp,
        a.donorId ?? "",
        a.orgId ?? "",
        a.type,
        a.notes ?? "",
        a.createdBy ?? "",
      ]);
      await sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId!,
        range: `${this.activitiesTab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [activitiesHeader, ...activitiesRows] },
      });
      this.logger.log(`Exported ${activities.length} activities to Sheet`);
    }
  }

  /**
   * Read pipeline entries from the Pipeline tab. Expects header row then data.
   * Columns (by index): id, orgName, contactName, stage, assignedTo, nextAction, nextActionDate, lastContactDate, probability, notes, sectorTags, geography, estimatedGrantSize
   */
  async getPipelineEntries(): Promise<PipelineEntry[] | null> {
    if (!this.isConfigured()) return null;
    const sheets = await this.getSheets();
    const range = `${this.pipelineTab}!A:N`;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId!,
      range,
    });
    const rows = res.data.values as string[][] | undefined;
    if (!rows || rows.length < 2) return [];
    const headers = rows[0].map((h) => (h || "").toLowerCase());
    const entries: PipelineEntry[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const get = (name: string) => {
        const idx = headers.indexOf(name);
        return idx >= 0 && row[idx] !== undefined ? String(row[idx]).trim() : undefined;
      };
      const stageRaw = get("stage");
      const stage = stageRaw && STAGES.includes(stageRaw as PipelineStage) ? (stageRaw as PipelineStage) : "lead";
      const orgName = get("orgname") ?? get("org_name") ?? "";
      if (!orgName) continue;
      const probStr = get("probability");
      entries.push({
        id: get("id"),
        orgName,
        contactName: get("contactname") ?? get("contact_name"),
        stage,
        assignedTo: get("assignedto") ?? get("assigned_to"),
        nextAction: get("nextaction") ?? get("next_action"),
        nextActionDate: get("nextactiondate") ?? get("next_action_date"),
        lastContactDate: get("lastcontactdate") ?? get("last_contact_date"),
        probability: probStr ? Number(probStr) : undefined,
        notes: get("notes"),
        sectorTags: (() => {
          const v = get("sectortags") ?? get("sector_tags");
          return v ? v.split(",").map((s) => s.trim()) : undefined;
        })(),
        geography: get("geography"),
        estimatedGrantSize: get("estimatedgrantsize") ?? get("estimated_grant_size"),
      });
    }
    return entries;
  }
}
