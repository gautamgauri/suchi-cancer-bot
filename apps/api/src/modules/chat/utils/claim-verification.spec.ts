import { isClaimVerificationQuestion } from "./claim-verification";

/**
 * Issue #136 — the three `myth` probes from the 2026-09-13 daily web QA run
 * (seed 1789272008). q04 was NOT corrected because it slipped into the
 * answer-first definitional path; q01/q03 escaped that path only by accident.
 * All three must be recognised as claim-verification questions.
 */
const PROBE_Q01_EN = "Is it true that eating sugar makes cancer grow faster, so I should stop all sweets?";
const PROBE_Q03_HINGLISH = "kya supari aur khaini se cancer hota hai? mere papa kehte hai sab bakwas hai";
const PROBE_Q04_HI = "लोग कहते हैं कि बायोप्सी कराने से कैंसर फैल जाता है। क्या यह सच है?";

describe("isClaimVerificationQuestion", () => {
  describe("recognises the 2026-09-13 myth probes", () => {
    it("q04 (Devanagari Hindi): biopsy spreads cancer", () => {
      expect(isClaimVerificationQuestion(PROBE_Q04_HI)).toBe(true);
    });
    it("q01 (English): sugar makes cancer grow", () => {
      expect(isClaimVerificationQuestion(PROBE_Q01_EN)).toBe(true);
    });
    it("q03 (Hinglish): supari/khaini", () => {
      expect(isClaimVerificationQuestion(PROBE_Q03_HINGLISH)).toBe(true);
    });
  });

  describe("other claim-verification phrasings", () => {
    it.each([
      "People say chemotherapy always kills you. Is that true?",
      "I heard that cancer is contagious",
      "My aunt told me tumours grow faster after surgery",
      "Is it a myth that mobile phones cause brain cancer?",
      "kya ye sach hai ki biopsy se cancer failta hai",
      "maine suna hai ki cancer chhoot se failta hai",
      "biopsy se cancer fail jata hai, sach hai kya?",
      "क्या यह सच है कि बायोप्सी से कैंसर फैलता है?",
      "मैंने सुना है कि कैंसर छूने से फैलता है",
      "यह अफवाह है या सच?",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(true);
    });
  });

  describe("does NOT match simple definitional / informational questions", () => {
    it.each([
      "What is a biopsy?",
      "What does staging mean for lymphoma?",
      "बायोप्सी क्या है?",
      "biopsy kya hoti hai?",
      "What is chemotherapy? Just asking generally.",
      "Tell me about breast cancer",
      "What are the symptoms of oral cancer?",
      "How is cancer diagnosed?",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(false);
    });
  });

  it("handles empty input", () => {
    expect(isClaimVerificationQuestion("")).toBe(false);
    expect(isClaimVerificationQuestion("   ")).toBe(false);
    expect(isClaimVerificationQuestion(null)).toBe(false);
    expect(isClaimVerificationQuestion(undefined)).toBe(false);
  });
});
