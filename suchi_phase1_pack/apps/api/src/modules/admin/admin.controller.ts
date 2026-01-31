import { Controller, Get, Post, Query, UseGuards, Logger } from "@nestjs/common";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { AdminService } from "./admin.service";
import { DailyReportService } from "../analytics/daily-report.service";
import { EmailService } from "../email/email.service";
import { generateMarkdownReport } from "../analytics/report-generator";

@UseGuards(BasicAuthGuard)
@Controller("admin")
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly admin: AdminService,
    private readonly dailyReport: DailyReportService,
    private readonly email: EmailService,
  ) {}

  @Get("conversations") async conversations(@Query("from") from?: string, @Query("to") to?: string, @Query("filter") filter?: string) {
    return this.admin.listConversations({ from, to, filter });
  }

  @Get("metrics") async metrics(@Query("from") from?: string, @Query("to") to?: string) { return this.admin.metrics({ from, to }); }

  @Get("kb-stats") async kbStats() { return this.admin.kbStats(); }

  /**
   * Generate and optionally email the daily beta report
   *
   * Usage:
   *   GET /admin/daily-report                    - Yesterday's report (returns JSON)
   *   GET /admin/daily-report?date=2026-01-30   - Specific date
   *   POST /admin/daily-report?email=true       - Generate and email the report
   */
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
