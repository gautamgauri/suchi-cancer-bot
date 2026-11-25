/**
 * Accuracy against the source. A post may state only what its brief's facts
 * state. These checks are mechanical and strict on purpose: a number, link or
 * clinical word that the sources do not contain is a hard failure.
 */
import { ContentBrief, Platform } from "../social.types";
import { carriesPlatformCode, INSTAGRAM_PROFILE_PHRASE } from "../links";
import { VoiceViolation } from "./voice-lint";

const URL_RE = /https?:\/\/[^\s)]+/g;

/**
 * Words that make a sentence clinical. In the practical and Onco Talks lanes
 * they may appear only when the source itself uses them (a video title, a
 * fact from an official page). Multi-word entries are matched as phrases.
 */
export const CLINICAL_TERMS = [
  "symptom", "symptoms", "sign of", "signs of", "warning sign", "warning signs", "lump", "lumps",
  "bleeding", "pain", "cough", "ulcer", "sore", "fever", "weight loss", "screening", "screened",
  "chemotherapy", "chemo", "radiotherapy", "radiation", "surgery", "operation", "dose", "dosage",
  "drug", "drugs", "medicine", "medicines", "medication", "tablets", "side effect", "side effects",
  "diet", "prevent", "prevention", "diagnose", "diagnosed", "diagnosis", "prognosis", "survival",
  "stage", "tumour", "tumor", "biopsy", "mammogram", "transplant", "transplants", "immunotherapy",
  "risk", "early detection", "treatable", "remission", "relapse", "metastasis", "spread",
  "oncology", "precision oncology", "stem cell", "bone marrow",
];

function normaliseNumber(n: string): string {
  return n.replace(/,/g, "");
}

function numbersIn(text: string): string[] {
  return (text.replace(URL_RE, " ").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(normaliseNumber);
}

function sourceCorpus(brief: ContentBrief): string {
  return [brief.title, ...brief.facts.map((f) => f.text), ...(brief.allowedTerms ?? [])].join("\n").toLowerCase();
}

function stripTrailingSlash(u: string): string {
  return u.replace(/[.,]$/, "").replace(/\/$/, "");
}

export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,]$/, ""));
}

export function checkSources(platform: Platform, text: string, brief: ContentBrief, cardText?: string): VoiceViolation[] {
  const hits: VoiceViolation[] = [];
  const corpus = sourceCorpus(brief);
  const corpusNumbers = new Set(numbersIn(corpus));

  for (const n of numbersIn(`${text}\n${cardText ?? ""}`)) {
    if (!corpusNumbers.has(n)) hits.push({ code: "unsourced_number", reason: `the number ${n} is not in the sources` });
  }

  const allowedSourceUrls = new Set(brief.facts.map((f) => stripTrailingSlash(f.url)));
  const urls = urlsIn(text);
  const cta = urls.filter((u) => carriesPlatformCode(u, platform));
  for (const u of urls) {
    if (carriesPlatformCode(u, platform)) continue;
    if (!allowedSourceUrls.has(stripTrailingSlash(u))) {
      hits.push({ code: "unknown_link", reason: `link not from the sources and without this platform's code`, excerpt: u.slice(0, 100) });
    }
  }

  if (platform === "instagram") {
    if (urls.length > 0) hits.push({ code: "instagram_link", reason: "Instagram captions cannot hold a working link. Point to the profile link." });
    if (!INSTAGRAM_PROFILE_PHRASE.test(text)) hits.push({ code: "next_step_missing", reason: 'end with the next step, "the link is in our profile"' });
  } else {
    if (cta.length !== 1) {
      hits.push({ code: "next_step_missing", reason: `exactly one next-step link with the ${platform} source code is needed, found ${cta.length}` });
    } else if (urls[urls.length - 1] !== cta[0]) {
      hits.push({ code: "next_step_position", reason: "the next-step link comes last" });
    }
  }

  if (brief.lane !== "clinical") {
    const lowText = ` ${`${text}\n${cardText ?? ""}`.replace(URL_RE, " ").toLowerCase()} `;
    for (const term of CLINICAL_TERMS) {
      const rx = new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`);
      if (rx.test(lowText) && !rx.test(corpus)) {
        hits.push({ code: "clinical_term", reason: `"${term}" is clinical and is not in the sources for this post` });
      }
    }
  }
  return hits;
}

/** How many content words of the text appear in at least one fact. */
export function factOverlap(text: string, brief: ContentBrief): number {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "can", "have", "will", "our", "who", "what", "when", "they", "their", "them", "was", "been", "into", "about", "also", "more", "some", "each", "there"]);
  const words = (s: string) => new Set(s.toLowerCase().replace(URL_RE, " ").match(/[a-z][a-z-]{2,}/g)?.filter((w) => !stop.has(w)) ?? []);
  const t = words(text);
  const f = words(brief.facts.map((x) => x.text).join(" ") + " " + brief.title);
  let n = 0;
  for (const w of t) if (f.has(w)) n++;
  return n;
}
