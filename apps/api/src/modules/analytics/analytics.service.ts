import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an analytics event. Best-effort by contract: it NEVER rejects.
   *
   * Callers await this on main success paths after the answer is already
   * stored (chat turns, sessions, feedback). A failed analytics insert must
   * not turn a good, persisted reply into a 500, so failures are logged and
   * swallowed here — one fix point instead of a try/catch at every call site.
   * Anything that needs a durable, must-succeed write (e.g. the WhatsApp
   * inbound ledger) writes through Prisma directly, not through this.
   */
  async emit(eventName: string, payload?: any, sessionId?: string): Promise<void> {
    try {
      await this.prisma.analyticsEvent.create({ data: { eventName, payload: payload ?? undefined, sessionId: sessionId ?? undefined } });
    } catch (err: any) {
      this.logger.warn(`analytics emit "${eventName}" failed (ignored): ${err?.message ?? err}`);
    }
  }
}
