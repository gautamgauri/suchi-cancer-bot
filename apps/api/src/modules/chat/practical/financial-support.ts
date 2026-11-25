/**
 * Verified facts about paying for cancer treatment in India, and the
 * deterministic replies built from them (issue #260).
 *
 * The facts live in `apps/api/data/financial-support.json`, made from the
 * verified reference `docs/support/financial-support-reference-2026-11.json`.
 * Each fact keeps its source page, its checked-on date and the reference text
 * it rests on. A reply states fact sentences word for word, with fixed framing
 * lines that carry no facts of their own. No other scheme claim is made.
 *
 * Replies are in English. The Hindi versions of the new lines are listed in
 * the PR for a later, reviewed translation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PayTopic, PmjayAspect } from "./practical-router";

export interface VerifiedFact {
  id?: string;
  text: string;
  url: string;
  checked_on: string;
  reference_quote: string;
}

export interface VerifiedTopic {
  name: string;
  official_page: string;
  helpline: string | null;
  facts: VerifiedFact[];
  not_confirmed?: string;
}

export interface VerifiedState {
  state: string;
  url: string;
  helpline: string | null;
  checked_on: string;
  facts: VerifiedFact[];
}

export interface FinancialSupportFile {
  checked_on: string;
  checked_on_text: string;
  national_helpline: { name: string; number: string; url: string; official_site: string };
  topics: Record<PayTopic, VerifiedTopic>;
  states: VerifiedState[];
  states_not_confirmed: string[];
}

/** `apps/api/data` from both `src/modules/chat/practical` and `dist/modules/chat/practical`. */
export const FINANCIAL_SUPPORT_PATH = path.resolve(__dirname, "../../../../data/financial-support.json");

let cached: FinancialSupportFile | null = null;

/** The verified file, read once. Throws if it is missing or malformed. */
export function loadFinancialSupport(): FinancialSupportFile {
  if (cached) return cached;
  const parsed = JSON.parse(fs.readFileSync(FINANCIAL_SUPPORT_PATH, "utf8")) as FinancialSupportFile;
  if (!parsed?.topics?.pmjay?.facts?.length || !Array.isArray(parsed.states)) {
    throw new Error(`${FINANCIAL_SUPPORT_PATH}: not a financial support file`);
  }
  cached = parsed;
  return parsed;
}

function fact(topic: VerifiedTopic, id: string): VerifiedFact {
  const f = topic.facts.find((x) => x.id === id);
  if (!f) throw new Error(`financial-support.json: no fact "${id}"`);
  return f;
}

// ─── Fixed lines (no facts of their own) ─────────────────────────────────

export const PAY_OPENING = "Here is what Suchi has on record, with the page each part comes from.";

/** The closing line. It carries the checked-on date from the file. */
export function payClosing(checkedOn: string, mentionsAyushman: boolean): string {
  return mentionsAyushman
    ? `Checked on ${checkedOn}. Rules change, so please confirm with the helpline or at the Ayushman desk of the hospital before you rely on this.`
    : `Checked on ${checkedOn}. Rules change, so please confirm with the official page or helpline before you rely on this.`;
}

export function stateNotCovered(state: string): string {
  return `Suchi does not yet have confirmed information about a state scheme in ${state}. Here is the national scheme.`;
}

/**
 * The one fixed reply for a practical question that verified material cannot
 * answer. It points to the official PM-JAY helpline and site from the file.
 */
export function practicalUnknownReply(): string {
  const file = loadFinancialSupport();
  const h = file.national_helpline;
  return (
    "Suchi does not have confirmed information on that yet.\n\n" +
    `For questions about paying for treatment, you can call the official ${h.name} helpline on ${h.number} (toll-free). ` +
    `The official website is ${h.official_site}`
  );
}

// ─── The financial answer ────────────────────────────────────────────────

function topicSection(topic: VerifiedTopic, facts: VerifiedFact[], showNotConfirmed: boolean): string[] {
  const lines = [`**${topic.name}**`, ...facts.map((f) => `- ${f.text}`)];
  lines.push(`Source page: ${topic.official_page}`);
  if (topic.helpline) lines.push(`Helpline: ${topic.helpline}`);
  if (showNotConfirmed && topic.not_confirmed) lines.push(topic.not_confirmed);
  return lines;
}

/** PM-JAY facts for a question, by what it asks about. Short by design. */
function pmjayFacts(topic: VerifiedTopic, aspects: PmjayAspect[], brief: boolean): VerifiedFact[] {
  const ids = ["pmjay_cover", "pmjay_oncology"];
  if (!brief) {
    if (aspects.includes("eligibility") || aspects.includes("no_card")) ids.push("pmjay_who", "pmjay_criteria", "pmjay_no_limits");
    if (aspects.includes("amount")) ids.push("pmjay_package_includes");
    if (aspects.includes("card") || aspects.includes("no_card")) ids.push("pmjay_card_app");
    if (aspects.includes("documents") || aspects.includes("card")) ids.push("pmjay_documents");
    if (aspects.includes("hospital")) ids.push("pmjay_find_hospital");
  }
  ids.push("pmjay_check", "pmjay_helpline");
  if (!brief) ids.push("pmjay_official_site");
  return [...new Set(ids)].map((id) => fact(topic, id));
}

export interface FinancialAnswerRequest {
  topics: PayTopic[];
  pmjayAspects: PmjayAspect[];
  state: string | null;
}

/**
 * Build the reply to a question about paying for treatment. Deterministic:
 * the same request always gives the same text, and every bullet is a fact
 * sentence from the verified file.
 */
export function buildFinancialAnswer(req: FinancialAnswerRequest): string {
  const file = loadFinancialSupport();
  const sections: string[][] = [];
  const topics = [...req.topics];

  // A state named with no national topic: the state's scheme, then PM-JAY.
  const stateEntry = req.state ? file.states.find((s) => s.state === req.state) ?? null : null;
  const stateUncovered = req.state !== null && stateEntry === null;
  if (req.state && !topics.includes("pmjay") && !topics.includes("senior")) topics.push("pmjay");

  if (stateEntry) {
    const lines = [`**${stateEntry.state}**`, ...stateEntry.facts.map((f) => `- ${f.text}`), `Source page: ${stateEntry.url}`];
    if (stateEntry.helpline) lines.push(`Helpline: ${stateEntry.helpline}`);
    sections.push(lines);
  } else if (stateUncovered) {
    sections.push([stateNotCovered(req.state!)]);
  }

  for (const t of topics) {
    const topic = file.topics[t];
    if (t === "pmjay") {
      const brief = req.state !== null || topics.length > 1;
      sections.push(topicSection(topic, pmjayFacts(topic, req.pmjayAspects, brief), false));
    } else {
      sections.push(topicSection(topic, topic.facts, true));
    }
  }

  const mentionsAyushman = topics.includes("pmjay") || topics.includes("senior") || req.state !== null;
  return [PAY_OPENING, ...sections.map((s) => s.join("\n")), payClosing(file.checked_on_text, mentionsAyushman)].join("\n\n");
}

/** The PM-JAY lines a hospital answer ends with: how to find an empanelled hospital. */
export function pmjayFinderLines(): string[] {
  const topic = loadFinancialSupport().topics.pmjay;
  return [fact(topic, "pmjay_find_hospital").text, fact(topic, "pmjay_helpline").text];
}
