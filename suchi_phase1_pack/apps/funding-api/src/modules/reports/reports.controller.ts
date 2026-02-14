import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { ReportsService } from "./reports.service";
import { ReconciliationService } from "./reconciliation.service";

@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  @Get("digest")
  async getDigest() {
    return this.reportsService.getDigest();
  }

  @Get("reconciliation-metrics")
  async getReconciliationMetrics() {
    return this.reconciliationService.getMetrics();
  }

  @Get("csr-pack")
  async getCsrPack(@Query("org") org: string) {
    return this.reportsService.getCsrPack(org?.trim() ?? "");
  }

  @Get("csr-due-next-30-days")
  async getCsrDueNext30Days() {
    return this.reportsService.getCsrDueNext30Days();
  }

  @Get("next-best-actions")
  async getNextBestActions(@Query("orgOrId") orgOrId: string) {
    if (!orgOrId?.trim()) {
      throw new BadRequestException("orgOrId query parameter is required");
    }
    return this.reportsService.getNextBestActionsForOrgOrId(orgOrId.trim());
  }

  @Get("stalled-prospects")
  async getStalledProspects(@Query("days") days?: string) {
    const thresholdDays = days ? Number(days) : undefined;
    return this.reportsService.getStalledProspects(thresholdDays);
  }

  @Get("meeting-prep")
  async getMeetingPrepByOrgOrId(@Query("orgOrId") orgOrId: string) {
    if (!orgOrId?.trim()) {
      throw new BadRequestException("orgOrId query parameter is required");
    }
    return this.reportsService.getMeetingPrepBriefForOrgOrId(orgOrId.trim());
  }

  @Get("meeting-prep-brief/:entryId")
  async getMeetingPrepBrief(@Param("entryId") entryId: string) {
    return this.reportsService.getMeetingPrepBrief(entryId);
  }
}
