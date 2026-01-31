import { DailyReportMetrics } from './daily-report.service';

/**
 * Generate a markdown report from daily metrics
 */
export function generateMarkdownReport(metrics: DailyReportMetrics): string {
  const dateStr = metrics.dateRange.from.toISOString().split('T')[0];
  const responseRate = metrics.totalResponses > 0
    ? ((metrics.totalResponses - metrics.abstentionCount) / metrics.totalResponses * 100).toFixed(1)
    : '0';

  const lines: string[] = [];

  // Header
  lines.push(`# Suchi Beta Daily Report - ${dateStr}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push(`- **Total Queries**: ${metrics.totalQueries}`);
  lines.push(`- **Total Responses**: ${metrics.totalResponses}`);
  lines.push(`- **Response Rate**: ${responseRate}% (${metrics.totalResponses - metrics.abstentionCount} answered, ${metrics.abstentionCount} abstentions)`);
  lines.push(`- **User Satisfaction**: ${metrics.feedback.satisfactionRate.toFixed(1)}% positive (${metrics.feedback.thumbsUp} up, ${metrics.feedback.thumbsDown} down)`);
  lines.push(`- **Safety Events**: ${metrics.safetyEvents.total}`);
  lines.push(`- **Unique Sessions**: ${metrics.uniqueSessions}`);
  lines.push('');

  // Response Quality
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

  // User Satisfaction
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

  // Safety & Reliability
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

  // User Demographics
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

  // Flagged Conversations
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

  // Footer
  lines.push('---');
  lines.push(`*Report generated at ${new Date().toISOString()}*`);

  return lines.join('\n');
}

/**
 * Generate a JSON report (for programmatic use)
 */
export function generateJsonReport(metrics: DailyReportMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
