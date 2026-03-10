/**
 * CLI script to generate daily beta testing reports
 *
 * Usage:
 *   npx ts-node src/scripts/generate-daily-report.ts --date 2026-01-30
 *   npx ts-node src/scripts/generate-daily-report.ts --from 2026-01-25 --to 2026-01-30
 *   npx ts-node src/scripts/generate-daily-report.ts  # defaults to yesterday
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Inline the service logic to avoid NestJS bootstrap overhead
interface DailyReportMetrics {
  dateRange: { from: Date; to: Date };
  totalQueries: number;
  totalResponses: number;
  abstentionCount: number;
  abstentionRate: number;
  abstentionReasons: Array<{ reason: string; count: number }>;
  citationConfidence: { green: number; yellow: number; red: number };
  evidenceQuality: { strong: number; weak: number; conflicting: number; insufficient: number };
  latency: { p50: number; p95: number; avg: number };
  feedback: { thumbsUp: number; thumbsDown: number; satisfactionRate: number };
  topFeedbackReasons: Array<{ reason: string; count: number }>;
  safetyEvents: { total: number; byType: Array<{ type: string; count: number }> };
  hallucinations: number;
  flaggedConversations: Array<{ sessionId: string; reason: string; userQuery: string; createdAt: Date }>;
  uniqueSessions: number;
  avgQueriesPerSession: number;
  userContextBreakdown: Array<{ context: string; count: number }>;
  cancerTypeBreakdown: Array<{ cancerType: string; count: number }>;
  geoBreakdown: Array<{ country: string; count: number }>;
}

async function generateMetrics(prisma: PrismaClient, from: Date, to: Date): Promise<DailyReportMetrics> {
  console.log(`Generating metrics from ${from.toISOString()} to ${to.toISOString()}`);

  const assistantMessages = await prisma.message.findMany({
    where: { createdAt: { gte: from, lt: to }, role: 'assistant' },
    include: { session: true },
  });

  const userMessages = await prisma.message.findMany({
    where: { createdAt: { gte: from, lt: to }, role: 'user' },
    select: { id: true, sessionId: true, text: true, createdAt: true },
  });

  const feedback = await prisma.feedback.findMany({
    where: { createdAt: { gte: from, lt: to } },
  });

  const safetyEvents = await prisma.safetyEvent.findMany({
    where: { createdAt: { gte: from, lt: to } },
  });

  const analyticsEvents = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      eventName: { in: ['citation_enforcement_failed', 'abstention_response'] },
    },
  });

  const totalQueries = userMessages.length;
  const totalResponses = assistantMessages.length;
  const abstentions = assistantMessages.filter(m => m.abstentionReason);
  const abstentionCount = abstentions.length;

  const greenConfidence = assistantMessages.filter(
    m => m.evidenceGatePassed && (m.citationCount ?? 0) >= 2
  ).length;
  const yellowConfidence = assistantMessages.filter(
    m => m.evidenceGatePassed && (m.citationCount ?? 0) === 1
  ).length;
  const redConfidence = assistantMessages.filter(
    m => !m.evidenceGatePassed || m.abstentionReason
  ).length;

  const evidenceQuality = {
    strong: assistantMessages.filter(m => m.evidenceQuality === 'strong').length,
    weak: assistantMessages.filter(m => m.evidenceQuality === 'weak').length,
    conflicting: assistantMessages.filter(m => m.evidenceQuality === 'conflicting').length,
    insufficient: assistantMessages.filter(m => m.evidenceQuality === 'insufficient').length,
  };

  const latencies = assistantMessages
    .filter(m => m.latencyMs !== null)
    .map(m => m.latencyMs as number)
    .sort((a, b) => a - b);

  const latency = {
    p50: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0,
    p95: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0,
    avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
  };

  const thumbsUp = feedback.filter(f => f.rating === 'up').length;
  const thumbsDown = feedback.filter(f => f.rating === 'down').length;
  const totalFeedback = thumbsUp + thumbsDown;

  const feedbackReasonCounts = new Map<string, number>();
  feedback.filter(f => f.reason).forEach(f => {
    feedbackReasonCounts.set(f.reason!, (feedbackReasonCounts.get(f.reason!) || 0) + 1);
  });
  const topFeedbackReasons = Array.from(feedbackReasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const abstentionReasonCounts = new Map<string, number>();
  abstentions.filter(m => m.abstentionReason).forEach(m => {
    abstentionReasonCounts.set(m.abstentionReason!, (abstentionReasonCounts.get(m.abstentionReason!) || 0) + 1);
  });
  const abstentionReasons = Array.from(abstentionReasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const safetyEventTypeCounts = new Map<string, number>();
  safetyEvents.forEach(e => {
    safetyEventTypeCounts.set(e.type, (safetyEventTypeCounts.get(e.type) || 0) + 1);
  });
  const safetyEventsByType = Array.from(safetyEventTypeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const hallucinations = analyticsEvents.filter(e => {
    const payload = e.payload as any;
    return payload?.orphanCount > 0 || e.eventName === 'citation_enforcement_failed';
  }).length;

  // Flagged conversations
  const flagged: Array<{ sessionId: string; reason: string; userQuery: string; createdAt: Date }> = [];

  const negativeFeedback = await prisma.feedback.findMany({
    where: { createdAt: { gte: from, lt: to }, rating: 'down' },
    include: {
      session: {
        include: { messages: { where: { role: 'user' }, orderBy: { createdAt: 'desc' }, take: 1 } },
      },
    },
  });

  negativeFeedback.forEach(f => {
    const userQuery = f.session.messages[0]?.text || 'N/A';
    flagged.push({
      sessionId: f.sessionId,
      reason: `Thumbs down${f.reason ? ` - "${f.reason}"` : ''}`,
      userQuery: userQuery.substring(0, 100),
      createdAt: f.createdAt,
    });
  });

  const safetyEventSessions = await prisma.safetyEvent.findMany({
    where: { createdAt: { gte: from, lt: to } },
    include: {
      session: {
        include: { messages: { where: { role: 'user' }, orderBy: { createdAt: 'desc' }, take: 1 } },
      },
    },
  });

  safetyEventSessions.forEach(e => {
    const userQuery = e.session.messages[0]?.text || 'N/A';
    if (!flagged.some(f => f.sessionId === e.sessionId)) {
      flagged.push({
        sessionId: e.sessionId,
        reason: `Safety event: ${e.type}`,
        userQuery: userQuery.substring(0, 100),
        createdAt: e.createdAt,
      });
    }
  });

  const uniqueSessionIds = new Set(userMessages.map(m => m.sessionId));
  const uniqueSessions = uniqueSessionIds.size;
  const avgQueriesPerSession = uniqueSessions > 0 ? totalQueries / uniqueSessions : 0;

  const sessions = await prisma.session.findMany({
    where: { id: { in: Array.from(uniqueSessionIds) } },
  });

  const userContextCounts = new Map<string, number>();
  sessions.forEach(s => {
    const ctx = s.userContext || 'unknown';
    userContextCounts.set(ctx, (userContextCounts.get(ctx) || 0) + 1);
  });
  const userContextBreakdown = Array.from(userContextCounts.entries())
    .map(([context, count]) => ({ context, count }))
    .sort((a, b) => b.count - a.count);

  const cancerTypeCounts = new Map<string, number>();
  sessions.filter(s => s.cancerType).forEach(s => {
    cancerTypeCounts.set(s.cancerType!, (cancerTypeCounts.get(s.cancerType!) || 0) + 1);
  });
  const cancerTypeBreakdown = Array.from(cancerTypeCounts.entries())
    .map(([cancerType, count]) => ({ cancerType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const geoCounts = new Map<string, number>();
  sessions.forEach(s => {
    const country = (s as any).country;
    if (country) {
      geoCounts.set(country, (geoCounts.get(country) || 0) + 1);
    }
  });
  const geoBreakdown = Array.from(geoCounts.entries())
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    dateRange: { from, to },
    totalQueries,
    totalResponses,
    abstentionCount,
    abstentionRate: totalResponses > 0 ? (abstentionCount / totalResponses) * 100 : 0,
    abstentionReasons,
    citationConfidence: { green: greenConfidence, yellow: yellowConfidence, red: redConfidence },
    evidenceQuality,
    latency,
    feedback: {
      thumbsUp,
      thumbsDown,
      satisfactionRate: totalFeedback > 0 ? (thumbsUp / totalFeedback) * 100 : 0,
    },
    topFeedbackReasons,
    safetyEvents: { total: safetyEvents.length, byType: safetyEventsByType },
    hallucinations,
    flaggedConversations: flagged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20),
    uniqueSessions,
    avgQueriesPerSession: Math.round(avgQueriesPerSession * 10) / 10,
    userContextBreakdown,
    cancerTypeBreakdown,
    geoBreakdown,
  };
}

function generateMarkdownReport(metrics: DailyReportMetrics): string {
  const dateStr = metrics.dateRange.from.toISOString().split('T')[0];
  const responseRate = metrics.totalResponses > 0
    ? ((metrics.totalResponses - metrics.abstentionCount) / metrics.totalResponses * 100).toFixed(1)
    : '0';

  const lines: string[] = [];

  lines.push(`# Suchi Beta Daily Report - ${dateStr}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- **Total Queries**: ${metrics.totalQueries}`);
  lines.push(`- **Total Responses**: ${metrics.totalResponses}`);
  lines.push(`- **Response Rate**: ${responseRate}% (${metrics.totalResponses - metrics.abstentionCount} answered, ${metrics.abstentionCount} abstentions)`);
  lines.push(`- **User Satisfaction**: ${metrics.feedback.satisfactionRate.toFixed(1)}% positive (${metrics.feedback.thumbsUp} up, ${metrics.feedback.thumbsDown} down)`);
  lines.push(`- **Safety Events**: ${metrics.safetyEvents.total}`);
  lines.push(`- **Unique Sessions**: ${metrics.uniqueSessions}`);
  lines.push('');

  lines.push('## Response Quality');
  lines.push('');
  lines.push('### Citation Confidence');
  lines.push('| Level | Count | % |');
  lines.push('|-------|-------|---|');
  const totalCitations = metrics.citationConfidence.green + metrics.citationConfidence.yellow + metrics.citationConfidence.red;
  if (totalCitations > 0) {
    lines.push(`| GREEN (high confidence) | ${metrics.citationConfidence.green} | ${(metrics.citationConfidence.green / totalCitations * 100).toFixed(1)}% |`);
    lines.push(`| YELLOW (limited sources) | ${metrics.citationConfidence.yellow} | ${(metrics.citationConfidence.yellow / totalCitations * 100).toFixed(1)}% |`);
    lines.push(`| RED (abstained/failed) | ${metrics.citationConfidence.red} | ${(metrics.citationConfidence.red / totalCitations * 100).toFixed(1)}% |`);
  } else {
    lines.push('| No data | 0 | 0% |');
  }
  lines.push('');

  lines.push('### Evidence Quality');
  const totalEvidence = metrics.evidenceQuality.strong + metrics.evidenceQuality.weak +
    metrics.evidenceQuality.conflicting + metrics.evidenceQuality.insufficient;
  if (totalEvidence > 0) {
    lines.push(`- Strong: ${metrics.evidenceQuality.strong} (${(metrics.evidenceQuality.strong / totalEvidence * 100).toFixed(1)}%)`);
    lines.push(`- Weak: ${metrics.evidenceQuality.weak} (${(metrics.evidenceQuality.weak / totalEvidence * 100).toFixed(1)}%)`);
    lines.push(`- Conflicting: ${metrics.evidenceQuality.conflicting} (${(metrics.evidenceQuality.conflicting / totalEvidence * 100).toFixed(1)}%)`);
    lines.push(`- Insufficient: ${metrics.evidenceQuality.insufficient} (${(metrics.evidenceQuality.insufficient / totalEvidence * 100).toFixed(1)}%)`);
  } else {
    lines.push('- No evidence data');
  }
  lines.push('');

  lines.push('### Latency');
  lines.push(`- **p50**: ${(metrics.latency.p50 / 1000).toFixed(2)}s`);
  lines.push(`- **p95**: ${(metrics.latency.p95 / 1000).toFixed(2)}s`);
  lines.push(`- **avg**: ${(metrics.latency.avg / 1000).toFixed(2)}s`);
  lines.push('');

  lines.push('## User Satisfaction');
  lines.push(`- Thumbs Up: ${metrics.feedback.thumbsUp}`);
  lines.push(`- Thumbs Down: ${metrics.feedback.thumbsDown}`);
  lines.push(`- Satisfaction Rate: ${metrics.feedback.satisfactionRate.toFixed(1)}%`);
  lines.push('');

  if (metrics.topFeedbackReasons.length > 0) {
    lines.push('### Top Feedback Reasons');
    metrics.topFeedbackReasons.forEach((r, i) => {
      lines.push(`${i + 1}. "${r.reason}" (${r.count})`);
    });
    lines.push('');
  }

  lines.push('## Safety & Reliability');
  lines.push(`- **Safety Events**: ${metrics.safetyEvents.total}`);
  lines.push(`- **Hallucinated Citations**: ${metrics.hallucinations}`);
  lines.push('');

  if (metrics.safetyEvents.byType.length > 0) {
    lines.push('### Safety Events by Type');
    metrics.safetyEvents.byType.forEach(e => {
      lines.push(`- ${e.type}: ${e.count}`);
    });
    lines.push('');
  }

  if (metrics.abstentionReasons.length > 0) {
    lines.push('### Abstention Reasons');
    metrics.abstentionReasons.forEach(r => {
      lines.push(`- ${r.reason}: ${r.count}`);
    });
    lines.push('');
  }

  lines.push('## User Demographics');
  lines.push(`- **Unique Sessions**: ${metrics.uniqueSessions}`);
  lines.push(`- **Avg Queries/Session**: ${metrics.avgQueriesPerSession}`);
  lines.push('');

  if (metrics.userContextBreakdown.length > 0) {
    lines.push('### User Context');
    metrics.userContextBreakdown.forEach(c => {
      lines.push(`- ${c.context}: ${c.count}`);
    });
    lines.push('');
  }

  if (metrics.cancerTypeBreakdown.length > 0) {
    lines.push('### Cancer Types');
    metrics.cancerTypeBreakdown.slice(0, 5).forEach(c => {
      lines.push(`- ${c.cancerType}: ${c.count}`);
    });
    lines.push('');
  }

  if (metrics.geoBreakdown.length > 0) {
    lines.push('### Geographic Distribution');
    metrics.geoBreakdown.slice(0, 5).forEach(g => {
      lines.push(`- ${g.country}: ${g.count}`);
    });
    lines.push('');
  }

  if (metrics.flaggedConversations.length > 0) {
    lines.push('## Flagged Conversations (Review Needed)');
    lines.push('');
    lines.push('| Session ID | Reason | User Query |');
    lines.push('|------------|--------|------------|');
    metrics.flaggedConversations.forEach(f => {
      const shortId = f.sessionId.substring(0, 8);
      const escapedQuery = f.userQuery.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${shortId}... | ${f.reason} | ${escapedQuery} |`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Report generated at ${new Date().toISOString()}*`);

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  let from: Date;
  let to: Date;

  // Parse arguments
  const dateArg = args.find(a => a.startsWith('--date='))?.split('=')[1];
  const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1];
  const toArg = args.find(a => a.startsWith('--to='))?.split('=')[1];

  if (dateArg) {
    // Single day report
    from = new Date(dateArg);
    from.setHours(0, 0, 0, 0);
    to = new Date(dateArg);
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
  } else if (fromArg && toArg) {
    // Date range report
    from = new Date(fromArg);
    from.setHours(0, 0, 0, 0);
    to = new Date(toArg);
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
  } else {
    // Default to yesterday
    to = new Date();
    to.setHours(0, 0, 0, 0);
    from = new Date(to);
    from.setDate(from.getDate() - 1);
  }

  console.log('='.repeat(60));
  console.log('Suchi Beta Daily Report Generator');
  console.log('='.repeat(60));
  console.log(`Date range: ${from.toISOString().split('T')[0]} to ${to.toISOString().split('T')[0]}`);
  console.log('');

  const prisma = new PrismaClient();

  try {
    const metrics = await generateMetrics(prisma, from, to);
    const report = generateMarkdownReport(metrics);

    // Ensure reports directory exists
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Save report
    const dateStr = from.toISOString().split('T')[0];
    const reportPath = path.join(reportsDir, `daily-report-${dateStr}.md`);
    fs.writeFileSync(reportPath, report);

    console.log(report);
    console.log('');
    console.log('='.repeat(60));
    console.log(`Report saved to: ${reportPath}`);
    console.log('='.repeat(60));

    // Also save JSON
    const jsonPath = path.join(reportsDir, `daily-report-${dateStr}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
    console.log(`JSON saved to: ${jsonPath}`);
  } catch (error) {
    console.error('Error generating report:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
