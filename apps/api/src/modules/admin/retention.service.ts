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
  whatsAppContacts: number;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runRetention(now = new Date()): Promise<RetentionResult> {
    const cutoff90 = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const cutoff365 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    this.logger.log(`Retention job starting — cutoff90: ${cutoff90.toISOString()}, cutoff365: ${cutoff365.toISOString()}`);

    const totals: RetentionResult = {
      cutoff: cutoff90.toISOString(),
      sessions: 0,
      messages: 0,
      feedback: 0,
      safetyEvents: 0,
      voiceInteractions: 0,
      whatsAppContacts: 0,
    };

    // ─── Phase 1: 90-Day Retention (Messages, Voice, WhatsApp) ───────────────
    let offset90 = 0;
    while (true) {
      const batch = await this.prisma.session.findMany({
        where: {
          createdAt: { lt: cutoff90 },
          isEval: false,
        },
        select: { id: true },
        take: BATCH_SIZE,
        skip: offset90,
        orderBy: { createdAt: "asc" },
      });

      if (batch.length === 0) break;
      const ids = batch.map((s) => s.id);

      // Delete messages
      const { count: msgCount } = await this.prisma.message.deleteMany({
        where: { sessionId: { in: ids } },
      });
      totals.messages += msgCount;

      // Delete voice interactions
      const { count: viCount } = await this.prisma.voiceInteraction.deleteMany({
        where: { sessionId: { in: ids } },
      });
      totals.voiceInteractions += viCount;

      offset90 += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }

    // Purge inactive WhatsApp contacts older than 90 days to protect phone number privacy
    const { count: waOrphanCount } = await this.prisma.whatsAppContact.deleteMany({
      where: { lastActiveAt: { lt: cutoff90 } },
    });
    totals.whatsAppContacts += waOrphanCount;

    // ─── Phase 2: 365-Day Retention (Feedback, Safety Events, Sessions) ──────
    while (true) {
      const batch = await this.prisma.session.findMany({
        where: {
          createdAt: { lt: cutoff365 },
          isEval: false,
        },
        select: { id: true },
        take: BATCH_SIZE,
        orderBy: { createdAt: "asc" },
      });

      if (batch.length === 0) break;
      const ids = batch.map((s) => s.id);

      // Delete feedback
      const { count: fbCount } = await this.prisma.feedback.deleteMany({
        where: { sessionId: { in: ids } },
      });
      totals.feedback += fbCount;

      // Delete safety events
      const { count: seCount } = await this.prisma.safetyEvent.deleteMany({
        where: { sessionId: { in: ids } },
      });
      totals.safetyEvents += seCount;

      // Delete sessions
      const { count: sCount } = await this.prisma.session.deleteMany({
        where: { id: { in: ids } },
      });
      totals.sessions += sCount;

      if (batch.length < BATCH_SIZE) break;
    }

    this.logger.log(
      `Retention complete — sessions=${totals.sessions} messages=${totals.messages} ` +
      `feedback=${totals.feedback} safetyEvents=${totals.safetyEvents} voice=${totals.voiceInteractions} ` +
      `whatsapp=${totals.whatsAppContacts}`
    );
    return totals;
  }
}
