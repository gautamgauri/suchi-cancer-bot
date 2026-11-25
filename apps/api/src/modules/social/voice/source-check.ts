/**
 * A mechanical comparison of a draft with its brief. It is a filter for
 * obvious faults. It does not check facts.
 *
 * What it does:
 * - every number in the draft, in digits or in words, must appear in the
 *   brief's fact strings or title;
 * - every link, whether `https://`, `www.` or a bare domain such as
 *   `nha.gov.in`, must be one of the brief's source URLs or hosts, or the
 *   post's own next-step link;
 * - in the practical and Onco Talks lanes, a clinical word or drug name
 *   (in any of its plural or inflected forms) may appear only if the brief's
 *   facts use it, and an instruction about medicines, treatment or food is
 *   refused outright;
 * - in those lanes, every sentence must share content words with at least
 *   one fact, so a sentence about something else fails;
 * - the next step is a single link carrying the platform's source code.
 *
 * What it cannot do: it compares strings. A sentence that reuses the facts'
 * words to say something they do not say will pass. The brief's facts are
 * themselves written by a person from the source pages. The owner's reading
 * of the post against its source links, which the approval email and review
 * page show beside each post, is the real check.
 */
import { ContentBrief, Platform } from "../social.types";
import { carriesPlatformCode } from "../links";
import { VoiceViolation } from "./voice-lint";

const URL_RE = /https?:\/\/[^\s)]+/g;
/** `www.example.org/x` or `example.gov.in/x`, not part of an e-mail address or a full URL. */
const BARE_DOMAIN_RE = /(?<![@/\w.-])(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|in|gov|edu|io|co|info|me|ly|app|health)(?:\/[^\s)]*)?(?![\w-])/gi;

/**
 * Clinical words and drug names. In the safe lanes each may appear only when
 * the facts use it. Matched with plural and inflected endings.
 */
export const CLINICAL_TERMS = [
  "symptom", "sign of", "signs of", "warning sign", "lump", "bleed", "bleeding", "pain", "cough",
  "ulcer", "sore", "fever", "weight loss", "screen", "screening", "chemotherapy", "chemo",
  "radiotherapy", "radiation", "surgery", "surgeon", "operation", "dose", "dosage", "drug",
  "medicine", "medication", "tablet", "pill", "injection", "side effect", "diet", "food", "eat",
  "prevent", "prevention", "diagnose", "diagnosis", "prognosis", "survival", "stage", "tumour",
  "tumor", "biopsy", "mammogram", "transplant", "immunotherapy", "risk", "early detection",
  "treatable", "remission", "relapse", "metastasis", "spread", "oncology", "stem cell",
  "bone marrow", "treatment", "therapy", "tobacco", "smoking", "alcohol", "test", "scan",
  "x-ray", "mri", "pet", "ct", "blood test", "vaccine", "vaccination", "hpv", "gene", "genetic",
  "mutation", "cure", "infection", "steroid", "painkiller", "antibiotic", "ayurveda", "ayurvedic",
  "homeopathy", "herbal", "supplement", "vitamin", "turmeric", "exercise", "yoga",
  // Drug names seen in the site's video titles and common in Indian oncology.
  "tamoxifen", "letrozole", "anastrozole", "trastuzumab", "herceptin", "cisplatin", "carboplatin",
  "paclitaxel", "docetaxel", "doxorubicin", "cyclophosphamide", "capecitabine", "imatinib",
  "pembrolizumab", "nivolumab", "atezolizumab", "durvalumab", "tislelizumab", "toripalimab",
  "osimertinib", "gefitinib", "erlotinib", "rituximab", "bevacizumab", "darolutamide",
  "enzalutamide", "abiraterone", "morphine", "tramadol", "paracetamol", "ondansetron",
];

/** Instructions about medicines, treatment or food. Clinical whatever the facts say. */
const CLINICAL_INSTRUCTION = /\b(don'?t|do not|never|stop|avoid|start|skip|quit|reduce|increase|double|halve|change|switch)\b[^.?!\n]{0,40}\b(medicines?|medications?|tablets?|pills?|drugs?|doses?|chemo\w*|treatments?|therapy|radiation|radiotherapy|surgery|injections?|diet|food|eating)\b/i;

const NUMBER_WORDS: Record<string, string> = {
  // "one" is left out: it is far more often a pronoun ("one person") than a count.
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
  seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40",
  fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100",
  thousand: "1000", lakh: "lakh", lakhs: "lakh", crore: "crore", crores: "crore", million: "million",
  billion: "billion", dozen: "12", half: "half", twice: "2", double: "2", triple: "3", percent: "percent",
};

export const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "your", "you", "are", "can", "have", "will",
  "our", "who", "what", "when", "they", "their", "them", "was", "been", "into", "about", "also", "more",
  "some", "each", "there", "here", "which", "where", "while", "than", "then", "just", "only", "very",
  "much", "many", "most", "other", "such", "these", "those", "does", "did", "done", "may", "might",
  "could", "would", "should", "must", "one", "any", "all", "not", "but", "its", "it's", "it", "has",
  "had", "how", "why", "out", "over", "under", "again", "same", "own", "too", "both", "few", "she",
  "his", "her", "him", "him", "were", "being", "because", "before", "after", "once", "even", "still",
  "ask", "help", "need", "needs", "make", "made", "take", "get", "gets", "give", "gives", "say", "says",
  "know", "keep", "come", "goes", "going", "people", "person", "family", "families", "someone",
  "anyone", "everyone", "thing", "things", "time", "day", "days", "way", "well", "good", "new", "first",
  "next", "last", "suchi", "sccf", "there's", "that's", "don't", "doesn't", "isn't", "aren't", "let",
]);

/** Crude stem: enough to match "questions" with "question" and "checked" with "check". */
export function stem(w: string): string {
  let s = w.toLowerCase().replace(/'s$/, "");
  for (const suf of ["ations", "ation", "ings", "ing", "ies", "ied", "es", "ed", "s"]) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      if (suf === "ies" || suf === "ied") s += "y";
      break;
    }
  }
  return s;
}

export function contentStems(text: string): Set<string> {
  const words = text.toLowerCase().replace(URL_RE, " ").match(/[a-z][a-z'-]{2,}/g) ?? [];
  return new Set(words.filter((w) => !STOP.has(w)).map(stem).filter((w) => w.length >= 3));
}

function normaliseNumber(n: string): string {
  return n.replace(/,/g, "");
}

/** Numbers in digits and in words, normalised so "five" and "5" compare equal. */
export function numbersIn(text: string): string[] {
  const t = text.replace(URL_RE, " ").replace(BARE_DOMAIN_RE, " ");
  const digits = (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(normaliseNumber);
  const words = (t.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w in NUMBER_WORDS).map((w) => NUMBER_WORDS[w]);
  return [...digits, ...words];
}

function sourceCorpus(brief: ContentBrief): string {
  return [brief.title, ...brief.facts.map((f) => f.text), ...(brief.allowedTerms ?? [])].join("\n").toLowerCase();
}

function stripTrailing(u: string): string {
  return u.replace(/[.,;:]+$/, "").replace(/\/$/, "");
}

function hostOf(u: string): string {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function urlsIn(text: string): string[] {
  return (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,]$/, ""));
}

export function bareDomainsIn(text: string): string[] {
  return (text.replace(URL_RE, " ").match(BARE_DOMAIN_RE) ?? []).map(stripTrailing);
}

function termRegex(term: string): RegExp {
  const body = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`\\b${body}(?:s|es|ed|d|ing|al|ic|ies)?\\b`, "i");
}

export function sentencesOf(text: string): string[] {
  return text
    .replace(URL_RE, " ")
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z]{3}/i.test(s) && !/^#/.test(s) && !LABEL_LINE.test(s));
}

/** "Source:" or "Report:" before a link is a label, not a sentence. */
export const LABEL_LINE = /^(source|sources|report)\b:?\s*$|^(source|sources|report):/i;

export function checkSources(platform: Platform, text: string, brief: ContentBrief, cardText?: string): VoiceViolation[] {
  const hits: VoiceViolation[] = [];
  const corpus = sourceCorpus(brief);
  const corpusNumbers = new Set(numbersIn(corpus));
  const all = `${text}\n${cardText ?? ""}`;

  for (const n of numbersIn(all)) {
    if (!corpusNumbers.has(n)) hits.push({ code: "unsourced_number", reason: `the number "${n}" is not in the sources` });
  }

  const sourceUrls = new Set(brief.facts.map((f) => stripTrailing(f.url)));
  const sourceHosts = new Set(brief.facts.map((f) => hostOf(f.url)));
  const urls = urlsIn(text);
  const cta = urls.filter((u) => carriesPlatformCode(u, platform));
  for (const u of urls) {
    if (carriesPlatformCode(u, platform)) continue;
    if (!sourceUrls.has(stripTrailing(u))) {
      hits.push({ code: "unknown_link", reason: "link not from the sources and without this platform's code", excerpt: u.slice(0, 100) });
    }
  }
  for (const d of bareDomainsIn(all)) {
    const h = hostOf(d);
    // Allowed: a source's host or a subdomain of it, an address the facts
    // themselves name, or the site's own addresses.
    const known = [...sourceHosts].some((s) => h === s || h.endsWith(`.${s}`))
      || corpus.includes(d.toLowerCase().replace(/^www\./, ""))
      || h === "suchitracancercare.org" || h === "chat.suchitracancercare.org";
    if (h && !known) {
      hits.push({ code: "unknown_link", reason: "web address not from the sources", excerpt: d.slice(0, 100) });
    }
  }

  if (platform === "instagram") {
    if (urls.length > 0) hits.push({ code: "instagram_link", reason: "Instagram captions cannot hold a working link" });
  } else if (cta.length !== 1) {
    hits.push({ code: "next_step_missing", reason: `exactly one next-step link with the ${platform} source code is needed, found ${cta.length}` });
  } else if (urls[urls.length - 1] !== cta[0]) {
    hits.push({ code: "next_step_position", reason: "the next-step link comes last" });
  }

  if (brief.lane !== "clinical") {
    const lowText = all.replace(URL_RE, " ").toLowerCase();
    for (const term of CLINICAL_TERMS) {
      const rx = termRegex(term);
      if (rx.test(lowText) && !rx.test(corpus)) {
        hits.push({ code: "clinical_term", reason: `"${term}" is clinical and is not in the sources for this post` });
      }
    }
    if (CLINICAL_INSTRUCTION.test(all.replace(URL_RE, " "))) {
      hits.push({ code: "clinical_instruction", reason: "an instruction about medicines, treatment or food is clinical and needs a clinician" });
    }

    const factStems = brief.facts.map((f) => contentStems(`${f.text} ${brief.title}`));
    for (const s of [...sentencesOf(text), ...(cardText ? sentencesOf(cardText) : [])]) {
      const own = contentStems(s);
      if (own.size === 0) continue;
      const best = Math.max(0, ...factStems.map((fs) => [...own].filter((w) => fs.has(w)).length));
      const needed = own.size >= 4 ? 2 : 1;
      if (best < needed) {
        hits.push({ code: "off_brief", reason: "this sentence shares too little with any fact in the brief", excerpt: s.slice(0, 120) });
      }
    }
  }
  return hits;
}

/** The best share of a text's content words found in one fact, 0 to 1. */
export function factCoverage(text: string, brief: ContentBrief): number {
  const own = contentStems(text);
  if (own.size === 0) return 0;
  const all = contentStems(brief.facts.map((f) => f.text).join(" ") + " " + brief.title);
  return [...own].filter((w) => all.has(w)).length / own.size;
}
