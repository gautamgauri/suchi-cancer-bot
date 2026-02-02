import { Controller, Post, HttpCode, HttpStatus, UseGuards } from "@nestjs/common";
import { PipelineService } from "../pipeline/pipeline.service";
import { SheetsClientService } from "../sheets/sheets-client.service";
import { ExportTokenGuard } from "./export-token.guard";

@Controller("admin/export")
@UseGuards(ExportTokenGuard)
export class ExportController {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly sheetsClient: SheetsClientService,
  ) {}

  /**
   * One-way export: read pipeline and activities from DB, overwrite Google Sheet.
   * Protected by FUNDING_EXPORT_TOKEN (header or query) when set.
   */
  @Post("pipeline-to-sheets")
  @HttpCode(HttpStatus.OK)
  async pipelineToSheets(): Promise<{ ok: true; entries: number; activities: number }> {
    const entries = await this.pipelineService.getEntries();
    const activities = await this.pipelineService.getAllActivities();
    await this.sheetsClient.exportPipelineToSheet(entries, activities);
    return { ok: true, entries: entries.length, activities: activities.length };
  }
}
