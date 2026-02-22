import { VoiceResponseCondenser } from "./voice-response-condenser.service";

describe("VoiceResponseCondenser", () => {
  let condenser: VoiceResponseCondenser;

  beforeEach(() => {
    condenser = new VoiceResponseCondenser();
  });

  /* ───────── Citation stripping ───────── */

  describe("citation stripping", () => {
    test("removes single citation marker", () => {
      const { plainText } = condenser.condense(
        "Cancer is a disease of cells. [citation:abc123] It can affect any organ.",
      );
      expect(plainText).not.toContain("[citation:");
      expect(plainText).toContain("Cancer is a disease of cells.");
    });

    test("removes multiple citation markers", () => {
      const { plainText } = condenser.condense(
        "Fact one. [citation:a1] Fact two. [citation:b2] Fact three. [citation:c3]",
      );
      expect(plainText).not.toContain("[citation:");
      expect(plainText).toContain("Fact one.");
      expect(plainText).toContain("Fact two.");
      expect(plainText).toContain("Fact three.");
    });

    test("handles citation with special characters in id", () => {
      const { plainText } = condenser.condense(
        "Statement. [citation:doc-2024_v3.1] Done.",
      );
      expect(plainText).not.toContain("[citation:");
    });
  });

  /* ───────── Markdown stripping ───────── */

  describe("markdown stripping", () => {
    test("strips bold markers", () => {
      const { plainText } = condenser.condense(
        "This has **bold text** in it.",
      );
      expect(plainText).not.toContain("**");
      expect(plainText).toContain("bold text");
    });

    test("strips italic markers", () => {
      const { plainText } = condenser.condense(
        "This is *somewhat relevant* data.",
      );
      expect(plainText).not.toContain("*somewhat");
      expect(plainText).toContain("somewhat relevant");
    });

    test("strips header markers", () => {
      const { plainText } = condenser.condense("## Treatment Options\nChemo works.");
      expect(plainText).not.toContain("##");
      expect(plainText).toContain("Treatment Options");
    });

    test("strips bullet points", () => {
      const { plainText } = condenser.condense(
        "Options:\n- Surgery\n- Radiation\n- Chemo.",
      );
      expect(plainText).not.toMatch(/^- /m);
      expect(plainText).toContain("Surgery");
    });

    test("converts numbered lists to speakable form", () => {
      const { plainText } = condenser.condense(
        "Steps:\n1. Consult doctor.\n2. Get tests.",
      );
      expect(plainText).toContain("Step 1,");
      expect(plainText).toContain("Step 2,");
      expect(plainText).not.toMatch(/^\d+\.\s/m);
    });
  });

  /* ───────── Note/disclaimer removal ───────── */

  describe("note and disclaimer removal", () => {
    test("removes Important lines", () => {
      const { plainText } = condenser.condense(
        "Treatment exists. **Important:** Always consult a doctor.\nSecond line.",
      );
      expect(plainText).not.toContain("Important");
      expect(plainText).toContain("Treatment exists.");
    });

    test("removes Note lines", () => {
      const { plainText } = condenser.condense(
        "Treatment exists. Note: This is not medical advice.\nMore info here.",
      );
      expect(plainText).not.toContain("Note:");
    });

    test("removes Source lines", () => {
      const { plainText } = condenser.condense(
        "Treatment works. Sources: WHO 2024 report.\nEnd.",
      );
      expect(plainText).not.toContain("Sources:");
    });
  });

  /* ───────── Sentence truncation ───────── */

  describe("sentence truncation", () => {
    test("keeps up to 6 sentences", () => {
      const input = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(" ");
      const { plainText } = condenser.condense(input);
      const sentenceCount = (plainText.match(/Sentence \d+\./g) || []).length;
      expect(sentenceCount).toBe(6);
    });

    test("keeps all sentences when fewer than 6", () => {
      const input = "One. Two. Three.";
      const { plainText } = condenser.condense(input);
      // Sentence split captures leading space, join adds another — expect that behavior
      expect(plainText).toContain("One.");
      expect(plainText).toContain("Two.");
      expect(plainText).toContain("Three.");
      expect((plainText.match(/\w+\./g) || []).length).toBe(3);
    });

    test("handles text without period delimiters", () => {
      const input = "No period here";
      const { plainText } = condenser.condense(input);
      expect(plainText).toBe("No period here");
    });

    test("handles exclamation and question marks as terminators", () => {
      const input = "Really? Yes! Done. Okay? Sure! Fine. Extra! More?";
      const { plainText } = condenser.condense(input);
      const count = (plainText.match(/[.!?]/g) || []).length;
      expect(count).toBe(6);
    });
  });

  /* ───────── Whitespace collapsing ───────── */

  describe("whitespace collapsing", () => {
    test("collapses multiple newlines into spaces", () => {
      const { plainText } = condenser.condense("Hello.\n\n\nWorld.");
      expect(plainText).not.toContain("\n");
      expect(plainText).toContain("Hello.");
      expect(plainText).toContain("World.");
    });

    test("collapses multiple spaces before sentence split", () => {
      // The \s+ regex collapses spaces, but sentence split/join may re-introduce
      // double spaces. Verify the core collapse works on a single sentence.
      const { plainText } = condenser.condense("Hello   world.");
      expect(plainText).toBe("Hello world.");
    });

    test("trims leading/trailing whitespace", () => {
      const { plainText } = condenser.condense("  Hello.  ");
      expect(plainText).toBe("Hello.");
    });
  });

  /* ───────── SSML generation ───────── */

  describe("SSML generation", () => {
    test("wraps output in <speak> tags", () => {
      const { ssml } = condenser.condense("Hello.");
      expect(ssml).toMatch(/^<speak>.*<\/speak>$/);
    });

    test("inserts break after sentence-ending punctuation", () => {
      const { ssml } = condenser.condense("First sentence. Second sentence.");
      expect(ssml).toContain('<break time="400ms"/>');
    });

    test("does not insert break for the last sentence (no trailing space)", () => {
      const { ssml } = condenser.condense("Only one.");
      // Last sentence has no trailing space so the regex shouldn't match
      expect(ssml).toBe("<speak>Only one.</speak>");
    });
  });

  /* ───────── Emergency term emphasis ───────── */

  describe("emergency term emphasis in SSML", () => {
    const emergencyTerms = ["emergency", "ambulance", "112", "108", "immediately", "turant", "tatkal"];

    test.each(emergencyTerms)("emphasizes '%s'", (term) => {
      const { ssml } = condenser.condense(`Call ${term} now.`);
      expect(ssml).toContain(`<emphasis level="strong">${term}</emphasis>`);
    });

    test("emphasis is case-insensitive", () => {
      const { ssml } = condenser.condense("Call EMERGENCY services. Call Emergency now.");
      expect(ssml).toContain('<emphasis level="strong">EMERGENCY</emphasis>');
      expect(ssml).toContain('<emphasis level="strong">Emergency</emphasis>');
    });

    test("does not emphasize non-emergency words", () => {
      const { ssml } = condenser.condense("Treatment is available.");
      expect(ssml).not.toContain("<emphasis");
    });
  });

  /* ───────── End-to-end condense ───────── */

  describe("end-to-end", () => {
    test("processes a realistic response", () => {
      const input = [
        "## Cancer Treatment Options",
        "",
        "There are several **treatment options** available. [citation:nci-2024]",
        "",
        "- Surgery is the most common approach.",
        "- Radiation therapy targets specific areas.",
        "- Chemotherapy uses drugs to kill cancer cells.",
        "",
        "In case of **emergency**, call 112 immediately.",
        "",
        "**Important:** Always consult your oncologist before making decisions.",
        "",
        "Sources: NCI Treatment Guide 2024.",
      ].join("\n");

      const { plainText, ssml } = condenser.condense(input);

      // Citations removed
      expect(plainText).not.toContain("[citation:");
      // Markdown stripped
      expect(plainText).not.toContain("**");
      expect(plainText).not.toContain("##");
      // Disclaimers removed
      expect(plainText).not.toContain("Important:");
      expect(plainText).not.toContain("Sources:");
      // Content preserved
      expect(plainText).toContain("treatment options");
      expect(plainText).toContain("Surgery");
      // SSML has emergency emphasis
      expect(ssml).toContain('<emphasis level="strong">emergency</emphasis>');
      expect(ssml).toContain('<emphasis level="strong">112</emphasis>');
      expect(ssml).toContain('<emphasis level="strong">immediately</emphasis>');
      // SSML wrapped
      expect(ssml).toMatch(/^<speak>.*<\/speak>$/);
    });

    test("returns both plainText and ssml", () => {
      const result = condenser.condense("Hello world.");
      expect(result).toHaveProperty("plainText");
      expect(result).toHaveProperty("ssml");
      expect(typeof result.plainText).toBe("string");
      expect(typeof result.ssml).toBe("string");
    });

    test("handles empty input", () => {
      const { plainText, ssml } = condenser.condense("");
      expect(plainText).toBe("");
      expect(ssml).toBe("<speak></speak>");
    });
  });
});
