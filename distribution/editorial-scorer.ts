import { ChannelName, GeneratedPack } from "./generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorialDimension {
  name: string;
  score: number;   // 0–20
  max: number;     // always 20
  signals: string[]; // what was detected (positive or negative)
}

export interface ChannelEditorialResult {
  channel: ChannelName;
  totalScore: number;   // 0–100
  grade: "A" | "B" | "C" | "D"; // ≥80 A, ≥65 B, ≥50 C, <50 D
  dimensions: {
    calmUrgency:      EditorialDimension;
    humanFirst:       EditorialDimension;
    indiaGrounded:    EditorialDimension;
    clinicallyHumble: EditorialDimension;
    practical:        EditorialDimension;
  };
}

export interface EditorialReport {
  packId: string;
  scoredAt: string;
  channels: Record<ChannelName, ChannelEditorialResult>;
  averageScore: number;
  overallGrade: "A" | "B" | "C" | "D";
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

/**
 * Calm urgency — encourages action without panic or fearbait.
 * Checks: calming hedges present, action present, fearbait absent.
 */
function scoreCalmUrgency(content: string): EditorialDimension {
  const lower = content.toLowerCase();
  const signals: string[] = [];
  let score = 10; // baseline

  const calmingPhrases = [
    "likely nothing serious",
    "may have other causes",
    "may not always",
    "isn't always",
    "aren't always",
    "don't always",
    "doesn't always",
    "not always",
    "these signs",
    "these symptoms",
  ];
  const calmFound = calmingPhrases.find((p) => lower.includes(p));
  if (calmFound) {
    score += 5;
    signals.push(`+ calming hedge: "${calmFound}"`);
  }

  const actionPhrases = [
    "consult",
    "see a doctor",
    "get checked",
    "visit a doctor",
    "speak to",
    "seek medical",
    "call a doctor",
    "dentist",
  ];
  const actionFound = actionPhrases.find((p) => lower.includes(p));
  if (actionFound) {
    score += 5;
    signals.push(`+ action guidance present`);
  }

  const fearbaitPhrases = [
    "silent killer",
    "deadly cancer",
    "will kill",
    "cancer kills",
    "shocking",
    "fatal",
    "you will die",
  ];
  const fearbaitFound = fearbaitPhrases.find((p) => lower.includes(p));
  if (fearbaitFound) {
    score = Math.max(0, score - 8);
    signals.push(`- fearbait: "${fearbaitFound}"`);
  }

  return { name: "Calm Urgency", score: Math.min(20, score), max: 20, signals };
}

/**
 * Human-first — opens with lived experience, not a disease definition.
 * Checks: question or personal scenario in opening, second person, concrete symptom.
 */
function scoreHumanFirst(content: string): EditorialDimension {
  const lower = content.toLowerCase();
  const signals: string[] = [];

  // Extract opening (first 150 chars)
  const opening = lower.slice(0, 150);
  let score = 0;

  // Question or personal scenario opener
  const humanOpeners = [
    "?",
    "ever ",
    "noticed ",
    "many people",
    "most people",
    "a lot of people",
    "imagine ",
    "think about",
    "have you",
    "did you know",
  ];
  const humanOpenerFound = humanOpeners.find((p) => opening.includes(p));
  if (humanOpenerFound) {
    score += 10;
    signals.push(`+ human opener detected`);
  } else {
    signals.push(`- opener reads like a definition`);
  }

  // Second person in opening
  if (opening.includes("you") || opening.includes("your")) {
    score += 5;
    signals.push(`+ second person in opener`);
  }

  // Concrete symptom named (not just "symptoms" generically)
  const concreteSymptoms = [
    "ulcer",
    "sore",
    "lump",
    "patch",
    "bleed",
    "swallow",
    "voice",
    "pain",
    "numb",
  ];
  const symptomFound = concreteSymptoms.find((p) => lower.includes(p));
  if (symptomFound) {
    score += 5;
    signals.push(`+ concrete symptom named`);
  }

  return { name: "Human-First", score: Math.min(20, score), max: 20, signals };
}

/**
 * India-grounded — local tobacco products, Bihar/Eastern India, PM-JAY.
 */
function scoreIndiaGrounded(content: string): EditorialDimension {
  const lower = content.toLowerCase();
  const signals: string[] = [];
  let score = 0;

  const tobaccoProducts = ["gutka", "paan masala", "khaini", "bidi", "paan"];
  const tobaccoFound = tobaccoProducts.find((p) => lower.includes(p));
  if (tobaccoFound) {
    score += 7;
    signals.push(`+ local tobacco product named: "${tobaccoFound}"`);
  }

  const localPlaces = ["bihar", "eastern india", "jharkhand", "odisha", "west bengal"];
  const placeFound = localPlaces.find((p) => lower.includes(p));
  if (placeFound) {
    score += 6;
    signals.push(`+ local geography: "${placeFound}"`);
  } else if (lower.includes("in india") || lower.includes("india")) {
    score += 3;
    signals.push(`+ India mentioned`);
  }

  const pmjayTerms = ["pm-jay", "pmjay", "ayushman", "ayushman bharat"];
  const pmjayFound = pmjayTerms.find((p) => lower.includes(p));
  if (pmjayFound) {
    score += 7;
    signals.push(`+ PM-JAY / Ayushman Bharat mentioned`);
  }

  return { name: "India-Grounded", score: Math.min(20, score), max: 20, signals };
}

/**
 * Clinically humble — acknowledges uncertainty, avoids implied diagnosis.
 */
function scoreClinicallyHumble(content: string): EditorialDimension {
  const lower = content.toLowerCase();
  const signals: string[] = [];
  let score = 8; // baseline: assume decent unless red flags

  const uncertaintyPhrases = [
    "may ",
    "could ",
    "often ",
    "sometimes",
    "not always",
    "may not",
    "can be",
    "possible",
    "in some cases",
    "may have other causes",
  ];
  const uncertaintyCount = uncertaintyPhrases.filter((p) =>
    lower.includes(p),
  ).length;
  if (uncertaintyCount >= 2) {
    score += 7;
    signals.push(`+ strong uncertainty language (${uncertaintyCount} instances)`);
  } else if (uncertaintyCount === 1) {
    score += 4;
    signals.push(`+ some uncertainty language`);
  } else {
    signals.push(`- no uncertainty language detected`);
  }

  const overclaims = [
    "cures cancer",
    "100% curable",
    "guaranteed",
    "will definitely",
    "always causes",
    "you have cancer",
    "confirms cancer",
  ];
  const overclaimFound = overclaims.find((p) => lower.includes(p));
  if (overclaimFound) {
    score = Math.max(0, score - 10);
    signals.push(`- overclaiming: "${overclaimFound}"`);
  } else {
    score += 5;
    signals.push(`+ no overclaiming detected`);
  }

  return { name: "Clinically Humble", score: Math.min(20, score), max: 20, signals };
}

/**
 * Practical — actionable, specific timeframes, cost/access guidance.
 */
function scorePractical(content: string): EditorialDimension {
  const lower = content.toLowerCase();
  const signals: string[] = [];
  let score = 5; // baseline

  // Specific timeframe with action
  const timeframePhrases = [
    "2–3 weeks",
    "2-3 weeks",
    "three weeks",
    "a few weeks",
    "more than 2",
    "more than two",
    "several weeks",
  ];
  const timeframeFound = timeframePhrases.find((p) => lower.includes(p));
  if (timeframeFound) {
    score += 7;
    signals.push(`+ specific timeframe given`);
  }

  // Cost / access guidance
  const accessPhrases = [
    "pm-jay",
    "pmjay",
    "ayushman",
    "free",
    "cost",
    "affordable",
    "covered",
    "hospital",
  ];
  const accessFound = accessPhrases.find((p) => lower.includes(p));
  if (accessFound) {
    score += 5;
    signals.push(`+ cost/access guidance present`);
  }

  // Concrete next step (not just generic "see a doctor")
  const specificActions = [
    "visit a doctor",
    "see a doctor or dentist",
    "consult a doctor",
    "speak to an oncologist",
    "get a check-up",
    "ask the hospital",
    "call",
  ];
  const specificFound = specificActions.find((p) => lower.includes(p));
  if (specificFound) {
    score += 3;
    signals.push(`+ specific action step`);
  }

  return { name: "Practical", score: Math.min(20, score), max: 20, signals };
}

// ---------------------------------------------------------------------------
// Grade helper
// ---------------------------------------------------------------------------

function toGrade(score: number): "A" | "B" | "C" | "D" {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function scoreEditorial(pack: GeneratedPack): EditorialReport {
  const scoredAt = new Date().toISOString();
  const channelOrder: ChannelName[] = [
    "linkedin",
    "twitter",
    "instagram",
    "whatsapp",
    "youtube_short",
  ];

  const channels = {} as Record<ChannelName, ChannelEditorialResult>;
  const scores: number[] = [];

  for (const channelName of channelOrder) {
    const result = pack.channels[channelName];

    if (!result || result.status === "failed") continue;

    const { content } = result;

    const calmUrgency      = scoreCalmUrgency(content);
    const humanFirst       = scoreHumanFirst(content);
    const indiaGrounded    = scoreIndiaGrounded(content);
    const clinicallyHumble = scoreClinicallyHumble(content);
    const practical        = scorePractical(content);

    const totalScore =
      calmUrgency.score +
      humanFirst.score +
      indiaGrounded.score +
      clinicallyHumble.score +
      practical.score;

    scores.push(totalScore);

    channels[channelName] = {
      channel: channelName,
      totalScore,
      grade: toGrade(totalScore),
      dimensions: { calmUrgency, humanFirst, indiaGrounded, clinicallyHumble, practical },
    };
  }

  const averageScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

  return {
    packId: pack.articleSlug,
    scoredAt,
    channels,
    averageScore,
    overallGrade: toGrade(averageScore),
  };
}
