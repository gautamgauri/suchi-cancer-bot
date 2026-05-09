import { ChannelName, GeneratedPack } from "./generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EthicsViolation {
  rule: string;        // short name e.g. "fearbait"
  description: string; // human-readable
}

export interface ChannelEthicsResult {
  channel: ChannelName;
  passed: boolean;
  violations: EthicsViolation[];
}

export interface EthicsReport {
  packId: string;
  checkedAt: string;
  allPassed: boolean;
  channels: Record<ChannelName, ChannelEthicsResult>;
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

/**
 * Rule E1 — No fearbait language.
 *
 * These phrases manufacture dread rather than inform.  Suchi's voice is calm
 * and action-oriented; sensationalised headlines erode trust in vulnerable
 * audiences.
 */
function checkRuleE1(content: string): EthicsViolation | null {
  const phrases = [
    "silent killer",
    "deadly cancer",
    "will kill you",
    "cancer kills",
    "doctors hate",
    "shocking truth",
    "you'll die",
    "kills thousands",
  ];

  const lower = content.toLowerCase();
  for (const phrase of phrases) {
    if (lower.includes(phrase)) {
      return {
        rule: "fearbait",
        description: `Fearbait language found: "${phrase}"`,
      };
    }
  }

  return null;
}

/**
 * Rule E2 — No exaggerated certainty or miracle narrative.
 *
 * Overclaiming sets unrealistic expectations and can lead patients to delay
 * or abandon evidence-based treatment in favour of false hope.
 */
function checkRuleE2(content: string): EthicsViolation | null {
  const phrases = [
    "cures cancer",
    "completely curable",
    "100% preventable",
    "guaranteed to",
    "miracle",
    "revolutionary treatment",
  ];

  const lower = content.toLowerCase();
  for (const phrase of phrases) {
    if (lower.includes(phrase)) {
      return {
        rule: "exaggerated_certainty",
        description: `Overclaiming language found: "${phrase}"`,
      };
    }
  }

  return null;
}

/**
 * Rule E3 — Alarming symptom language must pair with action guidance.
 *
 * Extends safety rule 4.  Severity descriptors ("spreading", "aggressive",
 * etc.) raise anxiety; the same passage must ground readers with a concrete
 * next step so they leave with agency, not paralysis.
 */
function checkRuleE3(content: string): EthicsViolation | null {
  const alarmingPattern =
    /\b(spreading|aggressive|fast-growing|rapidly)\b/i;

  if (!alarmingPattern.test(content)) {
    return null; // no alarming symptom words — passes
  }

  const actionPhrases = [
    "consult",
    "doctor",
    "oncologist",
    "get checked",
    "seek",
    "visit",
  ];

  const lower = content.toLowerCase();
  for (const phrase of actionPhrases) {
    if (lower.includes(phrase)) {
      return null; // alarming word present but action guidance also present — passes
    }
  }

  return {
    rule: "alarm_without_action",
    description:
      "Alarming symptom language without action guidance",
  };
}

/**
 * Rule E4 — No survivor exceptionalism.
 *
 * Phrases like "beat cancer" or "won the battle" imply that outcome is purely
 * a matter of will, which can shame patients with poor prognoses.  Suchi
 * prefers neutral, compassionate framing: "lives with cancer", "is in
 * remission".
 *
 * NOTE: E4 violations are ADVISORY — they are recorded in the report and
 * included in the violations list so reviewers can act on them, but they do
 * NOT set `passed: false`.  This allows the pipeline to proceed while still
 * surfacing the language for editorial review.  When a future policy decision
 * is made to enforce this rule, change the logic in checkEthics() to treat E4
 * the same as E1–E3.
 */
function checkRuleE4(content: string): EthicsViolation | null {
  const phrases = [
    "beat cancer",
    "defeated cancer",
    "won the battle",
    "cancer warrior",
  ];

  const lower = content.toLowerCase();
  for (const phrase of phrases) {
    if (lower.includes(phrase)) {
      return {
        rule: "survivor_exceptionalism",
        description: `Survivor exceptionalism language found: "${phrase}" — consider neutral framing`,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run all 4 ethics rules against each channel in the pack.
 *
 * Rules E1–E3 mark a channel as failed when triggered.
 * Rule E4 is advisory: the violation is recorded but `passed` stays true
 * (see comment on checkRuleE4 above).
 *
 * Failed channels (generation errors) are skipped — there is no content to
 * evaluate.
 */
export function checkEthics(pack: GeneratedPack): EthicsReport {
  const checkedAt = new Date().toISOString();
  const channelResults = {} as Record<ChannelName, ChannelEthicsResult>;

  const allChannels: ChannelName[] = [
    "linkedin",
    "twitter",
    "instagram",
    "whatsapp",
    "youtube_short",
  ];

  for (const channelName of allChannels) {
    const channelResult = pack.channels[channelName];

    // Skip rule checks for failed channels — no content to check
    if (!channelResult || channelResult.status === "failed") {
      channelResults[channelName] = {
        channel: channelName,
        passed: true,
        violations: [],
      };
      continue;
    }

    const { content } = channelResult;
    const violations: EthicsViolation[] = [];

    const e1 = checkRuleE1(content);
    if (e1) violations.push(e1);

    const e2 = checkRuleE2(content);
    if (e2) violations.push(e2);

    const e3 = checkRuleE3(content);
    if (e3) violations.push(e3);

    const e4 = checkRuleE4(content);
    if (e4) violations.push(e4);

    // E4 is advisory — violations that are ONLY survivor_exceptionalism do not
    // mark the channel as failed.  E1, E2, E3 violations do.
    const blockingViolations = violations.filter(
      (v) => v.rule !== "survivor_exceptionalism"
    );

    channelResults[channelName] = {
      channel: channelName,
      passed: blockingViolations.length === 0,
      violations,
    };
  }

  const allPassed = allChannels.every((ch) => channelResults[ch].passed);

  return {
    packId: pack.articleSlug,
    checkedAt,
    allPassed,
    channels: channelResults,
  };
}
