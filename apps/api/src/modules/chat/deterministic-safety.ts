/**
 * The deterministic, text-only safety screen that runs before any database
 * access (PR #202).
 *
 * Every chat turn used to read the session and count its messages before the
 * first safety gate. With the database unreachable, or its connection pool
 * exhausted, that read threw and the patient lost the emergency reply. The
 * owner approved running the pure text checks first and returning their reply
 * without its database writes when the database cannot be reached.
 *
 * Nothing here changes a pattern, a threshold, a precedence or a word of a
 * template. The screen calls the same functions the pipeline calls, in the
 * same order, on the same preprocessed text. The reply builder assembles the
 * same text, classification, actions, rows and events that ChatService used to
 * assemble inline at each gate. ChatService uses both on every turn, and the
 * WhatsApp channel uses them when it cannot resolve a session, so the logic
 * exists once.
 */
import { AbstentionService } from "../abstention/abstention.service";
import { appendDisclaimer } from "../safety/disclaimer-engine";
import { EmergencyFastPathResult, evaluateEmergencyFastPath } from "../safety/emergency-fast-path";
import { SafetyClassification } from "../safety/safety.rules";
import { SafetyService } from "../safety/safety.service";
import { SafetyResult } from "../safety/safety.templates";
import { EmpathyDetector, MentalHealthNeedResult } from "./empathy-detector";
import { cleanVoiceInput, correctMedicalSpelling } from "./input-cleaner";
import { ResponseTemplates } from "./response-templates";

/**
 * How long a safety turn waits for its session before it replies without one.
 * A healthy lookup takes milliseconds. Under pool exhaustion the lookup can
 * retry for about 31 s, which would push the reply past the controller's 55 s
 * limit.
 */
export const SAFETY_SESSION_LOOKUP_BOUND_MS = 3_000;

/** Ceiling on each best-effort write behind a safety reply. One attempt, no retry. */
export const SAFETY_WRITE_BOUND_MS = 5_000;

/**
 * The gate that decides the turn, in the pipeline's order of precedence.
 *
 * `urgency` is screened so that it keeps its precedence over the mental-health
 * gates, but it is never answered without the database: its reply depends on
 * retrieval, the LLM and the review copilot, so it stays where it is in the
 * pipeline.
 */
export type SafetyGate =
  | "emergency"
  | "safety"
  | "urgency"
  | "mental_health_crisis"
  | "mental_health_support"
  | "none";

export interface DeterministicSafetyScreen {
  gate: SafetyGate;
  emergency: EmergencyFastPathResult;
  safety: SafetyResult;
  hasUrgencyIndicators: boolean;
  mentalHealth: MentalHealthNeedResult;
}

export interface SafetyScreenDeps {
  safety: Pick<SafetyService, "evaluate">;
  abstention: Pick<AbstentionService, "hasUrgencyIndicators">;
  empathy: Pick<EmpathyDetector, "detectMentalHealthNeed">;
}

/**
 * Phase 0 input cleanup, by modality. Spoken input (the `voice` channel, or
 * the web mic: channel "web" with inputMode "voice") gets the full cleanup.
 * Typed text on any channel gets medical-spelling normalisation only, because
 * the stutter rules rewrote typed Hinglish ("didi" to "di", issue #115).
 */
export function preprocessUserText(userText: string, channel?: string, inputMode?: string): string {
  const spoken = channel === "voice" || inputMode === "voice";
  return spoken ? cleanVoiceInput(userText) : correctMedicalSpelling(userText);
}

/**
 * Run every deterministic text check on already-preprocessed text and pick the
 * gate that the pipeline would act on. All four checks are pure functions of
 * the text.
 */
export function screenDeterministicSafety(text: string, deps: SafetyScreenDeps): DeterministicSafetyScreen {
  const emergency = evaluateEmergencyFastPath(text);
  const safety = deps.safety.evaluate(text);
  const hasUrgencyIndicators = deps.abstention.hasUrgencyIndicators(text);
  const mentalHealth = deps.empathy.detectMentalHealthNeed(text);

  let gate: SafetyGate = "none";
  if (emergency.isEmergency) gate = "emergency";
  else if (safety.classification !== "normal") gate = "safety";
  else if (hasUrgencyIndicators) gate = "urgency";
  else if (mentalHealth.isCrisis) gate = "mental_health_crisis";
  else if (mentalHealth.needsSupport) gate = "mental_health_support";

  return { gate, emergency, safety, hasUrgencyIndicators, mentalHealth };
}

/** Gates whose reply is a fixed template that needs no session, retrieval or LLM. */
export function repliesWithoutSession(gate: SafetyGate): boolean {
  return (
    gate === "emergency" ||
    gate === "safety" ||
    gate === "mental_health_crisis" ||
    gate === "mental_health_support"
  );
}

export type DeterministicSafetyClassification =
  | SafetyClassification
  | "mental_health_crisis"
  | "mental_health_support";

export interface DeterministicSafetyReply {
  /** Short label for logs. Never contains user text. */
  label: string;
  responseText: string;
  safety: {
    classification: DeterministicSafetyClassification;
    actions: string[];
    bannerText?: string;
  };
  /** Fields of the assistant Message row, apart from sessionId, text and latency. */
  row: { safetyClassification: string; policyRulesFired?: string[] };
  safetyEvent?: { type: string; detail?: string };
  analytics: { name: string; payload: Record<string, unknown> };
}

export interface ReplyContext {
  /** Already-preprocessed user text. */
  userText: string;
  /** Locale for the disclaimer engine (emergency and safety templates). */
  disclaimerLocale?: string | null;
  /** Locale handed to the mental-health templates. */
  templateLocale?: string | null;
  isFirstMessage: boolean;
}

/**
 * The reply a deterministic gate produces. Null for `urgency` and `none`,
 * which the full pipeline answers.
 */
export function buildDeterministicSafetyReply(
  screen: DeterministicSafetyScreen,
  ctx: ReplyContext,
): DeterministicSafetyReply | null {
  switch (screen.gate) {
    case "emergency": {
      const fast = screen.emergency;
      const responseText = appendDisclaimer(fast.responseText!, ctx.disclaimerLocale, true, ctx.userText);
      return {
        label: "emergencyFastPath",
        responseText,
        safety: {
          classification: "red_flag",
          // Owner decision (#196): urgent keeps the banner but leaves the
          // conversation open. Critical still ends it.
          actions:
            fast.severity === "critical" ? ["show_emergency_banner", "end_conversation"] : ["show_emergency_banner"],
          // Nothing is appended on the fast path, so the banner block is the
          // whole reply (issue #111).
          bannerText: responseText,
        },
        row: { safetyClassification: "red_flag", policyRulesFired: fast.matchedPatterns },
        safetyEvent: { type: `emergency_fast_path_${fast.severity}`, detail: fast.matchedPatterns.join(",") },
        analytics: {
          name: "emergency_fast_path_triggered",
          payload: { severity: fast.severity, patterns: fast.matchedPatterns },
        },
      };
    }
    case "safety": {
      const result = screen.safety;
      const responseText = appendDisclaimer(
        result.responseText ?? "I'm sorry—can you rephrase that?",
        ctx.disclaimerLocale,
        result.classification === "red_flag",
        ctx.userText,
      );
      return {
        label: "safetyTemplate",
        responseText,
        safety: { classification: result.classification, actions: result.actions, bannerText: responseText },
        row: { safetyClassification: result.classification, policyRulesFired: result.rulesFired },
        safetyEvent: { type: result.classification, detail: result.rulesFired.join(",") },
        analytics: {
          name: "safety_triggered",
          payload: { classification: result.classification, rules: result.rulesFired },
        },
      };
    }
    case "mental_health_crisis": {
      const need = screen.mentalHealth;
      const responseText = ResponseTemplates.MH1({
        isFirstMessage: ctx.isFirstMessage,
        userText: ctx.userText,
        locale: ctx.templateLocale ?? undefined,
      } as any);
      return {
        label: "mentalHealthCrisis",
        responseText,
        safety: { classification: "mental_health_crisis", actions: ["show_crisis_resources"] },
        row: { safetyClassification: "mental_health_crisis" },
        safetyEvent: { type: "mental_health_crisis", detail: need.keywords.join(",") },
        analytics: { name: "mental_health_crisis_detected", payload: { keywords: need.keywords } },
      };
    }
    case "mental_health_support": {
      const need = screen.mentalHealth;
      const context = {
        isFirstMessage: ctx.isFirstMessage,
        userText: ctx.userText,
        locale: ctx.templateLocale ?? undefined,
      } as any;
      // Isolation gets MH3. Depression or support-seeking gets MH2.
      const responseText = need.category === "isolation" ? ResponseTemplates.MH3(context) : ResponseTemplates.MH2(context);
      return {
        label: "mentalHealthSupport",
        responseText,
        safety: { classification: "mental_health_support", actions: [] },
        row: { safetyClassification: "mental_health_support" },
        analytics: {
          name: "mental_health_support_provided",
          payload: { category: need.category, keywords: need.keywords },
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Settle with `promise`, or reject once `ms` have passed. The timer is unref'd
 * so a hung database cannot hold the process open, and a late rejection of
 * `promise` is absorbed so it never becomes an unhandled rejection.
 */
export function withinBound<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  promise.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SafetyBoundExceededError(label, ms)), ms);
    (timer as any)?.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class SafetyBoundExceededError extends Error {
  readonly code = "SAFETY_BOUND_EXCEEDED";
  constructor(label: string, ms: number) {
    super(`${label} did not settle within ${ms}ms`);
    this.name = "SafetyBoundExceededError";
  }
}

/** Error code or class for a log line. Never the message, which can echo query arguments. */
export function errorTag(err: any): string {
  return String(err?.code ?? err?.name ?? "unknown");
}
