import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AnalyticsService } from "../analytics/analytics.service";
import { SafetyService } from "../safety/safety.service";
import { AbstentionService } from "../abstention/abstention.service";
import { EmergencyFastPathResult } from "../safety/emergency-fast-path";
import { ClassifierResult, SafetyClassifierService } from "./safety-classifier.service";
import { ClassifierSeverity } from "./safety-classifier.prompt";
import { RuleVerdict, computeRuleVerdict, severityRank } from "./rule-verdict";

export const SHADOW_EVENT_NAME = "safety_classifier_shadow";

export interface ShadowObserveInput {
  sessionId: string;
  /** Id of the persisted USER message, so a reviewer can look it up through existing authorised DB access. */
  messageId?: string | null;
  /** Used only as classifier input — never logged or emitted. */
  userText: string;
  channel?: string | null;
  userContext?: string | null;
  /** The emergency fast path's verdict for this message, as the chat flow computed it. */
  fastPath: Pick<EmergencyFastPathResult, "severity" | "matchedPatterns">;
}

/**
 * Direction of a disagreement:
 * - ai_higher: the AI would have ADDED or raised an escalation the rules did not
 *   make. These are the Phase 2 candidates and the ones to human-review.
 * - ai_lower: the rules escalated and the AI did not. Irrelevant to behaviour
 *   (the AI can never downgrade) but tracked as an AI miss-rate.
 */
export type ShadowDirection = "agree" | "ai_higher" | "ai_lower" | "not_comparable";

/**
 * The `safety_classifier_shadow` event payload. Identifiers, enums, numbers
 * only — by construction it has no field that can hold message text.
 */
export interface ShadowEventPayload {
  messageId: string | null;
  channel: string | null;
  promptVersion: string;
  model: string;
  outcome: ClassifierResult["outcome"];
  latencyMs: number;
  timeoutMs: number;
  sampleRate: number;
  ruleSeverity: ClassifierSeverity;
  ruleSources: string[];
  ruleLabels: string[];
  aiSeverity: ClassifierSeverity;
  aiCategories: string[];
  aiConfidence: number;
  droppedCategoryCount: number;
  /** Only ever true when outcome === "ok". */
  disagreement: boolean;
  direction: ShadowDirection;
  /** Always false in Phase 1: the verdict did not and cannot affect the reply. */
  enforced: false;
}

/**
 * Phase 1 (shadow mode) wiring of the AI safety classifier.
 *
 * `observe()` is called once per inbound message by ChatService, which does
 * NOT await it. It:
 *   1. returns immediately (no LLM call) when the flag is off, the message is
 *      sampled out, or too many calls are already in flight;
 *   2. otherwise classifies the message with a hard timeout;
 *   3. recomputes the deterministic rule verdict (pure regex, no side effects);
 *   4. emits one `safety_classifier_shadow` analytics event + structured log
 *      comparing the two. No raw text is included.
 *
 * It never throws and its returned promise never rejects. Nothing it produces
 * flows back into the chat turn — the reply is decided by the rules alone.
 *
 * TODO(Phase 2 — REQUIRES SCCF CLINICAL SIGN-OFF): an enforcing mode in which
 * an "ai_higher" verdict ADDS an escalation. Deliberately not implemented; there
 * is no flag for it. It must stay add-only (never suppress or downgrade a rule
 * escalation) and must be designed against the Phase 1 metrics.
 */
@Injectable()
export class SafetyClassifierShadowService {
  private readonly logger = new Logger(SafetyClassifierShadowService.name);
  readonly enabled: boolean;
  readonly sampleRate: number;
  readonly maxInFlight: number;
  private inFlight = 0;
  /** Overridable in tests. */
  random: () => number = Math.random;

  constructor(
    private readonly classifier: SafetyClassifierService,
    private readonly analytics: AnalyticsService,
    private readonly safety: SafetyService,
    private readonly abstention: AbstentionService,
    private readonly config: ConfigService,
  ) {
    this.enabled = String(this.config.get("SAFETY_CLASSIFIER_SHADOW_ENABLED") ?? "false").toLowerCase() === "true";
    const rate = Number(this.config.get("SAFETY_CLASSIFIER_SAMPLE_RATE") ?? 1);
    this.sampleRate = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1;
    const cap = Number(this.config.get("SAFETY_CLASSIFIER_MAX_IN_FLIGHT") ?? 16);
    this.maxInFlight = Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 16;
    if (this.enabled) {
      this.logger.log(
        `AI safety classifier SHADOW mode on (sampleRate=${this.sampleRate}, timeoutMs=${this.classifier.timeoutMs}, maxInFlight=${this.maxInFlight}) — verdicts are logged only`,
      );
    }
  }

  /**
   * Fire-and-forget entry point. Resolves with the emitted payload (for tests
   * and callers that want it) or null when nothing was classified.
   */
  observe(input: ShadowObserveInput): Promise<ShadowEventPayload | null> {
    try {
      if (!this.enabled) return Promise.resolve(null);
      if (this.sampleRate <= 0 || this.random() >= this.sampleRate) return Promise.resolve(null);
      if (this.inFlight >= this.maxInFlight) {
        this.logger.warn({ event: "safety_classifier_shadow_skipped", reason: "max_in_flight", maxInFlight: this.maxInFlight });
        return Promise.resolve(null);
      }
    } catch {
      return Promise.resolve(null);
    }

    this.inFlight++;
    return this.run(input)
      .catch((err: any) => {
        this.logger.warn({ event: "safety_classifier_shadow_failed", error: String(err?.message ?? err).substring(0, 200) });
        return null;
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  private async run(input: ShadowObserveInput): Promise<ShadowEventPayload> {
    // Yield to the event loop first so none of the work below (prompt build,
    // SDK import, regex re-check) runs on the chat turn's own tick.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const result = await this.classifier.classify(input.userText, {
      userContext: input.userContext ?? null,
      channel: input.channel ?? null,
      // Treatment status is not reliably known at this point in the flow.
      onTreatment: null,
    });

    const rules = computeRuleVerdict(
      input.fastPath,
      this.safety.evaluate(input.userText),
      this.abstention.hasUrgencyIndicators(input.userText),
    );

    const payload = buildShadowPayload(input, rules, result, this.classifier.timeoutMs, this.sampleRate);

    this.logger.log({ event: SHADOW_EVENT_NAME, sessionId: input.sessionId, ...payload });
    try {
      await this.analytics.emit(SHADOW_EVENT_NAME, payload, input.sessionId);
    } catch (err: any) {
      this.logger.warn(`Analytics emit failed: ${err?.message}`);
    }
    return payload;
  }
}

export function compareSeverities(
  rule: ClassifierSeverity,
  ai: ClassifierSeverity,
  comparable: boolean,
): { disagreement: boolean; direction: ShadowDirection } {
  if (!comparable) return { disagreement: false, direction: "not_comparable" };
  const diff = severityRank(ai) - severityRank(rule);
  if (diff === 0) return { disagreement: false, direction: "agree" };
  return { disagreement: true, direction: diff > 0 ? "ai_higher" : "ai_lower" };
}

export function buildShadowPayload(
  input: Pick<ShadowObserveInput, "messageId" | "channel">,
  rules: RuleVerdict,
  result: ClassifierResult,
  timeoutMs: number,
  sampleRate: number,
): ShadowEventPayload {
  const { disagreement, direction } = compareSeverities(rules.severity, result.verdict.severity, result.outcome === "ok");
  return {
    messageId: input.messageId ?? null,
    channel: input.channel ?? null,
    promptVersion: result.promptVersion,
    model: result.model,
    outcome: result.outcome,
    latencyMs: result.latencyMs,
    timeoutMs,
    sampleRate,
    ruleSeverity: rules.severity,
    ruleSources: rules.sources,
    ruleLabels: rules.labels,
    aiSeverity: result.verdict.severity,
    aiCategories: [...result.verdict.categories],
    aiConfidence: Math.round(result.verdict.confidence * 1000) / 1000,
    droppedCategoryCount: result.droppedCategoryCount,
    disagreement,
    direction,
    enforced: false,
  };
}
