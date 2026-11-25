/**
 * The automatic gate every platform draft passes before the owner sees it.
 * A draft passes only with no hard violation and an editorial score of at
 * least EDITORIAL_GATE.
 */
import { ContentBrief, Platform } from "../social.types";
import { lintVoice, VoiceViolation } from "./voice-lint";
import { checkSources } from "./source-check";
import { EDITORIAL_GATE, EditorialScore, scoreEditorial } from "./editorial-score";

export interface GateResult {
  passed: boolean;
  violations: VoiceViolation[];
  score: EditorialScore;
}

export function gateDraft(platform: Platform, text: string, brief: ContentBrief, cardText?: string): GateResult {
  const violations = [...lintVoice(platform, text, cardText), ...checkSources(platform, text, brief, cardText)];
  const score = scoreEditorial(platform, text, brief, cardText);
  if (score.total < EDITORIAL_GATE) {
    violations.push({ code: "score", reason: `editorial score ${score.total} is below ${EDITORIAL_GATE} (${score.notes.join("; ") || "no notes"})` });
  }
  return { passed: violations.length === 0, violations, score };
}

/** One line per violation, for the regeneration prompt and the owner's email. */
export function describeViolations(v: VoiceViolation[]): string[] {
  return v.map((x) => (x.excerpt ? `${x.reason} (in: "${x.excerpt}")` : x.reason));
}
