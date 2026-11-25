/**
 * Editorial score for a social post, out of 100. The gate is 75.
 *
 * This replaces the scorer in distribution/editorial-scorer.ts, which gave
 * points for a question in the opening line, for "Did you know", for naming
 * Bihar or tobacco products and for timeframe phrases such as "2-3 weeks".
 * Those rewarded the habits the owner has banned and pushed clinical claims
 * into every post. Nothing in it checked the post against its source.
 *
 * Here the points go to what helps a family.
 *   Plainness (35)      short, uneven sentences, everyday words, no jargon or sales talk
 *   Source accuracy (30) every number, link and clinical word is in the sources
 *   Use to a family (25) a concrete detail, something they can do, one next step
 *   Calm (10)           no fear, no hype, no exclamation marks
 * Polish earns nothing. A hard rule broken in voice-lint or source-check fails
 * the draft whatever the score.
 */
import { ContentBrief, Platform } from "../social.types";
import { checkSources, factOverlap } from "./source-check";
import { MARKETING_WORDS } from "./voice-lint";

export const EDITORIAL_GATE = 75;

export interface EditorialScore {
  total: number;
  plainness: number;
  sourceAccuracy: number;
  familyUse: number;
  calm: number;
  notes: string[];
}

const URL_RE = /https?:\/\/\S+/g;

export const JARGON = [
  "tertiary", "modality", "modalities", "multidisciplinary", "paradigm", "stakeholders", "ecosystem",
  "utilise", "utilize", "facilitate", "optimise", "optimize", "robust", "landscape", "holistic",
  "outcomes", "interventions", "beneficiaries", "continuum", "touchpoint", "actionable",
];

const ACTION_VERBS = /\b(call|write|bring|keep|ask|check|open|watch|message|read|look|take|note|carry|put|search|find)\b/i;
const FEAR = /\b(deadly|killer|scary|terrifying|shocking|alarming|devastating|horrifying)\b/i;

function sentences(text: string): string[] {
  return text
    .replace(URL_RE, " ")
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]/i.test(s) && !/^#/.test(s));
}

function syllables(word: string): number {
  const groups = word.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

export function scoreEditorial(platform: Platform, text: string, brief: ContentBrief, cardText?: string): EditorialScore {
  const notes: string[] = [];
  const body = text.replace(URL_RE, " ");
  const low = body.toLowerCase();

  // Plainness
  let plainness = 35;
  const ss = sentences(text);
  const lengths = ss.map((s) => s.split(/\s+/).filter(Boolean).length);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  if (avg > 22) { plainness -= 15; notes.push(`sentences average ${avg.toFixed(0)} words`); }
  else if (avg > 18) { plainness -= 8; notes.push(`sentences average ${avg.toFixed(0)} words`); }
  const words = body.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const long = words.filter((w) => syllables(w) >= 4).length;
  const longShare = words.length ? long / words.length : 0;
  if (longShare > 0.12) { plainness -= 8; notes.push("many long words"); }
  else if (longShare > 0.08) { plainness -= 4; notes.push("some long words"); }
  for (const j of JARGON) {
    if (new RegExp(`\\b${j}\\b`, "i").test(body)) { plainness -= 4; notes.push(`jargon "${j}"`); }
  }
  for (const m of MARKETING_WORDS) {
    if (new RegExp(`\\b${m}\\b`, "i").test(body)) { plainness -= 6; notes.push(`sales word "${m}"`); }
  }
  if (lengths.length >= 4 && stdev(lengths) < 2.5) { plainness -= 5; notes.push("sentences all the same length"); }
  plainness = Math.max(0, plainness);

  // Source accuracy
  let sourceAccuracy = 30;
  for (const v of checkSources(platform, text, brief, cardText)) {
    if (v.code === "unsourced_number" || v.code === "unknown_link") sourceAccuracy -= 15;
    else if (v.code === "clinical_term") sourceAccuracy -= 10;
    else continue;
    notes.push(v.reason);
  }
  if (factOverlap(text, brief) < 2) { sourceAccuracy -= 10; notes.push("says little that is in the sources"); }
  sourceAccuracy = Math.max(0, sourceAccuracy);

  // Use to a family
  let familyUse = 0;
  const concrete = /\d/.test(body) || /\b(helpline|website|contact page|folder|notebook|phone|youtube|whatsapp|episode|video|directory)\b/i.test(body);
  if (concrete) familyUse += 10; else notes.push("no concrete detail");
  if (ACTION_VERBS.test(body)) familyUse += 10; else notes.push("nothing the reader can do");
  const hasNext = platform === "instagram" ? /in our profile/i.test(text) : /https?:\/\/\S*src(=|%3A)/i.test(text);
  if (hasNext) familyUse += 5; else notes.push("no next step");

  // Calm
  let calm = 10;
  if (body.includes("!")) { calm -= 5; notes.push("exclamation mark"); }
  if (FEAR.test(low)) { calm -= 5; notes.push("fear language"); }
  calm = Math.max(0, calm);

  return { total: plainness + sourceAccuracy + familyUse + calm, plainness, sourceAccuracy, familyUse, calm, notes };
}
