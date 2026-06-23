import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { LlmService } from "../llm/llm.service";
import { EmailService } from "../email/email.service";

const REVIEW_RECIPIENTS = ["gautam@dikshafoundation.org", "divya@dikshafoundation.org"];

@Injectable()
export class ReviewQueueService {
  private readonly logger = new Logger(ReviewQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly email: EmailService,
  ) {}

  // FR-REVIEW-002: Return flagged sessions since a given date
  async listQueue(since?: string) {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.session.findMany({
      where: { reviewFlagged: true, createdAt: { gte: sinceDate } },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        reviewFlagReason: true,
        reviewedAt: true,
        reviewedBy: true,
        reviewOutcome: true,
        userRole: true,
        locale: true,
        messages: {
          where: { role: "user" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, text: true, createdAt: true },
        },
      },
    });

    return sessions.map((s) => ({
      sessionId: s.id,
      createdAt: s.createdAt,
      flagReason: s.reviewFlagReason,
      userRole: s.userRole,
      locale: s.locale,
      firstMessage: s.messages[0]?.text?.substring(0, 200) ?? null,
      reviewed: !!s.reviewedAt,
      reviewedAt: s.reviewedAt,
      reviewedBy: s.reviewedBy,
      reviewOutcome: s.reviewOutcome,
    }));
  }

  // FR-REVIEW-003: Mark a session as reviewed
  async markReviewed(sessionId: string, outcome: string, reviewerName?: string) {
    const validOutcomes = ["reviewed", "escalated", "no-action"];
    if (!validOutcomes.includes(outcome)) {
      throw new Error(`Invalid outcome. Must be one of: ${validOutcomes.join(", ")}`);
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        reviewedAt: new Date(),
        reviewedBy: reviewerName ?? "unknown",
        reviewOutcome: outcome,
      },
    });

    return { sessionId, outcome, reviewedAt: new Date() };
  }

  // FR-REVIEW-001 weekly digest: AI summary + first message per session, emailed to team
  async sendWeeklyDigest(): Promise<{ sent: number; skipped: number }> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.session.findMany({
      where: { reviewFlagged: true, reviewedAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        reviewFlagReason: true,
        userRole: true,
        messages: {
          orderBy: { createdAt: "asc" },
          take: 6,
          select: { role: true, text: true },
        },
      },
    });

    if (sessions.length === 0) {
      this.logger.log("Weekly review digest: no unreviewed flagged sessions this week");
      return { sent: 0, skipped: 0 };
    }

    const rows: string[] = [];
    let skipped = 0;

    for (const session of sessions) {
      try {
        const firstUserMessage = session.messages.find((m) => m.role === "user")?.text ?? "";
        const conversationSnippet = session.messages
          .slice(0, 4)
          .map((m) => `${m.role.toUpperCase()}: ${m.text.substring(0, 150)}`)
          .join("\n");

        const summary = await this.llm.generate(
          "You are a clinical content reviewer. Summarize this patient conversation in ONE sentence (max 20 words). Focus on what the user asked and what Suchi did (answered, redirected, escalated). No patient identifiers.",
          "",
          conversationSnippet,
        );

        rows.push(`
<tr>
  <td style="padding:8px;border-bottom:1px solid #eee;font-size:13px;color:#888">${session.createdAt.toISOString().split("T")[0]}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;font-size:13px">${session.reviewFlagReason ?? "—"}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;font-size:13px">${(summary ?? "").substring(0, 120)}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;font-size:13px;color:#555">${firstUserMessage.substring(0, 100)}</td>
  <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;color:#888">${session.id.substring(0, 8)}</td>
</tr>`);
      } catch (err: any) {
        this.logger.warn(`Digest summary failed for ${session.id}: ${err.message}`);
        skipped++;
      }
    }

    const html = `
<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto">
<h2 style="color:#c0392b">Suchi Weekly Review Queue</h2>
<p style="color:#555">Week ending ${new Date().toISOString().split("T")[0]} — ${sessions.length} unreviewed sessions flagged for human review.</p>
<p style="color:#555;font-size:13px">To mark a session reviewed, visit the admin panel or call PATCH /v1/admin/review-queue/{sessionId}.</p>
<table style="width:100%;border-collapse:collapse">
<thead>
<tr style="background:#f8f8f8">
  <th style="padding:8px;text-align:left;font-size:13px">Date</th>
  <th style="padding:8px;text-align:left;font-size:13px">Flag Reason</th>
  <th style="padding:8px;text-align:left;font-size:13px">AI Summary</th>
  <th style="padding:8px;text-align:left;font-size:13px">First Message</th>
  <th style="padding:8px;text-align:left;font-size:13px">Session ID</th>
</tr>
</thead>
<tbody>
${rows.join("")}
</tbody>
</table>
<p style="color:#aaa;font-size:11px;margin-top:24px">Suchi Cancer Bot — automated weekly review digest. Do not reply to this email.</p>
</body></html>`;

    await this.email.sendEmail({
      to: REVIEW_RECIPIENTS.join(", "),
      subject: `Suchi Review Queue — ${sessions.length} sessions (week of ${new Date().toISOString().split("T")[0]})`,
      html,
    });

    return { sent: sessions.length - skipped, skipped };
  }
}
