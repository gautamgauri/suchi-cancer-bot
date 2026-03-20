import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ReviewContext,
  ReviewResult,
  runHardChecks,
  runSoftChecks,
  runAmbiguousChecks,
  SoftFailure,
} from './review-checks';

export type ReviewCopilotMode = 'off' | 'shadow' | 'active';

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);
  private readonly mode: ReviewCopilotMode;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.mode = (this.config.get<string>('REVIEW_COPILOT_MODE') || 'off') as ReviewCopilotMode;
    this.logger.log(`Review Copilot mode: ${this.mode}`);
  }

  get copilotMode(): ReviewCopilotMode {
    return this.mode;
  }

  /**
   * Review a response before delivery.
   *
   * In 'off' mode: returns PASS immediately with 0ms latency.
   * In 'shadow' mode: runs all checks, writes ReviewRecord, but never blocks/repairs.
   * In 'active' mode: runs all checks, blocks/repairs/flags as appropriate.
   */
  async review(ctx: ReviewContext): Promise<ReviewResult> {
    if (this.mode === 'off') {
      return {
        verdict: 'PASS',
        hardFailures: [],
        softFailures: [],
        ambiguousFlags: [],
        patchesApplied: [],
        repairedText: null,
        originalText: null,
        reviewLatencyMs: 0,
      };
    }

    const started = Date.now();

    // 1. Hard checks (deterministic, fast)
    const hardFailures = runHardChecks(ctx);

    // 2. Soft checks (deterministic, fast)
    const softFailures = runSoftChecks(ctx);

    // 3. Ambiguous checks (deterministic, fast)
    const ambiguousFlags = runAmbiguousChecks(ctx);

    // Determine verdict
    let verdict: ReviewResult['verdict'] = 'PASS';
    let repairedText: string | null = null;
    let originalText: string | null = null;
    const patchesApplied: ReviewResult['patchesApplied'] = [];

    if (hardFailures.length > 0) {
      verdict = 'BLOCKED';
      originalText = ctx.responseText;
    } else if (softFailures.length > 0) {
      // Apply deterministic repairs
      const repairResult = this.applyRepairs(ctx.responseText, softFailures);
      if (repairResult.patched) {
        verdict = 'REPAIRED';
        originalText = ctx.responseText;
        repairedText = repairResult.text;
        patchesApplied.push(...repairResult.patches);
      }
    }

    if (verdict === 'PASS' && ambiguousFlags.length > 0) {
      verdict = 'FLAGGED';
    }

    const reviewLatencyMs = Date.now() - started;

    const result: ReviewResult = {
      verdict,
      hardFailures,
      softFailures,
      ambiguousFlags,
      patchesApplied,
      repairedText,
      originalText,
      reviewLatencyMs,
    };

    // In shadow mode, always return PASS (but still log the record)
    if (this.mode === 'shadow') {
      this.logger.log({
        event: 'review_copilot_shadow',
        wouldHaveVerdict: verdict,
        hardFailureCount: hardFailures.length,
        softFailureCount: softFailures.length,
        ambiguousFlagCount: ambiguousFlags.length,
        reviewLatencyMs,
      });
      return {
        ...result,
        verdict: 'PASS',
        repairedText: null,
      };
    }

    return result;
  }

  /**
   * Persist a ReviewRecord to the database.
   */
  async persistRecord(
    messageId: string,
    sessionId: string,
    result: ReviewResult,
  ): Promise<void> {
    if (this.mode === 'off') return;

    try {
      await this.prisma.reviewRecord.create({
        data: {
          messageId,
          sessionId,
          verdict: result.verdict,
          hardFailures: result.hardFailures.length > 0 ? JSON.parse(JSON.stringify(result.hardFailures)) : undefined,
          softFailures: result.softFailures.length > 0 ? JSON.parse(JSON.stringify(result.softFailures)) : undefined,
          ambiguousFlags: result.ambiguousFlags.length > 0 ? JSON.parse(JSON.stringify(result.ambiguousFlags)) : undefined,
          patchesApplied: result.patchesApplied.length > 0 ? JSON.parse(JSON.stringify(result.patchesApplied)) : undefined,
          originalResponse: result.originalText,
          reviewLatencyMs: result.reviewLatencyMs,
          humanReviewStatus: result.verdict === 'FLAGGED' ? 'PENDING' : undefined,
        },
      });
    } catch (err: any) {
      // Don't let review record persistence break the response pipeline
      this.logger.error(`Failed to persist ReviewRecord: ${err.message}`);
    }
  }

  /**
   * Build a safe fallback response when a hard failure blocks delivery.
   */
  buildBlockedFallback(hardFailures: ReviewResult['hardFailures']): string {
    const failureTypes = hardFailures.map(f => f.type).join(', ');
    this.logger.warn({
      event: 'review_copilot_blocked',
      failureTypes,
      failures: hardFailures,
    });

    return (
      "I don't have enough verified information to answer this accurately right now.\n\n" +
      'For personalized medical guidance, please consult with your healthcare provider or oncology team.\n\n' +
      'You may also find general information at:\n' +
      '- National Cancer Institute: https://www.cancer.gov\n' +
      '- WHO Cancer Resources: https://www.who.int/health-topics/cancer'
    );
  }

  /**
   * Get review records with filters.
   */
  async getRecords(filters: {
    verdict?: string;
    sessionId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.verdict) where.verdict = filters.verdict;
    if (filters.sessionId) where.sessionId = filters.sessionId;
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = new Date(filters.from);
      if (filters.to) where.createdAt.lte = new Date(filters.to);
    }

    const [records, total] = await Promise.all([
      this.prisma.reviewRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      }),
      this.prisma.reviewRecord.count({ where }),
    ]);

    return { records, total };
  }

  /**
   * Get flagged items pending human review.
   */
  async getReviewQueue(limit = 50, offset = 0) {
    const where = { humanReviewStatus: 'PENDING' };
    const [records, total] = await Promise.all([
      this.prisma.reviewRecord.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit,
        skip: offset,
        include: { message: { select: { text: true, sessionId: true, createdAt: true } } },
      }),
      this.prisma.reviewRecord.count({ where }),
    ]);
    return { records, total };
  }

  /**
   * Submit a human review decision.
   */
  async submitHumanReview(
    recordId: string,
    decision: { status: 'APPROVED' | 'REJECTED' | 'MODIFIED'; reviewerId: string; note?: string },
  ) {
    return this.prisma.reviewRecord.update({
      where: { id: recordId },
      data: {
        humanReviewStatus: decision.status,
        humanReviewerId: decision.reviewerId,
        humanReviewNote: decision.note,
        humanReviewedAt: new Date(),
      },
    });
  }

  /**
   * Aggregated metrics for the review copilot.
   */
  async getMetrics(from?: string, to?: string) {
    const where: any = {};
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [total, byVerdict, avgLatency] = await Promise.all([
      this.prisma.reviewRecord.count({ where }),
      this.prisma.reviewRecord.groupBy({
        by: ['verdict'],
        where,
        _count: true,
      }),
      this.prisma.reviewRecord.aggregate({
        where,
        _avg: { reviewLatencyMs: true },
        _max: { reviewLatencyMs: true },
      }),
    ]);

    const verdictCounts: Record<string, number> = {};
    for (const row of byVerdict) {
      verdictCounts[row.verdict] = row._count;
    }

    return {
      total,
      verdictCounts,
      blockRate: total > 0 ? (verdictCounts['BLOCKED'] || 0) / total : 0,
      repairRate: total > 0 ? (verdictCounts['REPAIRED'] || 0) / total : 0,
      flagRate: total > 0 ? (verdictCounts['FLAGGED'] || 0) / total : 0,
      passRate: total > 0 ? (verdictCounts['PASS'] || 0) / total : 0,
      avgLatencyMs: avgLatency._avg.reviewLatencyMs || 0,
      maxLatencyMs: avgLatency._max.reviewLatencyMs || 0,
    };
  }

  /**
   * List all review policies.
   */
  async getPolicies() {
    return this.prisma.reviewPolicy.findMany({ orderBy: { policyCode: 'asc' } });
  }

  /**
   * Update a review policy (enable/disable, tune config).
   */
  async updatePolicy(id: string, update: { enabled?: boolean; config?: any }) {
    return this.prisma.reviewPolicy.update({
      where: { id },
      data: update,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private applyRepairs(
    text: string,
    softFailures: SoftFailure[],
  ): { patched: boolean; text: string; patches: ReviewResult['patchesApplied'] } {
    let patched = false;
    let result = text;
    const patches: ReviewResult['patchesApplied'] = [];

    for (const failure of softFailures) {
      if (!failure.repair) continue;

      switch (failure.repair.type) {
        case 'append_disclaimer': {
          const before = result;
          result = result + failure.repair.patch;
          patches.push({
            type: 'append_disclaimer',
            before: before.slice(-100),
            after: result.slice(-150),
            confidence: 1.0,
          });
          patched = true;
          break;
        }
        // Future repair types (readability, truncation, etc.) go here
      }
    }

    return { patched, text: result, patches };
  }
}
