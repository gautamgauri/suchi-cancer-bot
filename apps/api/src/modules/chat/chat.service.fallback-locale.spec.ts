import { ChatService } from "./chat.service";
import { StructuredExtractorService } from "./structured-extractor.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

/**
 * Issue #186 — the completeness fallback appended hardcoded ENGLISH section
 * headings to the tail of a reply regardless of the reply's language. A Hindi
 * reader got a Hindi answer and then:
 *
 *   **Additional tests your doctor may recommend:**
 *   - MRI
 *
 * Same reader-facing class as #162 (English disclaimer under a Hindi reply,
 * fixed in #163) but a different code path — #163 only touched appendDisclaimer.
 *
 * These tests pin the *plumbing*: the reply language reaches
 * generateFallbackContent(), so a locale with no SCCF-approved labels gets no
 * block at all instead of English scaffolding. The label wording itself is
 * parked for SCCF review (AGENTS.md §1.3).
 *
 * applyEssentialTermFallback uses no instance state beyond the extractor, so it
 * is exercised off the prototype (the pattern used by
 * chat.service.essential-terms.spec.ts).
 */
const svc: any = Object.create(ChatService.prototype);
svc.structuredExtractor = new StructuredExtractorService();

const chunk = (content: string): EvidenceChunk => ({
  chunkId: "chunk1",
  docId: "doc1",
  content,
  similarity: 0.8,
  document: {
    title: "Oral cancer — detection",
    sourceType: "02_nci_core",
    source: "NCI",
    citation: "NCI Citation",
    isTrustedSource: true,
  },
});

// Sources carry tests and warning signs that neither reply below mentions, so
// the completeness policy is unmet and the fallback block is generated.
const CHUNKS = [
  chunk(
    "MRI and mammogram are used to assess the extent of disease. Watch for a lump or mass " +
      "that does not heal, and for a persistent sore throat."
  ),
];

// A Hindi reply of the shape reported in the issue: an answer, then a
// follow-up question — nothing the fallback can splice before, so it lands on
// the tail, which is exactly where the patient saw it.
const HINDI_REPLY = [
  "तंबाकू छोड़ने के बाद भी मुँह के कैंसर का खतरा कुछ वर्षों तक बना रहता है, लेकिन यह धीरे-धीरे कम होता जाता है।",
  "",
  "क्या आप जानना चाहेंगे कि मुँह के कैंसर के सामान्य लक्षण क्या होते हैं?",
].join("\n");

const ENGLISH_REPLY = [
  "The risk of oral cancer stays raised for some years after quitting tobacco, but it falls over time.",
  "",
  "Would you like to know the common symptoms of oral cancer?",
].join("\n");

const apply = (responseText: string, locale: string | null, userText: string): string => {
  const extraction = svc.structuredExtractor.extract(CHUNKS, "prevention");
  return svc.applyEssentialTermFallback(
    responseText,
    extraction,
    "prevention",
    locale,
    userText
  );
};

describe("completeness fallback — reply language (issue #186)", () => {
  const HINDI_QUESTION = "क्या तंबाकू छोड़ने के बाद भी मुँह के कैंसर का खतरा रहता है?";

  it("does not append English section headings to a Hindi reply", () => {
    const out = apply(HINDI_REPLY, null, HINDI_QUESTION);

    expect(out).not.toContain("Additional tests your doctor may recommend");
    expect(out).not.toContain("Additional warning signs");
    expect(out).not.toContain("When to seek care");
    // …and no bare test name is left dangling under the Hindi text either.
    expect(out).toBe(HINDI_REPLY);
  });

  it("does not append them when the locale says hi and the body is Devanagari", () => {
    const out = apply(HINDI_REPLY, "hi", HINDI_QUESTION);

    expect(out).toBe(HINDI_REPLY);
  });

  it("does not append them for an explicit bh/mai locale", () => {
    expect(apply(HINDI_REPLY, "bh", HINDI_QUESTION)).toBe(HINDI_REPLY);
    expect(apply(HINDI_REPLY, "mai", HINDI_QUESTION)).toBe(HINDI_REPLY);
  });

  it("a Devanagari body outranks a stale session locale of en", () => {
    const out = apply(HINDI_REPLY, "en", HINDI_QUESTION);

    expect(out).toBe(HINDI_REPLY);
  });

  it("still appends the block to an English reply", () => {
    const out = apply(ENGLISH_REPLY, "en", "Is there still a risk after quitting tobacco?");

    expect(out).toContain("**Additional tests your doctor may recommend:**");
    // prevention requires 1 test, so the block carries the first missing one.
    expect(out).toContain("Mammogram");
    expect(out.startsWith(ENGLISH_REPLY)).toBe(true);
  });
});
