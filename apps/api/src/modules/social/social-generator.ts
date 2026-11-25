/**
 * Writes one platform's post from a brief, then runs it through the gate.
 * A draft that fails is regenerated with the reasons, at most MAX_ATTEMPTS
 * times in all. If it still fails it is held for the owner and never offered.
 */
import { ContentBrief, Platform } from "./social.types";
import { gateDraft, describeViolations, GateResult } from "./voice/draft-gate";
import { CARD_TEXT_MAX, LIMITS } from "./voice/voice-lint";
import { siteLink, webChatLink, whatsappLink } from "./links";

export const MAX_ATTEMPTS = 3;

export interface Llm {
  generateRaw(systemPrompt: string, userPrompt: string, maxTokens?: number): Promise<string>;
}

export interface GeneratedDraft {
  text: string;
  gate: GateResult;
  attempts: number;
}

/** The link the post must end with, for this platform and brief. */
export function nextStepLink(platform: Platform, brief: ContentBrief): string | null {
  if (platform === "instagram") return null;
  if (brief.nextStep === "site" && brief.sitePath) return siteLink(brief.sitePath, platform);
  if (brief.nextStep === "whatsapp" && platform === "facebook") return whatsappLink(platform);
  return webChatLink(platform);
}

const PLATFORM_GUIDE: Record<Platform, string> = {
  linkedin:
    "LinkedIn. Readers are hospital staff, social workers, health workers, funders and peers. Write 60 to 160 words in two to four short paragraphs. Speak to them as colleagues who can pass the information on to families. No emoji. No hashtags.",
  facebook:
    "Facebook. Readers are families and older relatives, many reading on a phone. Write 50 to 120 words in short paragraphs, in the simplest words that are still exact. Speak to the family directly. No hashtags are needed.",
  instagram:
    "Instagram caption, read under a card image. Write 30 to 80 words. End the caption with a sentence saying the link is in our profile, then at most two relevant hashtags on the last line. Do not put any web address in the caption.",
  x:
    "X. One or two plain sentences, then the link on its own line. The whole post must fit in 280 characters, counting the link as 23. No hashtags.",
};

export const VOICE_RULES = `You write for Suchitra Cancer Care Foundation (SCCF), a small non-profit in India that runs Suchi, a cancer information service for patients and caregivers across India. Write like a calm, knowledgeable person at a small Indian non-profit talking to a family. Plain British English.

Hard rules. A post that breaks any of them is thrown away.
- No em dashes and no en dashes. Write ranges with "to". Use a plain hyphen only inside compound words.
- No semicolons. No colon used to reveal a point.
- No "X rather than Y", "X, not Y", "not only X but Y", "not just".
- No groups of three for rhythm, no run of sentences built the same way, no neat closing line.
- Never use these words: deliberately, genuinely, meaningful, precisely, fundamentally, journey, "at the intersection of", "goes beyond", "worth noting".
- Do not open with a question. No "Did you know". No "Here's what you need to know". No exclamation marks.
- No lists with bullets, dashes or numbers. Write sentences.
- No engagement bait (like, share, tag, comment below, follow for more).
- No fear and no promises of outcomes. Never use cure, guarantee, miracle.
- Never say or imply that the reader has cancer. Say "people with cancer" and "caregivers". Do not use victim, battle, fight or survivor.
- No marketing words such as empower, transform, holistic, seamless, unlock, world-class.
- Use only the facts given below. Do not add any number, name, claim or advice that is not in them. Do not add anything medical.
- Sentences short and of uneven length. Concrete detail.`;

export function buildPrompt(platform: Platform, brief: ContentBrief, previous?: { text: string; reasons: string[] }): string {
  const link = nextStepLink(platform, brief);
  const facts = brief.facts.map((f, i) => `${i + 1}. ${f.text} (source: ${f.url})`).join("\n");
  const lines = [
    `Topic: ${brief.title}`,
    `What the post is for: ${brief.angle}`,
    "",
    "Facts you may use, and nothing else:",
    facts,
    "",
    PLATFORM_GUIDE[platform],
    `Maximum length: ${LIMITS[platform].maxChars} characters.`,
  ];
  if (link) {
    lines.push(`End the post with one clear next step, and put exactly this link as the final line: ${link}`);
    lines.push("If you state a figure, you may put the source link for it on the line before the final link.");
  }
  if (previous) {
    lines.push("", "Your last draft broke these rules. Write it again and fix every one.", ...previous.reasons.map((r) => `- ${r}`), "", "Last draft:", previous.text);
  }
  lines.push("", 'Return only JSON: {"text": "<the post>"}');
  return lines.join("\n");
}

export function parseDraft(raw: string): string | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  try {
    const obj = JSON.parse(cleaned) as { text?: unknown };
    return typeof obj.text === "string" && obj.text.trim() ? obj.text.trim() : null;
  } catch {
    return null;
  }
}

export async function generateDraft(llm: Llm, platform: Platform, brief: ContentBrief, cardText?: string): Promise<GeneratedDraft | { error: string; attempts: number; last?: GeneratedDraft }> {
  let previous: { text: string; reasons: string[] } | undefined;
  let last: GeneratedDraft | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await llm.generateRaw(VOICE_RULES, buildPrompt(platform, brief, previous), 800);
    } catch (err) {
      return { error: `model error: ${(err as Error).message ?? err}`, attempts: attempt, last };
    }
    const text = parseDraft(raw);
    if (!text) {
      previous = { text: raw.slice(0, 600), reasons: ["the answer was not the JSON asked for"] };
      continue;
    }
    const gate = gateDraft(platform, text, brief, cardText);
    last = { text, gate, attempts: attempt };
    if (gate.passed) return last;
    previous = { text, reasons: describeViolations(gate.violations) };
  }
  return { error: `still breaks the rules after ${MAX_ATTEMPTS} attempts`, attempts: MAX_ATTEMPTS, last };
}

export { CARD_TEXT_MAX };
