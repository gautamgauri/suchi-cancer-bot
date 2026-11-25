/**
 * Editorial score for a social post, out of 100. The gate is 75.
 *
 * This replaces the scorer in distribution/editorial-scorer.ts, which gave
 * points for a question in the opening line, for "Did you know", for naming
 * Bihar or tobacco products and for timeframe phrases such as "2-3 weeks".
 *
 * Points are earned, so a draft unrelated to its brief cannot reach the gate.
 *   Plainness (30)       short, uneven sentences, everyday words, no jargon or sales talk
 *   Fit to the brief (35) share of the draft's content words found in the brief's
 *                         facts, less penalties for unsourced numbers, links,
 *                         clinical words and sentences off the brief
 *   Use to a family (25)  a concrete detail, something they can do, a way to act
 *   Calm (10)            no fear, no hype, no exclamation marks
 *
 * The score measures word overlap and surface habits. It does not show that a
 * post is true or good, so it is kept in the record and not shown to the owner
 * as a mark of quality.
 */
import { ContentBrief, Platform } from "../social.types";
import { checkSources, factCoverage } from "./source-check";
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
  "outcomes", "interventions", "beneficiaries", "continuum", "touchpoint", "actionable", "empanelment",
];

const ACTION_VERBS = /\b(call|write|bring|keep|ask|check|open|watch|message|read|look|take|note|carry|put|search|find|apply|log in|give|show|book|enrol|use|share|add)\b/i;
const FEAR = /\b(deadly|killer|scary|terrifying|shocking|alarming|devastating|horrifying|dangerous)\b/i;

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

  // Plainness
  let plainness = 30;
  const ss = sentences(text);
  const lengths = ss.map((s) => s.split(/\s+/).filter(Boolean).length);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  if (avg > 22) { plainness -= 15; notes.push(`sentences average ${avg.toFixed(0)} words`); }
  else if (avg > 18) { plainness -= 8; notes.push(`sentences average ${avg.toFixed(0)} words`); }
  const words = body.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const longShare = words.length ? words.filter((w) => syllables(w) >= 4).length / words.length : 0;
  if (longShare > 0.12) { plainness -= 8; notes.push("many long words"); }
  else if (longShare > 0.08) { plainness -= 4; notes.push("some long words"); }
  for (const j of JARGON) {
    if (new RegExp(`\\b${j}\\b`, "i").test(body)) { plainness -= 4; notes.push(`jargon "${j}"`); }
  }
  for (const m of MARKETING_WORDS) {
    if (new RegExp(`\\b${m}\\b`, "i").test(body)) { plainness -= 15; notes.push(`sales word "${m}"`); }
  }
  if (lengths.length >= 4 && stdev(lengths) < 2.5) { plainness -= 5; notes.push("sentences all the same length"); }
  plainness = Math.max(0, plainness);

  // Fit to the brief, earned from overlap with the facts
  const coverage = factCoverage(`${text}\n${cardText ?? ""}`, brief);
  let sourceAccuracy = Math.round(35 * Math.min(1, coverage / 0.5));
  if (coverage < 0.5) notes.push(`only ${Math.round(coverage * 100)}% of its words come from the facts`);
  for (const v of checkSources(platform, text, brief, cardText)) {
    if (v.code === "unsourced_number" || v.code === "unknown_link") sourceAccuracy -= 15;
    else if (v.code === "off_brief") sourceAccuracy -= 30;
    else if (v.code === "clinical_term" || v.code === "clinical_instruction") sourceAccuracy -= 10;
    else continue;
    notes.push(v.reason);
  }
  sourceAccuracy = Math.max(0, sourceAccuracy);

  // Use to a family
  let familyUse = 0;
  const concrete = /\d/.test(body) || /\b(helpline|website|contact page|folder|notebook|paper|sheet|list|phone|card|aadhaar|ration card|portal|app|form|certificate)\b/i.test(body);
  if (concrete) familyUse += 10; else notes.push("no concrete detail");
  if (ACTION_VERBS.test(body)) familyUse += 10; else notes.push("nothing the reader can do");
  const hasWay = platform === "instagram"
    ? /\b(profile|website|helpline|call|\d{5,})\b/i.test(text) || /suchitracancercare\.org|\.gov\.in/i.test(text)
    : /https?:\/\/\S*src(=|%3A)/i.test(text);
  if (hasWay) familyUse += 5; else notes.push("no way to act");

  // Calm
  let calm = 10;
  if (body.includes("!")) { calm -= 5; notes.push("exclamation mark"); }
  if (FEAR.test(body)) { calm -= 5; notes.push("fear language"); }
  calm = Math.max(0, calm);

  return { total: plainness + sourceAccuracy + familyUse + calm, plainness, sourceAccuracy, familyUse, calm, notes };
}
