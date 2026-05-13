import { Controller, Get, Post, Patch, Query, Param, Body, Res, UseGuards, Logger } from "@nestjs/common";
import { Response } from "express";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { SchedulerOidcGuard } from "../../common/guards/scheduler-oidc.guard";
import { AdminService } from "./admin.service";
import { DailyReportService } from "../analytics/daily-report.service";
import { EmailService } from "../email/email.service";
import { generateMarkdownReport } from "../analytics/report-generator";
import { NavigatorApproveService, HospitalUpdates } from "./navigator-approve.service";
import { buildReviewHtml } from "./navigator-review.html";

@Controller("admin")
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly admin: AdminService,
    private readonly dailyReport: DailyReportService,
    private readonly email: EmailService,
    private readonly navigatorApprove: NavigatorApproveService,
  ) {}

  @UseGuards(BasicAuthGuard)
  @Get("conversations")
  async conversations(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("filter") filter?: string,
  ) {
    return this.admin.listConversations({ from, to, filter });
  }

  @UseGuards(BasicAuthGuard)
  @Get("metrics")
  async metrics(@Query("from") from?: string, @Query("to") to?: string) {
    return this.admin.metrics({ from, to });
  }

  @UseGuards(BasicAuthGuard)
  @Get("kb-stats")
  async kbStats() {
    return this.admin.kbStats();
  }

  /**
   * Generate and optionally email the daily beta report
   *
   * Usage:
   *   GET /admin/daily-report                    - Yesterday's report (returns JSON, requires Basic Auth)
   *   GET /admin/daily-report?date=2026-01-30   - Specific date (requires Basic Auth)
   *   POST /admin/daily-report                   - Generate and email (requires OIDC from Cloud Scheduler)
   */
  @UseGuards(BasicAuthGuard)
  @Get("daily-report")
  async getDailyReport(@Query("date") date?: string) {
    const { from, to } = this.parseDateRange(date);
    const metrics = await this.dailyReport.generateMetrics(from, to);
    return {
      success: true,
      report: metrics,
      markdown: generateMarkdownReport(metrics),
    };
  }

  /**
   * Cloud Scheduler endpoint - secured with OIDC token verification
   * Only accepts requests from the configured scheduler service account
   */
  @UseGuards(SchedulerOidcGuard)
  @Post("daily-report")
  async generateAndEmailReport(
    @Query("date") date?: string,
    @Query("email") emailTo?: string,
  ) {
    const { from, to, dateStr } = this.parseDateRange(date);

    this.logger.log(`Generating daily report for ${dateStr}`);
    const metrics = await this.dailyReport.generateMetrics(from, to);
    const markdown = generateMarkdownReport(metrics);

    // Determine email recipient
    const recipient = emailTo || process.env.DAILY_REPORT_EMAIL || 'gautamgauri@dikshafoundation.org';

    // Generate email subject based on metrics
    const sat = metrics.feedback.satisfactionRate.toFixed(0);
    const queries = metrics.totalQueries;
    const flagged = metrics.flaggedConversations.length;
    let emoji = '✅';
    if (flagged > 5 || metrics.safetyEvents.total > 5) emoji = '⚠️';
    if (metrics.feedback.thumbsDown > metrics.feedback.thumbsUp) emoji = '🔴';

    const subject = `${emoji} Suchi Beta Report ${dateStr}: ${queries} queries, ${sat}% satisfaction`;

    // Convert markdown to simple HTML for email
    const html = `<pre style="font-family: monospace; white-space: pre-wrap;">${markdown}</pre>`;

    // Send email
    const emailSent = await this.email.sendEmail({
      to: recipient,
      subject,
      text: markdown,
      html,
    });

    this.logger.log(`Daily report generated. Email sent: ${emailSent} to ${recipient}`);

    return {
      success: true,
      dateStr,
      emailSent,
      emailTo: recipient,
      summary: {
        totalQueries: metrics.totalQueries,
        satisfactionRate: metrics.feedback.satisfactionRate,
        safetyEvents: metrics.safetyEvents.total,
        flaggedConversations: metrics.flaggedConversations.length,
      },
    };
  }

  /**
   * Navigator batch review portal.
   *
   * Linked from the review email. Shows all hospitals with inline edit forms.
   * The reviewer edits individual fields, then clicks Approve All.
   *
   * URL: GET /admin/navigator/review/:batchId?token=<hmac>
   */
  @Get("navigator/review/:batchId")
  async reviewNavigatorBatch(
    @Param("batchId") batchId: string,
    @Query("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const batch = await this.navigatorApprove.getBatchForReview(batchId, token);
      res.status(200).send(buildReviewHtml(batch, token));
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 500).send(this.buildErrorHtml(batchId, error.message ?? "Unexpected error"));
    }
  }

  /**
   * Save inline edits to a single hospital in a batch.
   *
   * Called by the review page JS when the reviewer clicks "Save Changes".
   *
   * URL: PATCH /admin/navigator/batch/:batchId/hospital/:hospitalId?token=<hmac>
   */
  @Patch("navigator/batch/:batchId/hospital/:hospitalId")
  async saveHospitalEdit(
    @Param("batchId") batchId: string,
    @Param("hospitalId") hospitalId: string,
    @Query("token") token: string,
    @Body() body: HospitalUpdates,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.navigatorApprove.updateBatchHospital(batchId, token, hospitalId, body);
      res.status(200).json({ ok: true });
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      res.status(error.status ?? 500).json({ ok: false, error: error.message ?? "Unexpected error" });
    }
  }

  /**
   * Navigator batch approval endpoint.
   *
   * Triggered by the "Approve All" button on the review portal (or directly via link).
   * Uses a GET request because the review page navigates to it via window.location.href.
   *
   * URL: GET /admin/navigator/approve/:batchId?token=<hmac>
   */
  @Get("navigator/approve/:batchId")
  async approveNavigatorBatch(
    @Param("batchId") batchId: string,
    @Query("token") token: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.navigatorApprove.approveNavigatorBatch(batchId, token);

      if (result.error === "Already approved") {
        res.status(200).send(this.buildApprovalHtml(
          batchId,
          0,
          [],
          "Already approved — these hospitals are already in the directory.",
        ));
        return;
      }

      res.status(200).send(this.buildApprovalHtml(
        batchId,
        result.hospitalsAdded,
        result.hospitalNames,
      ));
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      const status = error.status ?? 500;
      const message = error.message ?? "Unexpected error";
      this.logger.error(`Navigator approval failed for batch ${batchId}: ${message}`);
      res.status(status).send(this.buildErrorHtml(batchId, message));
    }
  }

  private buildApprovalHtml(
    batchId: string,
    count: number,
    names: string[],
    note?: string,
  ): string {
    const namesLine = names.length > 0
      ? `<p style="color:#555;font-size:13px;">Added: ${names.join(", ")}</p>`
      : "";
    const noteHtml = note
      ? `<p style="color:#888;font-size:13px;">${note}</p>`
      : "";
    return `<!DOCTYPE html><html><body style="font-family:Arial;max-width:600px;margin:60px auto;text-align:center;">
<h2 style="color:#188038;">&#10003; Hospitals Approved</h2>
<p>Batch <strong>${batchId}</strong> approved. ${count} hospital(s) added to the Suchi Navigator directory.</p>
${namesLine}
${noteHtml}
<p style="color:#999;font-size:12px;">You can close this tab.</p>
</body></html>`;
  }

  private buildErrorHtml(batchId: string, message: string): string {
    return `<!DOCTYPE html><html><body style="font-family:Arial;max-width:600px;margin:60px auto;text-align:center;">
<h2 style="color:#c0392b;">&#10007; Approval Failed</h2>
<p>Could not approve batch <strong>${batchId}</strong>.</p>
<p style="color:#555;font-size:13px;">${message}</p>
<p style="color:#999;font-size:12px;">Please contact the team if this was unexpected.</p>
</body></html>`;
  }

  private parseDateRange(date?: string): { from: Date; to: Date; dateStr: string } {
    let from: Date;
    let to: Date;

    if (date) {
      from = new Date(date);
      from.setHours(0, 0, 0, 0);
      to = new Date(date);
      to.setDate(to.getDate() + 1);
      to.setHours(0, 0, 0, 0);
    } else {
      // Default to yesterday
      to = new Date();
      to.setHours(0, 0, 0, 0);
      from = new Date(to);
      from.setDate(from.getDate() - 1);
    }

    const dateStr = from.toISOString().split('T')[0];
    return { from, to, dateStr };
  }
}
