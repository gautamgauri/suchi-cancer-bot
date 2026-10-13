import { EmergencyFastPathResult } from "../safety/emergency-fast-path";
import { SafetyResult } from "../safety/safety.templates";
import { ClassifierSeverity } from "./safety-classifier.prompt";

/**
 * The deterministic layers' combined verdict for one message, on the same
 * critical / urgent / none scale as the AI classifier, so the two can be
 * compared. This is a READ of what the rules decided — it is not used to
 * decide anything.
 */
export interface RuleVerdict {
  severity: ClassifierSeverity;
  /** Which deterministic layers escalated: fast_path, safety_rules, urgency_indicators. */
  sources: string[];
  /** Rule/pattern labels that fired (identifiers, never message text). */
  labels: string[];
}

const RANK: Record<ClassifierSeverity, number> = { none: 0, urgent: 1, critical: 2 };

export function severityRank(s: ClassifierSeverity): number {
  return RANK[s];
}

export function maxSeverity(a: ClassifierSeverity, b: ClassifierSeverity): ClassifierSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * Mapping, mirroring what the chat flow does with each layer:
 * - emergency fast path critical / urgent → critical / urgent (fixed templates);
 * - SafetyService red_flag or self_harm → critical (emergency / crisis template);
 * - AbstentionService.hasUrgencyIndicators → urgent (S2 escalation template);
 * - SafetyService "refusal" is a scope refusal, not an escalation → none.
 */
export function computeRuleVerdict(
  fastPath: Pick<EmergencyFastPathResult, "severity" | "matchedPatterns">,
  safety: Pick<SafetyResult, "classification" | "rulesFired">,
  hasUrgencyIndicators: boolean,
): RuleVerdict {
  let severity: ClassifierSeverity = "none";
  const sources: string[] = [];
  const labels: string[] = [];

  if (fastPath.severity !== "none") {
    severity = maxSeverity(severity, fastPath.severity);
    sources.push("fast_path");
    labels.push(...fastPath.matchedPatterns);
  }
  if (safety.classification === "red_flag" || safety.classification === "self_harm") {
    severity = maxSeverity(severity, "critical");
    sources.push("safety_rules");
    labels.push(...safety.rulesFired);
  }
  if (hasUrgencyIndicators) {
    severity = maxSeverity(severity, "urgent");
    sources.push("urgency_indicators");
  }
  return { severity, sources, labels };
}
