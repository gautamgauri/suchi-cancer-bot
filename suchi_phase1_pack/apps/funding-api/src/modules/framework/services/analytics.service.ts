import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export type FrameworkEventType =
  | "capability_tag_applied"
  | "mel_pack_generated"
  | "program_design_generated"
  | "comparables_generated"
  | "method_card_recommended"
  | "pattern_card_recommended"
  | "card_cited_in_draft"
  | "consistency_check_run"
  | "quality_gate_passed"
  | "quality_gate_failed"
  | "card_validated"
  | "card_created";

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async track(params: {
    eventType: FrameworkEventType;
    userId?: string;
    projectId?: string;
    metadata?: Record<string, unknown>;
    durationMs?: number;
  }): Promise<void> {
    try {
      await this.prisma.frameworkAnalyticsEvent.create({
        data: {
          eventType: params.eventType,
          userId: params.userId,
          projectId: params.projectId,
          metadata: (params.metadata ?? {}) as object,
          durationMs: params.durationMs,
        },
      });
    } catch (e) {
      this.logger.warn("Analytics track failed", (e as Error).message);
    }
  }
}
