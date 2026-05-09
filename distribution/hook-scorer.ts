import { ChannelName, GeneratedPack } from "./generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookScore {
  channel: ChannelName;
  hook: string; // the extracted hook text (first sentence or tweet)
  score: number; // 0–100
  signals: {
    hasIndiaContext: boolean; // mentions India/Bihar/state/local product names
    hasConcretDetail: boolean; // names a specific symptom, number, behavior
    hasQuestion: boolean; // ends with ? or uses "Do you know" etc.
    hasAlarmLanguage: boolean; // "deadly", "silent killer", "shocking", "kills" (BAD — lowers score)
    hasCalmAction: boolean; // "check", "consult", "visit", "speak to" etc.
  };
  suggestion?: string; // one-line improvement hint if score < 60
}

export interface HookReport {
  packId: string;
  scoredAt: string;
  channels: Record<ChannelName, HookScore>;
  averageScore: number;
}

// ---------------------------------------------------------------------------
// Hook extraction logic per channel
// ---------------------------------------------------------------------------

function extractHook(channel: ChannelName, content: string): string {
  switch (channel) {
    case "linkedin": {
      // First sentence: up to first `.` or `\n`
      const match = content.match(/^([^.\n]+[.]?)/);
      return match ? match[0].trim() : content.substring(0, 200).trim();
    }
    case "twitter": {
      // First tweet: text after `1/ ` up to `\n\n`
      const afterFirstTweet = content.match(/1\/\s*(.+?)(?:\n\n|$)/s);
      if (afterFirstTweet) {
        return afterFirstTweet[1].trim();
      }
      // Fallback: first line
      return content.split("\n")[0].trim();
    }
    case "instagram": {
      // Slide 1 text: after `Slide 1: `
      const match = content.match(/Slide 1:\s*(.+?)(?:\n\n|\nSlide|$)/s);
      if (match) {
        return match[1].trim();
      }
      // Fallback: first line
      return content.split("\n")[0].trim();
    }
    case "whatsapp": {
      // Entire message (it's short)
      return content.trim();
    }
    case "youtube_short": {
      // First sentence: up to first `.` or `\n`
      const match = content.match(/^([^.\n]+[.]?)/);
      return match ? match[0].trim() : content.substring(0, 200).trim();
    }
    default:
      return content.substring(0, 200).trim();
  }
}

// ---------------------------------------------------------------------------
// Signal detectors
// ---------------------------------------------------------------------------

const INDIA_CONTEXT_TERMS = [
  "india",
  "bihar",
  "eastern india",
  "gutka",
  "paan masala",
  "khaini",
  "bidi",
  "beedi",
  "ayushman",
  "pm-jay",
  "pmjay",
  "asha",
];

function detectIndiaContext(text: string): boolean {
  const lower = text.toLowerCase();
  return INDIA_CONTEXT_TERMS.some((term) => lower.includes(term));
}

const CONCRETE_SYMPTOM_TERMS = [
  "ulcer",
  "lump",
  "sore",
  "patch",
  "bleed",
  "bleeding",
  "swelling",
  "pain",
  "lesion",
  "growth",
];

function detectConcretDetail(text: string): boolean {
  // Numbers (digits)
  if (/\d/.test(text)) return true;

  // Specific symptoms
  const lower = text.toLowerCase();
  if (CONCRETE_SYMPTOM_TERMS.some((term) => lower.includes(term))) return true;

  // Specific timeframes
  if (/\b(weeks?|months?|days?|years?)\b/i.test(text)) return true;

  return false;
}

function detectQuestion(text: string): boolean {
  if (text.trimEnd().endsWith("?")) return true;
  if (/^(did you know|have you|is it|do you know)/i.test(text.trim())) return true;
  return false;
}

const ALARM_TERMS = [
  "deadly",
  "silent killer",
  "kills you",
  "shocking",
  "kills",
  "fatal",
  "will die",
];

function detectAlarmLanguage(text: string): boolean {
  const lower = text.toLowerCase();
  return ALARM_TERMS.some((term) => lower.includes(term));
}

const CALM_ACTION_TERMS = [
  "consult",
  "check",
  "visit",
  "speak to",
  "see a doctor",
  "dentist",
  "seek",
];

function detectCalmAction(text: string): boolean {
  const lower = text.toLowerCase();
  return CALM_ACTION_TERMS.some((term) => lower.includes(term));
}

// ---------------------------------------------------------------------------
// Scoring logic
// ---------------------------------------------------------------------------

function computeScore(signals: HookScore["signals"]): number {
  let score = 50;

  if (signals.hasIndiaContext) score += 15;
  if (signals.hasConcretDetail) score += 15;
  if (signals.hasQuestion) score += 10;
  if (signals.hasAlarmLanguage) score -= 20;
  if (signals.hasCalmAction) score += 10;

  // Clamp 0–100
  return Math.max(0, Math.min(100, score));
}

function buildSuggestion(score: number, signals: HookScore["signals"]): string | undefined {
  if (score >= 60) return undefined;

  if (!signals.hasIndiaContext) {
    return "Add a local context detail (Bihar, specific tobacco product, or India-specific program)";
  }
  if (!signals.hasConcretDetail) {
    return "Open with a specific symptom or timeframe instead of a general statement";
  }
  if (signals.hasAlarmLanguage) {
    return "Remove alarming language — reframe around actionable awareness";
  }
  return "Consider adding a question or local detail to increase engagement";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Score the opening hook for each channel in the pack.
 * Skips failed channels entirely.
 */
export function scoreHooks(pack: GeneratedPack): HookReport {
  const scoredAt = new Date().toISOString();

  const allChannels: ChannelName[] = [
    "linkedin",
    "twitter",
    "instagram",
    "whatsapp",
    "youtube_short",
  ];

  const channelScores = {} as Record<ChannelName, HookScore>;
  const scoredChannels: number[] = [];

  for (const channelName of allChannels) {
    const channelResult = pack.channels[channelName];

    // Skip failed channels
    if (!channelResult || channelResult.status === "failed") {
      continue;
    }

    const hook = extractHook(channelName, channelResult.content);

    const signals: HookScore["signals"] = {
      hasIndiaContext: detectIndiaContext(hook),
      hasConcretDetail: detectConcretDetail(hook),
      hasQuestion: detectQuestion(hook),
      hasAlarmLanguage: detectAlarmLanguage(hook),
      hasCalmAction: detectCalmAction(hook),
    };

    const score = computeScore(signals);
    const suggestion = buildSuggestion(score, signals);

    channelScores[channelName] = {
      channel: channelName,
      hook,
      score,
      signals,
      ...(suggestion !== undefined ? { suggestion } : {}),
    };

    scoredChannels.push(score);
  }

  const averageScore =
    scoredChannels.length > 0
      ? Math.round(scoredChannels.reduce((a, b) => a + b, 0) / scoredChannels.length)
      : 0;

  return {
    packId: pack.articleSlug,
    scoredAt,
    channels: channelScores,
    averageScore,
  };
}
