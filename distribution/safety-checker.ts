import { ChannelName, GeneratedPack } from "./generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SafetyViolation {
  rule: number; // 1–5
  description: string; // human-readable: what was found
}

export interface ChannelSafetyResult {
  channel: ChannelName;
  passed: boolean;
  violations: SafetyViolation[];
}

export interface SafetyReport {
  packId: string; // articleSlug
  checkedAt: string; // ISO timestamp
  allPassed: boolean; // true only if ALL channels passed
  channels: Record<ChannelName, ChannelSafetyResult>;
}

// ---------------------------------------------------------------------------
// Rule implementations
// ---------------------------------------------------------------------------

/**
 * Rule 1 — No definitive diagnosis language.
 */
function checkRule1(content: string): SafetyViolation | null {
  const exactPhrases = [
    "you have cancer",
    "this is cancer",
    "you are diagnosed",
    "your cancer",
    "confirms cancer",
    "it is cancer",
  ];

  for (const phrase of exactPhrases) {
    if (content.toLowerCase().includes(phrase)) {
      return {
        rule: 1,
        description: `Definitive diagnosis language found: "${phrase}"`,
      };
    }
  }

  // "you have [cancer type]"
  const cancerTypePattern =
    /you have (breast|lung|oral|cervical|colorectal|prostate|ovarian|leukemia|lymphoma|pediatric|cancer)/i;
  const match = content.match(cancerTypePattern);
  if (match) {
    return {
      rule: 1,
      description: `Definitive diagnosis language found: "${match[0]}"`,
    };
  }

  return null;
}

/**
 * Rule 2 — No dosage or drug-specific treatment advice.
 */
function checkRule2(content: string): SafetyViolation | null {
  // Numeric dosage
  const dosagePattern = /\d+\s*(mg|ml)/i;
  const dosageMatch = content.match(dosagePattern);
  if (dosageMatch) {
    return {
      rule: 2,
      description: `Dosage information found: "${dosageMatch[0]}"`,
    };
  }

  // Drug protocol keywords
  const protocolPhrases = [
    "chemotherapy dose",
    "radiation dose",
    "prescribed dose",
  ];
  for (const phrase of protocolPhrases) {
    if (content.toLowerCase().includes(phrase)) {
      return {
        rule: 2,
        description: `Drug protocol keyword found: "${phrase}"`,
      };
    }
  }

  // "take [drug]" pattern
  const takeDrugPattern = /\btake\s+\w+/i;
  const takeDrugMatch = content.match(takeDrugPattern);
  if (takeDrugMatch) {
    // Only flag if the word after "take" looks like a drug (not common words)
    const commonWords = new Set([
      "a", "an", "the", "this", "that", "care", "action", "steps",
      "note", "notice", "control", "charge", "part", "time", "your",
    ]);
    const afterTake = takeDrugMatch[0].split(/\s+/)[1]?.toLowerCase();
    if (afterTake && !commonWords.has(afterTake)) {
      // Check if it specifically matches the "take [drug]" protocol wording
      const takeDrugProtocol = /\btake\s+(cisplatin|carboplatin|paclitaxel|docetaxel|fluorouracil|5-fu|tamoxifen|capecitabine)\b/i;
      const protocolMatch = content.match(takeDrugProtocol);
      if (protocolMatch) {
        return {
          rule: 2,
          description: `Drug prescription found: "${protocolMatch[0]}"`,
        };
      }
    }
  }

  // Specific chemo drug names
  const drugPattern =
    /\b(cisplatin|carboplatin|paclitaxel|docetaxel|fluorouracil|5-fu|tamoxifen|capecitabine)\b/i;
  const drugMatch = content.match(drugPattern);
  if (drugMatch) {
    return {
      rule: 2,
      description: `Specific chemotherapy drug name found: "${drugMatch[0]}"`,
    };
  }

  return null;
}

/**
 * Rule 3 — Must include a "consult a doctor" nudge.
 */
function checkRule3(content: string): SafetyViolation | null {
  const nudgePhrases = [
    "doctor",
    "oncologist",
    "consult",
    "seek care",
    "medical",
    "specialist",
    "health professional",
  ];

  const lower = content.toLowerCase();
  for (const phrase of nudgePhrases) {
    if (lower.includes(phrase)) {
      return null; // found — passes
    }
  }

  return {
    rule: 3,
    description:
      'No "consult a doctor" nudge found (missing: doctor/oncologist/consult/seek care/medical/specialist/health professional)',
  };
}

/**
 * Rule 4 — No alarming language without a calming action.
 */
function checkRule4(content: string): SafetyViolation | null {
  const alarmingPattern =
    /\b(fatal|deadly|kills|you will die|terminal|no cure|untreatable)\b/i;
  const alarmingMatch = content.match(alarmingPattern);

  if (!alarmingMatch) {
    return null; // no alarming words — passes
  }

  const calmingPhrases = [
    "treatable",
    "early detection",
    "doctor",
    "treatment",
    "survive",
    "curable",
  ];
  const lower = content.toLowerCase();
  for (const phrase of calmingPhrases) {
    if (lower.includes(phrase)) {
      return null; // alarming word present but calming action also present — passes
    }
  }

  return {
    rule: 4,
    description: `Alarming language "${alarmingMatch[0]}" found without a calming action`,
  };
}

/**
 * Rule 5 — No unsupported factual claims about cure rates or statistics.
 */
function checkRule5(content: string): SafetyViolation | null {
  const highStatPattern = /\b(100%|99%|98%) (cure|survival|success)/i;
  const highStatMatch = content.match(highStatPattern);
  if (highStatMatch) {
    return {
      rule: 5,
      description: `Unsupported statistical claim found: "${highStatMatch[0]}"`,
    };
  }

  const guaranteedPattern = /guaranteed (cure|treatment|recovery)/i;
  const guaranteedMatch = content.match(guaranteedPattern);
  if (guaranteedMatch) {
    return {
      rule: 5,
      description: `Guaranteed outcome claim found: "${guaranteedMatch[0]}"`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run all 5 safety rules against each channel in the pack.
 * Returns a SafetyReport with per-channel results.
 */
export function checkSafety(pack: GeneratedPack): SafetyReport {
  const checkedAt = new Date().toISOString();
  const channelResults = {} as Record<ChannelName, ChannelSafetyResult>;

  const allChannels: ChannelName[] = [
    "linkedin",
    "twitter",
    "instagram",
    "whatsapp",
    "youtube_short",
  ];

  for (const channelName of allChannels) {
    const channelResult = pack.channels[channelName];

    // Skip all rule checks for failed channels — no content to check
    if (!channelResult || channelResult.status === "failed") {
      channelResults[channelName] = {
        channel: channelName,
        passed: true,
        violations: [],
      };
      continue;
    }

    const { content } = channelResult;
    const violations: SafetyViolation[] = [];

    const r1 = checkRule1(content);
    if (r1) violations.push(r1);

    const r2 = checkRule2(content);
    if (r2) violations.push(r2);

    // Rule 3 only applies to non-failed channels (already guarded above)
    const r3 = checkRule3(content);
    if (r3) violations.push(r3);

    const r4 = checkRule4(content);
    if (r4) violations.push(r4);

    const r5 = checkRule5(content);
    if (r5) violations.push(r5);

    channelResults[channelName] = {
      channel: channelName,
      passed: violations.length === 0,
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
