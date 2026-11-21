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

  // ---------------------------------------------------------------------
  // #137 review — forms that slipped through the first pass.
  // ---------------------------------------------------------------------
  describe("subjectless Hindi/Hinglish truth checks (#137 review)", () => {
    it.each([
      "\u0915\u094D\u092F\u093E \u0938\u091A \u0939\u0948 \u0915\u093F \u092C\u093E\u092F\u094B\u092A\u094D\u0938\u0940 \u0938\u0947 \u0915\u0948\u0902\u0938\u0930 \u092B\u0948\u0932\u0924\u093E \u0939\u0948?",
      "\u0915\u094D\u092F\u093E \u0938\u091A \u0939\u0948 \u0915\u093F \u091A\u0940\u0928\u0940 \u0916\u093E\u0928\u0947 \u0938\u0947 \u0915\u0948\u0902\u0938\u0930 \u092C\u0922\u093C\u0924\u093E \u0939\u0948",
      "kya sach hai ki biopsy se cancer failta hai",
      "kya sach hai ki cheeni se cancer badhta hai?",
      "kya ye sach hai ki biopsy karane se cancer fail jata hai",
      "kya yeh sach hai ki khaini se cancer hota hai",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(true);
    });
  });

  describe("postposed question particle (#137 review)", () => {
    it.each([
      "\u092C\u093E\u092F\u094B\u092A\u094D\u0938\u0940 \u0938\u0947 \u0915\u0948\u0902\u0938\u0930 \u092B\u0948\u0932\u0924\u093E \u0939\u0948 \u0915\u094D\u092F\u093E?",
      "\u0938\u0941\u092A\u093E\u0930\u0940 \u0938\u0947 \u0915\u0948\u0902\u0938\u0930 \u0939\u094B\u0924\u093E \u0939\u0948 \u0915\u094D\u092F\u093E",
      "biopsy se cancer failta hai kya?",
      "khaini se cancer hota hai kya?",
      "sugar se tumour badhta hai kya",
      "yeh sach hai kya?",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(true);
    });
  });

  describe("reported-speech hearsay with `ne` (#137 review)", () => {
    it.each([
      "kisi ne bataya ki biopsy se cancer failta hai",
      "logon ne kaha ki chemo se aur nuksan hota hai",
      "mere padosi ne bola ki cancer chhoot se failta hai",
      "\u0915\u093F\u0938\u0940 \u0928\u0947 \u092C\u0924\u093E\u092F\u093E \u0915\u093F \u092C\u093E\u092F\u094B\u092A\u094D\u0938\u0940 \u0938\u0947 \u0915\u0948\u0902\u0938\u0930 \u092B\u0948\u0932\u0924\u093E \u0939\u0948",
      "\u0932\u094B\u0917\u094B\u0902 \u0928\u0947 \u0915\u0939\u093E \u0915\u093F \u0915\u0940\u092E\u094B \u0938\u0947 \u092E\u094C\u0924 \u0939\u094B \u091C\u093E\u0924\u0940 \u0939\u0948",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(true);
    });
  });

  describe("English `really` / myth framings (#137 review)", () => {
    it.each([
      "Does sugar really make cancer grow faster?",
      "Does chemotherapy really kill more people than cancer?",
      "Do mobile phones really cause brain tumours?",
      "Is it a myth that a biopsy spreads cancer?",
      "Is it a myth that only smokers get lung cancer?",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(true);
    });
  });

  describe("clinician attribution is an instruction, not hearsay (#137 review)", () => {
    it.each([
      "My doctor told me I need chemo. What is chemo?",
      "doctor kehte hain ki chemo lena chahiye",
      "doctor kehte hain biopsy karani hai; biopsy kya hai?",
      "\u0921\u0949\u0915\u094D\u091F\u0930 \u0915\u0939\u0924\u0947 \u0939\u0948\u0902 \u0915\u093F \u092C\u093E\u092F\u094B\u092A\u094D\u0938\u0940 \u0915\u0930\u093E\u0928\u0940 \u0939\u0948",
      "\u0921\u0949\u0915\u094D\u091F\u0930 \u0928\u0947 \u092C\u0924\u093E\u092F\u093E \u0915\u093F \u0915\u0940\u092E\u094B \u0936\u0941\u0930\u0942 \u0939\u094B\u0917\u0940",
      "nurse ne bataya ki port lagega",
    ])("%s", (text) => {
      expect(isClaimVerificationQuestion(text)).toBe(false);
    });

    it("a clinician mention does not mask a rumour later in the same message", () => {
      expect(
        isClaimVerificationQuestion(
          "doctor kehte hain ki biopsy safe hai, par log kehte hain ki isse cancer failta hai"
        )
      ).toBe(true);
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
      "biopsy kya hoti hai",
      "\u0915\u0940\u092E\u094B\u0925\u0947\u0930\u0947\u092A\u0940 \u0915\u094D\u092F\u093E \u0939\u0948",
      "What are the side effects of radiation?",
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
