import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DailyReportMetrics {
  dateRange: {
    from: Date;
    to: Date;
  };

  // Response Quality
  totalQueries: number;
  totalResponses: number;
  abstentionCount: number;
  abstentionRate: number;
  abstentionReasons: Array<{ reason: string; count: number }>;

  citationConfidence: {
    green: number;
    yellow: number;
    red: number;
  };

  evidenceQuality: {
    strong: number;
    weak: number;
    conflicting: number;
    insufficient: number;
  };

  latency: {
    p50: number;
    p95: number;
    avg: number;
  };

  // User Satisfaction
  feedback: {
    thumbsUp: number;
    thumbsDown: number;
    satisfactionRate: number;
  };
  topFeedbackReasons: Array<{ reason: string; count: number }>;

  // Safety & Reliability
  safetyEvents: {
    total: number;
    byType: Array<{ type: string; count: number }>;
  };
  hallucinations: number; // From analytics events with orphan citations

  // Flagged Conversations
  flaggedConversations: Array<{
    sessionId: string;
    reason: string;
    userQuery: string;
    createdAt: Date;
  }>;

  // Session Stats
  uniqueSessions: number;
  avgQueriesPerSession: number;
  userContextBreakdown: Array<{ context: string; count: number }>;
  cancerTypeBreakdown: Array<{ cancerType: string; count: number }>;
  geoBreakdown: Array<{ country: string; count: number }>;
}

@Injectable()
export class DailyReportService {
  private readonly logger = new Logger(DailyReportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate metrics for a date range
   * @param from Start date (inclusive)
   * @param to End date (exclusive)
   */
  async generateMetrics(from: Date, to: Date): Promise<DailyReportMetrics> {
    this.logger.log(`Generating daily report metrics from ${from.toISOString()} to ${to.toISOString()}`);

    // Fetch all messages in date range (assistant messages only for response metrics)
    const assistantMessages = await this.prisma.message.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        role: 'assistant',
      },
      include: {
        session: true,
      },
    });

    const userMessages = await this.prisma.message.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        role: 'user',
      },
      select: {
        id: true,
        sessionId: true,
        text: true,
        createdAt: true,
      },
    });

    // Fetch feedback
    const feedback = await this.prisma.feedback.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    // Fetch safety events
    const safetyEvents = await this.prisma.safetyEvent.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
    });

    // Fetch analytics events for hallucination detection
    const analyticsEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        eventName: { in: ['citation_enforcement_failed', 'abstention_response'] },
      },
    });

    // Calculate metrics
    const totalQueries = userMessages.length;
    const totalResponses = assistantMessages.length;
    const abstentions = assistantMessages.filter(m => m.abstentionReason);
    const abstentionCount = abstentions.length;

    // Citation confidence (inferred from evidenceGatePassed and citationCount)
    const greenConfidence = assistantMessages.filter(
      m => m.evidenceGatePassed && (m.citationCount ?? 0) >= 2
    ).length;
    const yellowConfidence = assistantMessages.filter(
      m => m.evidenceGatePassed && (m.citationCount ?? 0) === 1
    ).length;
    const redConfidence = assistantMessages.filter(
      m => !m.evidenceGatePassed || m.abstentionReason
    ).length;

    // Evidence quality
    const evidenceQuality = {
      strong: assistantMessages.filter(m => m.evidenceQuality === 'strong').length,
      weak: assistantMessages.filter(m => m.evidenceQuality === 'weak').length,
      conflicting: assistantMessages.filter(m => m.evidenceQuality === 'conflicting').length,
      insufficient: assistantMessages.filter(m => m.evidenceQuality === 'insufficient').length,
    };

    // Latency
    const latencies = assistantMessages
      .filter(m => m.latencyMs !== null)
      .map(m => m.latencyMs as number)
      .sort((a, b) => a - b);

    const latency = {
      p50: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0,
      p95: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0,
      avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    };

    // Feedback
    const thumbsUp = feedback.filter(f => f.rating === 'up').length;
    const thumbsDown = feedback.filter(f => f.rating === 'down').length;
    const totalFeedback = thumbsUp + thumbsDown;

    // Top feedback reasons
    const feedbackReasonCounts = new Map<string, number>();
    feedback
      .filter(f => f.reason)
      .forEach(f => {
        const count = feedbackReasonCounts.get(f.reason!) || 0;
        feedbackReasonCounts.set(f.reason!, count + 1);
      });
    const topFeedbackReasons = Array.from(feedbackReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Abstention reasons
    const abstentionReasonCounts = new Map<string, number>();
    abstentions
      .filter(m => m.abstentionReason)
      .forEach(m => {
        const count = abstentionReasonCounts.get(m.abstentionReason!) || 0;
        abstentionReasonCounts.set(m.abstentionReason!, count + 1);
      });
    const abstentionReasons = Array.from(abstentionReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Safety events by type
    const safetyEventTypeCounts = new Map<string, number>();
    safetyEvents.forEach(e => {
      const count = safetyEventTypeCounts.get(e.type) || 0;
      safetyEventTypeCounts.set(e.type, count + 1);
    });
    const safetyEventsByType = Array.from(safetyEventTypeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    // Hallucinations (from analytics events)
    const hallucinations = analyticsEvents.filter(e => {
      const payload = e.payload as any;
      return payload?.orphanCount > 0 || e.eventName === 'citation_enforcement_failed';
    }).length;

    // Flagged conversations
    const flaggedConversations = await this.getFlaggedConversations(from, to);

    // Session stats
    const uniqueSessionIds = new Set(userMessages.map(m => m.sessionId));
    const uniqueSessions = uniqueSessionIds.size;
    const avgQueriesPerSession = uniqueSessions > 0 ? totalQueries / uniqueSessions : 0;

    // User context breakdown
    const sessions = await this.prisma.session.findMany({
      where: {
        id: { in: Array.from(uniqueSessionIds) },
      },
    });

    const userContextCounts = new Map<string, number>();
    sessions.forEach(s => {
      const ctx = s.userContext || 'unknown';
      userContextCounts.set(ctx, (userContextCounts.get(ctx) || 0) + 1);
    });
    const userContextBreakdown = Array.from(userContextCounts.entries())
      .map(([context, count]) => ({ context, count }))
      .sort((a, b) => b.count - a.count);

    // Cancer type breakdown
    const cancerTypeCounts = new Map<string, number>();
    sessions.filter(s => s.cancerType).forEach(s => {
      cancerTypeCounts.set(s.cancerType!, (cancerTypeCounts.get(s.cancerType!) || 0) + 1);
    });
    const cancerTypeBreakdown = Array.from(cancerTypeCounts.entries())
      .map(([cancerType, count]) => ({ cancerType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Geo breakdown (country field may not be in all Prisma clients)
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
      citationConfidence: {
        green: greenConfidence,
        yellow: yellowConfidence,
        red: redConfidence,
      },
      evidenceQuality,
      latency,
      feedback: {
        thumbsUp,
        thumbsDown,
        satisfactionRate: totalFeedback > 0 ? (thumbsUp / totalFeedback) * 100 : 0,
      },
      topFeedbackReasons,
      safetyEvents: {
        total: safetyEvents.length,
        byType: safetyEventsByType,
      },
      hallucinations,
      flaggedConversations,
      uniqueSessions,
      avgQueriesPerSession: Math.round(avgQueriesPerSession * 10) / 10,
      userContextBreakdown,
      cancerTypeBreakdown,
      geoBreakdown,
    };
  }

  /**
   * Get conversations that need manual review
   */
  private async getFlaggedConversations(
    from: Date,
    to: Date
  ): Promise<Array<{ sessionId: string; reason: string; userQuery: string; createdAt: Date }>> {
    const flagged: Array<{ sessionId: string; reason: string; userQuery: string; createdAt: Date }> = [];

    // Sessions with thumbs down feedback
    const negativeFeedback = await this.prisma.feedback.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        rating: 'down',
      },
      include: {
        session: {
          include: {
            messages: {
              where: { role: 'user' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
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

    // Sessions with safety events
    const safetyEventSessions = await this.prisma.safetyEvent.findMany({
      where: {
        createdAt: { gte: from, lt: to },
      },
      include: {
        session: {
          include: {
            messages: {
              where: { role: 'user' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    safetyEventSessions.forEach(e => {
      const userQuery = e.session.messages[0]?.text || 'N/A';
      // Avoid duplicates
      if (!flagged.some(f => f.sessionId === e.sessionId)) {
        flagged.push({
          sessionId: e.sessionId,
          reason: `Safety event: ${e.type}`,
          userQuery: userQuery.substring(0, 100),
          createdAt: e.createdAt,
        });
      }
    });

    // Sessions with abstentions
    const abstentionMessages = await this.prisma.message.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        role: 'assistant',
        abstentionReason: { not: null },
      },
      include: {
        session: {
          include: {
            messages: {
              where: { role: 'user' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    abstentionMessages.forEach(m => {
      const userQuery = m.session.messages[0]?.text || 'N/A';
      if (!flagged.some(f => f.sessionId === m.sessionId)) {
        flagged.push({
          sessionId: m.sessionId,
          reason: `Abstention: ${m.abstentionReason}`,
          userQuery: userQuery.substring(0, 100),
          createdAt: m.createdAt,
        });
      }
    });

    return flagged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20);
  }
}
