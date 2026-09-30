import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { LlmService } from "../llm/llm.service";
import {
  CLASSIFIER_CATEGORIES,
  CLASSIFIER_SEVERITIES,
  ClassifierCategory,
  ClassifierContext,
  ClassifierSeverity,
  SAFETY_CLASSIFIER_PROMPT_VERSION,
  SAFETY_CLASSIFIER_RESPONSE_SCHEMA,
  SAFETY_CLASSIFIER_SYSTEM_PROMPT,
  buildClassifierUserPrompt,
} from "./safety-classifier.prompt";

export interface ClassifierVerdict {
  severity: ClassifierSeverity;
  categories: ClassifierCategory[];
  /** 0..1 */
  confidence: number;
}

/**
 * How the call ended. Anything other than "ok" carries the NONE verdict and
 * must be read as "the classifier had no opinion" — never as "safe".
 */
export type ClassifierOutcome = "ok" | "timeout" | "error" | "parse_error";

export interface ClassifierResult {
  verdict: ClassifierVerdict;
  outcome: ClassifierOutcome;
  latencyMs: number;
  model: string;
  promptVersion: string;
  /** Categories the model returned that are not in the closed list (count only — never the values). */
  droppedCategoryCount: number;
}

export const NONE_VERDICT: ClassifierVerdict = Object.freeze({
  severity: "none",
  categories: [],
  confidence: 0,
}) as ClassifierVerdict;

const DEFAULT_TIMEOUT_MS = 3000;
/** Low temperature: we want the same label for the same message. */
const CLASSIFIER_TEMPERATURE = 0;
/** The JSON verdict is ~30 tokens; this leaves room without allowing rambling. */
const CLASSIFIER_MAX_OUTPUT_TOKENS = 128;

const rawVerdictSchema = z.object({
  severity: z.enum(CLASSIFIER_SEVERITIES as unknown as [ClassifierSeverity, ...ClassifierSeverity[]]),
  categories: z.array(z.string()).max(32),
  confidence: z.number().finite(),
});

const ALLOWED = new Set<string>(CLASSIFIER_CATEGORIES);

/**
 * Parse the model's JSON output into a verdict. Returns null on anything that
 * is not a well-formed verdict; unknown categories are dropped (and counted),
 * confidence is clamped into [0, 1].
 */
export function parseClassifierOutput(text: string): { verdict: ClassifierVerdict; droppedCategoryCount: number } | null {
  let json: unknown;
  try {
    // Tolerate a fenced block even though JSON mode should never produce one.
    const trimmed = (text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = rawVerdictSchema.safeParse(json);
  if (!parsed.success) return null;

  const categories = Array.from(new Set(parsed.data.categories.filter((c) => ALLOWED.has(c)))) as ClassifierCategory[];
  const droppedCategoryCount = parsed.data.categories.filter((c) => !ALLOWED.has(c)).length;
  const confidence = Math.min(1, Math.max(0, parsed.data.confidence));

  return {
    verdict: { severity: parsed.data.severity, categories, confidence },
    droppedCategoryCount,
  };
}

/**
 * AI safety classifier: labels one user message critical / urgent / none.
 *
 * It never throws. Timeout, API error and unparseable output all resolve to
 * the NONE verdict with a non-"ok" outcome, so whatever consumes it can treat
 * a failure as a no-op (the rule-based gate is unaffected either way).
 *
 * This service only classifies. It has no say over the response; see
 * SafetyClassifierShadowService for how the verdict is used (logged only).
 */
@Injectable()
export class SafetyClassifierService {
  private readonly logger = new Logger(SafetyClassifierService.name);
  readonly timeoutMs: number;
  readonly model: string | undefined;

  constructor(
    private readonly llm: LlmService,
    private readonly config: ConfigService,
  ) {
    const t = Number(this.config.get("SAFETY_CLASSIFIER_TIMEOUT_MS"));
    this.timeoutMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
    this.model = this.config.get<string>("SAFETY_CLASSIFIER_MODEL") || undefined;
  }

  async classify(userText: string, ctx: ClassifierContext = {}): Promise<ClassifierResult> {
    const started = Date.now();
    const modelLabel = this.model || this.config.get<string>("GEMINI_MODEL") || "gemini-default";
    const finish = (
      outcome: ClassifierOutcome,
      verdict: ClassifierVerdict = NONE_VERDICT,
      model = modelLabel,
      droppedCategoryCount = 0,
    ): ClassifierResult => ({
      verdict: { ...verdict, categories: [...verdict.categories] },
      outcome,
      latencyMs: Date.now() - started,
      model,
      promptVersion: SAFETY_CLASSIFIER_PROMPT_VERSION,
      droppedCategoryCount,
    });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), this.timeoutMs);
        // Background work: never keep the process alive for it.
        timeoutId.unref?.();
      });
      const call = this.llm.generateStructuredJson({
        systemInstruction: SAFETY_CLASSIFIER_SYSTEM_PROMPT,
        userPrompt: buildClassifierUserPrompt(userText, ctx),
        responseSchema: SAFETY_CLASSIFIER_RESPONSE_SCHEMA,
        temperature: CLASSIFIER_TEMPERATURE,
        maxOutputTokens: CLASSIFIER_MAX_OUTPUT_TOKENS,
        timeoutMs: this.timeoutMs,
        model: this.model,
      });
      // A late rejection after the timeout won must not surface as unhandled.
      call.catch(() => undefined);

      const raced = await Promise.race([call, timeout]);
      if (raced === "timeout") {
        return finish("timeout");
      }

      const parsed = parseClassifierOutput(raced.text);
      if (!parsed) {
        // Length only: the model output may echo the user's words.
        this.logger.warn({
          event: "safety_classifier_parse_error",
          promptVersion: SAFETY_CLASSIFIER_PROMPT_VERSION,
          model: raced.model,
          outputLength: raced.text?.length ?? 0,
          finishReason: raced.finishReason,
        });
        return finish("parse_error", NONE_VERDICT, raced.model);
      }
      return finish("ok", parsed.verdict, raced.model, parsed.droppedCategoryCount);
    } catch (err: any) {
      const isTimeout = /TIMEOUT|abort/i.test(err?.message ?? "") || err?.name === "AbortError";
      if (!isTimeout) {
        this.logger.warn({
          event: "safety_classifier_error",
          promptVersion: SAFETY_CLASSIFIER_PROMPT_VERSION,
          // Error class/message only; SDK errors do not include the prompt.
          error: String(err?.message ?? err).substring(0, 200),
        });
      }
      return finish(isTimeout ? "timeout" : "error");
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
