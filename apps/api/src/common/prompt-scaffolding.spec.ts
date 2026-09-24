/**
 * Issue #152 — internal prompt scaffolding delivered to patients.
 *
 * The two fixtures below are the text a tester's phone ACTUALLY RECEIVED in the
 * scheduled WhatsApp QA runs of 2026-09-14, copied verbatim from the issue. They
 * are the regression bar: whatever else changes, these two strings must never
 * again reach a reader with the scaffolding in them.
 */

import { stripPromptScaffolding } from "./text-cleaning";
import { cleanResponseForDisplay } from "../modules/chat/display-text-cleaner";

describe("stripPromptScaffolding (issue #152)", () => {
  describe("delivered evidence", () => {
    // run runs/2026-09-14T06-00-24_seed1789345824, q04 (abstention/en).
    const DELIVERED_POST_DIAGNOSIS =
      "Important: This information is for general educational purposes and is not a " +
      "diagnosis. Please consult with your healthcare provider for accurate, personalized " +
      "medical information. It's natural to feel anxious about this. Let me help you with " +
      "some information. 1. ACKNOWLEDGE the diagnosis empathetically: I understand " +
      "receiving a cancer diagnosis can be overwhelming. 2. EXPLAIN what the diagnosis " +
      "means in plain language: A cancer diagnosis means that abnormal cells are growing " +
      "uncontrollably in the body. For your uncle, this means these cells have been " +
      "identified in his lungs. 3. STAGING OVERVIEW: Staging is a process that helps " +
      "doctors understand the extent of the cancer, including the tumor size, whether it " +
      "has spread to nearby lymph nodes.";

    it("removes every contract heading from the delivered POST_DIAGNOSIS reply", () => {
      const cleaned = stripPromptScaffolding(DELIVERED_POST_DIAGNOSIS);

      expect(cleaned).not.toContain("ACKNOWLEDGE");
      expect(cleaned).not.toContain("EXPLAIN");
      expect(cleaned).not.toContain("STAGING OVERVIEW");
      expect(cleaned).not.toMatch(/\d\.\s*[A-Z]{3,}/);
    });

    it("keeps every word of the answer that followed each heading", () => {
      const cleaned = stripPromptScaffolding(DELIVERED_POST_DIAGNOSIS);

      expect(cleaned).toContain("I understand receiving a cancer diagnosis can be overwhelming.");
      expect(cleaned).toContain("A cancer diagnosis means that abnormal cells are growing");
      expect(cleaned).toContain("identified in his lungs.");
      expect(cleaned).toContain("Staging is a process that helps doctors understand");
      // The disclaimer prefix is clinical wording and must survive untouched.
      expect(cleaned).toContain(
        "This information is for general educational purposes and is not a diagnosis."
      );
    });

    // run runs/2026-09-14T00-00-56_seed1789324256, q01 (myth/hinglish).
    const DELIVERED_HINGLISH =
      "मुझे समझ आ रहा है कि आप जानना चाहते हैं कि क्या डियोडोरेंट के इस्तेमाल से ब्रेस्ट कैंसर हो सकता है। " +
      "Educational answer: डियर यूजर, डियोडोरेंट और एंटीपर्सपिरेंट के इस्तेमाल से ब्रेस्ट कैंसर होने की " +
      "चिंताओं का समर्थन करने के लिए कोई सबूत नहीं है।";

    it("removes the section label and the machine salutation from the Hinglish reply", () => {
      const cleaned = stripPromptScaffolding(DELIVERED_HINGLISH);

      expect(cleaned).not.toContain("Educational answer");
      expect(cleaned).not.toContain("डियर यूजर");
    });

    it("keeps the Devanagari answer around them intact", () => {
      const cleaned = stripPromptScaffolding(DELIVERED_HINGLISH);

      expect(cleaned).toContain("मुझे समझ आ रहा है कि आप जानना चाहते हैं");
      expect(cleaned).toContain(
        "डियोडोरेंट और एंटीपर्सपिरेंट के इस्तेमाल से ब्रेस्ट कैंसर होने की चिंताओं का समर्थन करने के लिए कोई सबूत नहीं है।"
      );
    });
  });

  describe("the full contract vocabulary", () => {
    // Every ALL-CAPS heading in llm.service.ts's contracts, with the answer the
    // model would write after it.
    const HEADINGS = [
      "1. ACKNOWLEDGE the diagnosis empathetically:",
      "1. ACKNOWLEDGE emotional weight:",
      "1. ACKNOWLEDGE with empathy:",
      "1. START your response with compassion:",
      "2. EXPLAIN what the diagnosis means in plain language:",
      "2. EXPLAIN the condition in plain language:",
      "2. REASSURE:",
      "3. STAGING OVERVIEW:",
      "3. WHAT IT COULD BE:",
      "3. TREATMENT OPTIONS with oncologist recommendation:",
      "4. TREATMENT OPTIONS:",
      "4. WHAT TO DO:",
      "4. CAREGIVER-SPECIFIC steps:",
      "5. RECOMMEND consulting an oncologist:",
      "5. TESTS:",
      "5. PREPARATION CHECKLIST:",
      "6. TIMELINE:",
      "6. SUPPORT RESOURCES:",
      "6. URGENT RED FLAGS:",
      "7. QUESTIONS FOR DOCTOR:",
    ];

    it.each(HEADINGS)("strips %s and keeps the answer after it", (heading) => {
      const cleaned = stripPromptScaffolding(`${heading} Speak to your oncologist soon.`);

      expect(cleaned).toBe("Speak to your oncologist soon.");
    });

    it("strips a heading written with an em dash instead of a colon", () => {
      expect(stripPromptScaffolding("4. TREATMENT OPTIONS — Surgery and chemotherapy.")).toBe(
        "Surgery and chemotherapy."
      );
    });

    it("strips a bold-wrapped heading", () => {
      expect(
        stripPromptScaffolding("**3. STAGING OVERVIEW:** Staging describes how far it has spread.")
      ).toBe("Staging describes how far it has spread.");
    });

    it("strips a heading that ends the line with no terminator", () => {
      const cleaned = stripPromptScaffolding("7. QUESTIONS FOR DOCTOR\nWhat stage is my cancer?");

      expect(cleaned).not.toContain("QUESTIONS FOR DOCTOR");
      expect(cleaned).toContain("What stage is my cancer?");
    });

    it("strips the contract's own title line", () => {
      const cleaned = stripPromptScaffolding(
        "RESPONSE CONTRACT FOR POST-DIAGNOSIS QUERIES (STRICT ORDER): A biopsy is a test."
      );

      expect(cleaned).toBe("A biopsy is a test.");
    });
  });

  describe("it does not touch ordinary prose", () => {
    it("keeps a title-case heading the model wrote for the reader", () => {
      const text = "**Treatment options:** Surgery, chemotherapy and radiation are all used.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("keeps a numbered list of real advice", () => {
      const text =
        "1. See a doctor: book an appointment this week.\n" +
        "2. Bring your reports: take every scan you have.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("keeps an ALL-CAPS word that is not a contract heading", () => {
      const text = "1. MRI scans and CT scans are both used to look for spread.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("keeps a keyword used as ordinary prose without the numbered prefix", () => {
      const text = "Your oncologist will explain what the results mean.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("keeps the emergency escalation header and its line break (issue #135)", () => {
      const text =
        "**This may be a medical emergency.**\n\n**Call for help NOW:**\nCall 112 right away.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("leaves Devanagari prose with a danda untouched", () => {
      const text = "कीमोथेरेपी के दौरान बुखार आना गंभीर हो सकता है। तुरंत डॉक्टर से मिलें।";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("is a no-op on empty input", () => {
      expect(stripPromptScaffolding("")).toBe("");
    });

    it("is idempotent", () => {
      const once = stripPromptScaffolding("2. EXPLAIN in plain language: Cancer is a cell disease.");

      expect(stripPromptScaffolding(once)).toBe(once);
    });

    it("never lengthens the text", () => {
      const samples = [
        "1. ACKNOWLEDGE with empathy: I hear you.",
        "Educational answer: Screening finds cancer early.",
        "Plain prose with no scaffolding at all.",
      ];

      for (const s of samples) {
        expect(stripPromptScaffolding(s).length).toBeLessThanOrEqual(s.length);
      }
    });
  });

  /**
   * The post-#153 live re-probe: the ALL-CAPS contract headings were gone, but
   * `What I understood:` — step 1 of the same "SAFE + USEFUL" contract, and the
   * direct sibling of the `Educational answer:` label the strip already removed
   * — was still in the DELIVERED text of five scheduled runs.
   */
  describe("the \"SAFE + USEFUL\" contract step labels", () => {
    // run runs/2026-09-20T18-00-31_seed1789907431, q02 (abstention/en).
    const DELIVERED_GROUNDING_LABEL =
      "Important: This information is for general educational purposes and is not a " +
      "diagnosis. Please consult with your healthcare provider for accurate, personalized " +
      "medical information. I understand receiving a cancer diagnosis can be overwhelming. " +
      "What I understood: You are asking about the prognosis for a relative who has been " +
      "diagnosed with lung cancer that has spread to other parts of the body. I cannot " +
      "provide specific information about lung cancer prognosis.";

    it("removes the delivered `What I understood:` label", () => {
      const cleaned = stripPromptScaffolding(DELIVERED_GROUNDING_LABEL);

      expect(cleaned).not.toContain("What I understood");
    });

    it("keeps the grounding sentence that followed the label", () => {
      const cleaned = stripPromptScaffolding(DELIVERED_GROUNDING_LABEL);

      expect(cleaned).toContain(
        "You are asking about the prognosis for a relative who has been diagnosed"
      );
      expect(cleaned).toContain("I cannot provide specific information about lung cancer");
      // The empathic opener and the disclaimer prefix are clinical wording.
      expect(cleaned).toContain("I understand receiving a cancer diagnosis can be overwhelming.");
      expect(cleaned).toContain(
        "This information is for general educational purposes and is not a diagnosis."
      );
    });

    it("removes the English label spliced into an otherwise Devanagari reply", () => {
      const cleaned = stripPromptScaffolding(
        "...medical information. What I understood: आप जानना चाहते हैं कि इलाज के दौरान टीका लगवाना सुरक्षित है या नहीं।"
      );

      expect(cleaned).not.toContain("What I understood");
      expect(cleaned).toContain(
        "आप जानना चाहते हैं कि इलाज के दौरान टीका लगवाना सुरक्षित है या नहीं।"
      );
    });

    const STEP_LABELS = [
      "What I understood:",
      "**What I understood**:",
      "**What I understood:**",
      "One clarifying question:",
      "**One clarifying question**:",
      "**One clarifying question** (optional):",
    ];

    it.each(STEP_LABELS)("strips %s and keeps the words after it", (label) => {
      expect(stripPromptScaffolding(`${label} Which tests has the doctor ordered?`)).toBe(
        "Which tests has the doctor ordered?"
      );
    });

    /**
     * The list marker is NOT part of the label. Step 3 (`What to do next`) is
     * deliberately kept, so a strip that also ate `1.`, `2.` and `4.` would
     * leave the reader a list whose only surviving number is `3.` — the same
     * orphaned-numbering artifact issue #158 reports, reintroduced by the fix
     * for #152. `Educational answer` (step 2) has always left its marker alone;
     * these labels now behave identically.
     */
    const LIST_PREFIXED_STEP_LABELS: Array<[string, string]> = [
      ["1. **What I understood**:", "1. "],
      ["1) What I understood:", "1) "],
      ["4. **One clarifying question** (optional):", "4. "],
      ["- **What I understood**:", "- "],
      ["* **What I understood**:", "* "],
    ];

    it.each(LIST_PREFIXED_STEP_LABELS)(
      "strips %s but leaves its list marker for the sibling items",
      (label, marker) => {
        expect(stripPromptScaffolding(`${label} Which tests has the doctor ordered?`)).toBe(
          `${marker}Which tests has the doctor ordered?`
        );
      }
    );

    it("leaves a delivered contract echo as a list that still starts at 1", () => {
      const echoed =
        "1. **What I understood**: You are asking about screening.\n" +
        "2. **Educational answer**: Screening can find cancer early.\n" +
        "3. **What to do next**: Ask your doctor about a screening test.\n" +
        "4. **One clarifying question** (optional): Have you had a test before?";

      expect(stripPromptScaffolding(echoed)).toBe(
        "1. You are asking about screening.\n" +
          "2. Screening can find cancer early.\n" +
          "3. **What to do next**: Ask your doctor about a screening test.\n" +
          "4. Have you had a test before?"
      );
    });

    it("leaves the bullet of a bulleted contract echo, as the sibling item keeps its own", () => {
      expect(
        stripPromptScaffolding(
          "* **What I understood**: You are asking about screening.\n" +
            "* **Educational answer**: Screening can find cancer early."
        )
      ).toBe(
        "* You are asking about screening.\n* Screening can find cancer early."
      );
    });

    /**
     * Title case is the commonest heading casing a model produces, and the
     * case-sensitivity above only has to protect the FIRST word: lowercase
     * `...what I understood:` is the prose form that must survive.
     */
    const TITLE_CASE_STEP_LABELS = [
      "What I Understood:",
      "**What I Understood:**",
      "One Clarifying Question:",
      "**One Clarifying Question** (optional):",
    ];

    it.each(TITLE_CASE_STEP_LABELS)("strips the title-case form %s", (label) => {
      expect(stripPromptScaffolding(`${label} Which tests has the doctor ordered?`)).toBe(
        "Which tests has the doctor ordered?"
      );
    });

    it("strips a label terminated by an em dash, as the contract-heading strip already does", () => {
      expect(
        stripPromptScaffolding("**What I understood** — You are asking about screening.")
      ).toBe("You are asking about screening.");
    });

    it("strips a label left standing alone as a heading line", () => {
      expect(
        stripPromptScaffolding("**What I understood**\nYou are asking about screening.")
      ).toBe("You are asking about screening.");
    });

    it("strips a second label that follows the first immediately", () => {
      expect(
        stripPromptScaffolding(
          "What I understood: One clarifying question: Which tests has the doctor ordered?"
        )
      ).toBe("Which tests has the doctor ordered?");
    });

    it("leaves no extra blank line where a label had a paragraph to itself", () => {
      expect(
        stripPromptScaffolding(
          "Screening can find cancer early.\n\n**What I understood:**\nYou are asking about screening."
        )
      ).toBe("Screening can find cancer early.\n\nYou are asking about screening.");
    });

    it("leaves no orphaned `**` when the model bolds the whole line", () => {
      expect(
        stripPromptScaffolding("**What I understood: You are asking about screening.**")
      ).toBe("You are asking about screening.");
      expect(
        stripPromptScaffolding("1. **One clarifying question: Have you had a test before?**")
      ).toBe("1. Have you had a test before?");
    });

    it("keeps `What to do next`, which is a reader-facing heading we emit ourselves", () => {
      const text =
        "**What to do next:**\n- Ask your doctor for a biopsy.\n- Call 1800-22-1951 for help.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("keeps the same words used as lowercase prose rather than as a label", () => {
      const text = "Let me restate what I understood: you want to know about screening.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("keeps a title-case `What to do Next` heading too", () => {
      const text = "**What to do Next:**\n- Ask your doctor for a biopsy.";

      expect(stripPromptScaffolding(text)).toBe(text);
    });

    it("is idempotent on a step label", () => {
      const once = stripPromptScaffolding("What I understood: You are asking about screening.");

      expect(stripPromptScaffolding(once)).toBe(once);
    });

    it("is idempotent on a whole delivered contract echo", () => {
      const echoed =
        "1. **What I understood**: You are asking about screening.\n" +
        "2. **Educational answer**: Screening can find cancer early.\n" +
        "3. **What to do next**: Ask your doctor about a screening test.\n" +
        "4. **One clarifying question** (optional): Have you had a test before?";
      const once = stripPromptScaffolding(echoed);

      expect(stripPromptScaffolding(once)).toBe(once);
    });
  });

  /**
   * `Educational answer` is step 2 of the same contract and shares the strip's
   * shape, so the whitespace and markup debris fixed for the step labels is
   * asserted for it as well rather than left to drift apart again.
   */
  describe("the `Educational answer` label leaves no debris either", () => {
    it("leaves no extra blank line where the label had a paragraph to itself", () => {
      expect(
        stripPromptScaffolding(
          "Screening can find cancer early.\n\n**Educational answer:**\nIt is offered from age 30."
        )
      ).toBe("Screening can find cancer early.\n\nIt is offered from age 30.");
    });

    it("leaves no orphaned `**` when the model bolds the whole line", () => {
      expect(
        stripPromptScaffolding("**Educational answer: Screening can find cancer early.**")
      ).toBe("Screening can find cancer early.");
    });

    it("leaves the list marker of a numbered contract step", () => {
      expect(
        stripPromptScaffolding("2. **Educational answer**: Screening can find cancer early.")
      ).toBe("2. Screening can find cancer early.");
    });
  });

  describe("at the shared delivery boundary", () => {
    it("cleanResponseForDisplay strips scaffolding for chat, voice and WhatsApp alike", () => {
      const raw =
        "1. ACKNOWLEDGE the diagnosis empathetically: I understand this is frightening. " +
        "[citation:kb_en_nci_lung_v1:kb_3]";
      const cleaned = cleanResponseForDisplay(raw);

      expect(cleaned).toBe("I understand this is frightening.");
    });

    it("strips scaffolding and citation markers in the same pass without debris", () => {
      const cleaned = cleanResponseForDisplay(
        "Educational answer: स्क्रीनिंग जल्दी पता लगाती है [citation:a:b]।"
      );

      expect(cleaned).toBe("स्क्रीनिंग जल्दी पता लगाती है।");
    });

    it("delivers a contract echo as a list the reader can follow, not one starting at 2", () => {
      const cleaned = cleanResponseForDisplay(
        "1. **What I understood**: You are asking about screening.\n" +
          "2. **Educational answer**: Screening can find cancer early.\n" +
          "3. **What to do next**: Ask your doctor about a screening test.\n" +
          "4. **One clarifying question** (optional): Have you had a test before?"
      );

      expect(cleaned).toBe(
        "1. You are asking about screening.\n" +
          "2. Screening can find cancer early.\n" +
          "3. **What to do next**: Ask your doctor about a screening test.\n" +
          "4. Have you had a test before?"
      );
    });

    it("leaves neither a blank line nor an orphaned `**` on the display path", () => {
      expect(
        cleanResponseForDisplay(
          "Screening can find cancer early.\n\n**What I understood:**\nYou are asking about screening."
        )
      ).toBe("Screening can find cancer early.\n\nYou are asking about screening.");

      expect(
        cleanResponseForDisplay("**What I understood: You are asking about screening.**")
      ).toBe("You are asking about screening.");
    });
  });
});
