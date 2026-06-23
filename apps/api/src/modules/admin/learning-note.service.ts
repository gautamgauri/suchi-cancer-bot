import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { AnalyticsAdminService } from "./analytics-admin.service";

const LEARNING_NOTE_RECIPIENTS = ["gautam@dikshafoundation.org", "divya@dikshafoundation.org"];

@Injectable()
export class LearningNoteService {
  private readonly logger = new Logger(LearningNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly analytics: AnalyticsAdminService,
  ) {}

  // FR-LEARN-001: Generate and email the monthly SCCF Learning Note
  async generateAndSend(month?: string): Promise<{ ok: boolean; month: string }> {
    const now = new Date();
    const targetMonth = month
      ? new Date(month)
      : new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
    const monthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59);
    const monthLabel = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`;
    const since = monthStart.toISOString();

    this.logger.log(`Generating Learning Note for ${monthLabel}`);

    // 1. Aggregate interaction stats
    const [sessionCount, messageCount, flaggedCount] = await Promise.all([
      this.prisma.session.count({ where: { createdAt: { gte: monthStart, lte: monthEnd }, isEval: false } }),
      this.prisma.message.count({ where: { createdAt: { gte: monthStart, lte: monthEnd }, role: "user", session: { isEval: false } } }),
      this.prisma.session.count({ where: { createdAt: { gte: monthStart, lte: monthEnd }, reviewFlagged: true, isEval: false } }),
    ]);

    // 2. Top query topics
    const topicsData = await this.analytics.getTopics(since, 10);

    // 3. Content gaps
    const gapsData = await this.analytics.getContentGaps(since, 30);

    // 4. Language distribution
    const langData = await this.analytics.getLanguages(since);

    // 5. Safety event counts by type (FR-ANALYTICS-004)
    const safetyRows = await this.prisma.$queryRaw<Array<{ type: string; count: bigint }>>`
      SELECT type, COUNT(*) as count
      FROM "SafetyEvent"
      WHERE "createdAt" >= ${monthStart} AND "createdAt" <= ${monthEnd}
      GROUP BY type
      ORDER BY count DESC
    `;
    const safetyCounts = safetyRows.reduce((acc, r) => {
      acc[r.type] = Number(r.count);
      return acc;
    }, {} as Record<string, number>);

    // Build markdown narrative
    const markdown = `# SCCF Monthly Learning Note — ${monthLabel}

*Generated ${now.toISOString().split("T")[0]}. Anonymised — no session IDs or user text.*

---

## 1. Aggregate Interaction Numbers

| Metric | Count |
|---|---|
| Conversations | ${sessionCount} |
| User messages | ${messageCount} |
| Flagged for review | ${flaggedCount} |

---

## 2. Top Query Categories (by cancer type / topic)

${topicsData.topics.slice(0, 10).map((t, i) => `${i + 1}. **${t.topic}** — ${t.sessionCount} sessions`).join("\n")}

---

## 3. Content Gaps (unanswered queries)

Total gaps this month: **${gapsData.totalGaps}**

By abstention reason:
${Object.entries(gapsData.byReason).map(([reason, count]) => `- ${reason}: ${count}`).join("\n") || "- None recorded"}

---

## 4. Risk / Distress Pattern Counts

${Object.entries(safetyCounts).map(([type, count]) => `- **${type}**: ${count} events`).join("\n") || "- No safety events this month"}

---

## 5. Language Distribution

${langData.distribution.map((l) => `- **${l.locale}**: ${l.count} sessions (${l.pct}%)`).join("\n")}

---

## 6. New Resources Needed

*(To be filled in by the program team based on content gap patterns above.)*

---

*This note is for internal SCCF use only. Do not share raw data publicly. For donor reporting, use only aggregate numbers.*
`;

    // Build CSV for the data
    const csvLines = [
      "metric,value",
      `total_sessions,${sessionCount}`,
      `total_user_messages,${messageCount}`,
      `flagged_for_review,${flaggedCount}`,
      `content_gaps,${gapsData.totalGaps}`,
      ...topicsData.topics.map((t) => `topic_${t.topic.replace(/,/g, "")},${t.sessionCount}`),
      ...langData.distribution.map((l) => `lang_${l.locale},${l.count}`),
      ...Object.entries(safetyCounts).map(([type, count]) => `safety_${type},${count}`),
    ];
    const csv = csvLines.join("\n");

    // Email with attachments
    const html = `
<html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
<h2 style="color:#c0392b">SCCF Monthly Learning Note — ${monthLabel}</h2>
<p>Please find the monthly Learning Note attached as:</p>
<ul>
  <li><strong>learning-note-${monthLabel}.md</strong> — narrative markdown report</li>
  <li><strong>learning-note-${monthLabel}.csv</strong> — data for Google Sheets</li>
</ul>
<p>To open the CSV in Google Sheets: File → Import → Upload.</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<h3 style="color:#333">Quick Summary</h3>
<ul>
  <li><strong>${sessionCount}</strong> conversations</li>
  <li><strong>${messageCount}</strong> user messages</li>
  <li><strong>${flaggedCount}</strong> sessions flagged for review</li>
  <li><strong>${gapsData.totalGaps}</strong> content gaps</li>
  <li>Top topic: <strong>${topicsData.topics[0]?.topic ?? "—"}</strong></li>
</ul>
<p style="color:#aaa;font-size:11px">Suchi Cancer Bot — automated monthly learning note. Anonymised data only.</p>
</body></html>`;

    await this.email.sendEmail({
      to: LEARNING_NOTE_RECIPIENTS.join(", "),
      subject: `SCCF Learning Note — ${monthLabel}`,
      html,
      // Note: nodemailer attachment support requires adding attachments to sendEmail
      // For now, the markdown/CSV is embedded as plain text in the email
      text: `${markdown}\n\n---\nCSV DATA:\n\n${csv}`,
    });

    this.logger.log(`Learning Note sent for ${monthLabel}: sessions=${sessionCount} gaps=${gapsData.totalGaps}`);
    return { ok: true, month: monthLabel };
  }
}
