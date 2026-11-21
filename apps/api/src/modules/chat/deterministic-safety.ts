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
import type { TurnProgress } from "./chat.service";
import { boundUserText } from "./dto";
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

/**
 * Write the turn's safety verdict to `progress` (issue #221). Called once,
 * straight after the screen, before any I/O, so ChatController's timeout body
 * and a no-session reply both report what the screens concluded. Precedence
 * is the pipeline's: fast path, safety module, urgency, mental health.
 *
 * This is the only place "normal" is written, and it is written only after
 * all four screens have run. An unset `progress.safety` still means the turn
 * was not assessed.
 */
export function recordSafetyVerdict(progress: TurnProgress | undefined, screen: DeterministicSafetyScreen): void {
  if (!progress) return;
  switch (screen.gate) {
    case "emergency":
      progress.safety = { classification: "red_flag", source: "emergency_fast_path" };
      return;
    case "safety":
      progress.safety = { classification: screen.safety.classification, source: "safety_module" };
      return;
    case "urgency":
      progress.safety = { classification: "red_flag", source: "urgency_indicators" };
      return;
    case "mental_health_crisis":
      progress.safety = { classification: "mental_health_crisis", source: "mental_health" };
      return;
    case "mental_health_support":
      progress.safety = { classification: "mental_health_support", source: "mental_health" };
      return;
    default:
      progress.safety = { classification: "normal", source: "safety_module" };
  }
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
 * The deterministic safety reply for a message whose session could not be
 * resolved, or null when no deterministic gate fires. Pure: no database, no
 * logging. Same preprocessing, screen and templates as ChatService.handle,
 * with the request's locale for both the disclaimer and the templates.
 */
export function buildSessionFreeSafetyReply(
  input: { userText: string; channel?: string; inputMode?: string; locale?: string | null },
  deps: SafetyScreenDeps = standaloneScreenDeps(),
): DeterministicSafetyReply | null {
  const userText = preprocessUserText(input.userText, input.channel, input.inputMode);
  const screen = screenDeterministicSafety(userText, deps);
  if (!repliesWithoutSession(screen.gate)) return null;
  return buildDeterministicSafetyReply(screen, {
    userText,
    disclaimerLocale: input.locale,
    templateLocale: input.locale,
    isFirstMessage: false,
  });
}

/**
 * True when any of the four deterministic checks would turn a message into a
 * safety, urgent or mental-health template. Used by the WhatsApp stale-message
 * guard (AGENTS.md section 1.1): such a message must run the pipeline however
 * late it arrives.
 *
 * Both the raw text and the text after the pipeline's preprocessing are
 * checked. Typed input is spell-corrected before any check ("kemotherapy" is
 * matched as "chemotherapy"), so the guard is never blind to something the
 * pipeline would escalate.
 */
export function flaggedByDeterministicSafetyChecks(
  text: string,
  deps: SafetyScreenDeps = standaloneScreenDeps(),
  channel: string = "whatsapp",
): boolean {
  return [text, preprocessUserText(text, channel)].some((t) => screenDeterministicSafety(t, deps).gate !== "none");
}

// The checks hold no state, so one set serves callers outside Nest's DI (the
// rate-limit guard). They are the same classes ChatService is given.
let standaloneDeps: SafetyScreenDeps | undefined;
function standaloneScreenDeps(): SafetyScreenDeps {
  standaloneDeps ??= {
    safety: new SafetyService(),
    abstention: new AbstentionService(),
    empathy: new EmpathyDetector(),
  };
  return standaloneDeps;
}

/**
 * True when a raw chat request carries text that trips the emergency fast
 * path, the safety classifier's emergency or self-harm rules, or the
 * mental-health crisis screen, after the pipeline's own bounding and
 * preprocessing. The rate limiter lets such a message through, so a patient
 * who has hit the limit still gets the emergency or crisis reply.
 *
 * Refusal templates (dosage, diagnosis and so on) do not count: they are not
 * urgent, and they would otherwise be a way round the limit.
 */
export function isUrgentSafetyText(userText: unknown, channel?: unknown, inputMode?: unknown): boolean {
  if (typeof userText !== "string" || userText.trim() === "") return false;
  const text = preprocessUserText(
    boundUserText(userText),
    typeof channel === "string" ? channel : undefined,
    typeof inputMode === "string" ? inputMode : undefined,
  );
  const screen = screenDeterministicSafety(text, standaloneScreenDeps());
  if (screen.gate === "emergency" || screen.gate === "mental_health_crisis") return true;
  return (
    screen.gate === "safety" &&
    (screen.safety.classification === "red_flag" || screen.safety.classification === "self_harm")
  );
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
