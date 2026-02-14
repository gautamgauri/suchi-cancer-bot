import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditTrailService } from "../notifications/audit-trail.service";
import { ExportTokenGuard } from "./export-token.guard";

@Controller("admin/audit")
@UseGuards(ExportTokenGuard)
export class AuditController {
  constructor(private readonly auditTrail: AuditTrailService) {}

  /**
   * Query the governance write audit trail.
   * Query params: module, status (accepted|rejected|noop|failed), from (ISO date), to (ISO date), limit (1-200), offset.
   */
  @Get()
  async getAuditTrail(
    @Query("module") module?: string,
    @Query("status") status?: "accepted" | "rejected" | "noop" | "failed",
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const limitNum = limit != null ? parseInt(limit, 10) : undefined;
    const offsetNum = offset != null ? parseInt(offset, 10) : undefined;
    return this.auditTrail.query({
      module: module?.trim() || undefined,
      status,
      from: from?.trim() || undefined,
      to: to?.trim() || undefined,
      limit: Number.isFinite(limitNum) ? limitNum! : undefined,
      offset: Number.isFinite(offsetNum) ? offsetNum! : undefined,
    });
  }
}
