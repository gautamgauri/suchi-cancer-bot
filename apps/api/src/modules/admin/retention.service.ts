/**
 * RetentionService — NFR-PRIV-001
 *
 * Deletes conversation data older than 90 days. Eval sessions (isEval=true)
 * are never deleted. Processes in batches of 500 to limit lock pressure.
 *
 * Deletion order (avoids FK constraint violations):
 *   1. Messages  → cascades to MessageCitation + ReviewRecord (onDelete: Cascade in schema)
 *   2. Feedback, SafetyEvent, VoiceInteraction per session
 *   3. Sessions  → nulls AnalyticsEvent.sessionId (optional FK, DB handles it)
 *
 * Called by POST /v1/admin/housekeeping/run-retention (SchedulerOidcGuard).
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const RETENTION_DAYS = 90;
const BATCH_SIZE     = 500;

export interface RetentionResult {
  cutoff: string;
  sessions: number;
  messages: number;
  feedback: number;
  safetyEvents: number;
  voiceInteractions: number;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runRetention(now = new Date()): Promise<RetentionResult> {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    this.logger.log(`Retention job starting — cutoff: ${cutoff.toISOString()}`);

    const totals: RetentionResult = {
      cutoff: cutoff.toISOString(),
      sessions: 0,
      messages: 0,
      feedback: 0,
      safetyEvents: 0,
      voiceInteractions: 0,
    };

    // Fetch eligible session IDs in batches
    let offset = 0;
    while (true) {
      const batch = await this.prisma.session.findMany({
        where: {
          createdAt: { lt: cutoff },
          isEval: false,
        },
        select: { id: true },
        take: BATCH_SIZE,
        skip: offset,
        orderBy: { createdAt: "asc" },
      });

      if (batch.length === 0) break;
      const ids = batch.map((s) => s.id);

      await this.deleteBatch(ids, totals);
      offset += batch.length;

      // If we got fewer than BATCH_SIZE, we're done
      if (batch.length < BATCH_SIZE) break;
    }

    this.logger.log(
      `Retention complete — sessions=${totals.sessions} messages=${totals.messages} ` +
      `feedback=${totals.feedback} safetyEvents=${totals.safetyEvents} voice=${totals.voiceInteractions}`
    );
    return totals;
  }

  private async deleteBatch(sessionIds: string[], totals: RetentionResult): Promise<void> {
    // Step 1: Delete messages — cascades to MessageCitation and ReviewRecord
    const { count: msgCount } = await this.prisma.message.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    totals.messages += msgCount;

    // Step 2: Delete feedback (messageId is now null after message deletion)
    const { count: fbCount } = await this.prisma.feedback.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    totals.feedback += fbCount;

    // Step 3: Delete safety events
    const { count: seCount } = await this.prisma.safetyEvent.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    totals.safetyEvents += seCount;

    // Step 4: Delete voice interactions
    const { count: viCount } = await this.prisma.voiceInteraction.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
    totals.voiceInteractions += viCount;

    // Step 5: Delete sessions — DB nulls AnalyticsEvent.sessionId (optional FK)
    const { count: sCount } = await this.prisma.session.deleteMany({
      where: { id: { in: sessionIds } },
    });
    totals.sessions += sCount;

    this.logger.log(
      `Batch deleted: sessions=${sCount} messages=${msgCount} fb=${fbCount} se=${seCount} vi=${viCount}`
    );
  }
}
