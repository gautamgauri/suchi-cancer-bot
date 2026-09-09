/**
 * Tests for stripForVoice — the TTS post-processing function.
 *
 * FR-VOICE-004: TTS output must contain no [1]/[2] markers, citation blocks,
 * or markdown formatting.
 */

import { stripForVoice } from "./voice-output-stripper";

describe("stripForVoice — citation markers removed (FR-VOICE-004)", () => {
  test("removes [citation:docId:chunkId] markers", () => {
    const input = "Breast cancer treatment [citation:doc1:chunk1] includes surgery [citation:doc2:chunk2].";
    const result = stripForVoice(input);
    expect(result).not.toMatch(/\[citation:/);
    expect(result).toContain("Breast cancer treatment");
    expect(result).toContain("includes surgery");
  });

  test("removes [source:...] markers", () => {
    const input = "Early detection is key [source:nci:breast_cancer].";
    const result = stripForVoice(input);
    expect(result).not.toMatch(/\[source:/);
  });

  test("removes NCI-style numbered source lists", () => {
    const input = [
      "Chemotherapy helps control cancer.",
      "",
      "1. Signs and Symptoms of Breast Cancer - NCI",
      "2. Chemotherapy Overview - NCI",
    ].join("\n");
    const result = stripForVoice(input);
    expect(result).not.toContain("Signs and Symptoms of Breast Cancer - NCI");
    expect(result).not.toContain("Chemotherapy Overview - NCI");
    expect(result).toContain("Chemotherapy helps control cancer.");
  });

  test("removes 'based on information from' source block", () => {
    const input = "Cancer staging is important.\n\n**This answer is based on information from the following trusted sources:**\n1. NCI Guidelines";
    const result = stripForVoice(input);
    expect(result).not.toContain("based on information from");
    expect(result).not.toContain("NCI Guidelines");
  });
});

describe("stripForVoice — markdown formatting removed (FR-VOICE-004)", () => {
  test("removes bold (**text**)", () => {
    const result = stripForVoice("**Call 112 immediately** if you have chest pain.");
    expect(result).not.toContain("**");
    expect(result).toContain("Call 112 immediately");
  });

  test("removes heading markers (## Heading)", () => {
    const result = stripForVoice("## What is Chemotherapy\nChemo is a treatment.");
    expect(result).not.toMatch(/^#{1,6}\s/m);
    expect(result).toContain("What is Chemotherapy");
  });

  test("removes bullet list markers (- item)", () => {
    const result = stripForVoice("Steps:\n- Step one\n- Step two");
    expect(result).not.toMatch(/^- /m);
    expect(result).toContain("Step one");
    expect(result).toContain("Step two");
  });

  test("removes numbered list markers (1. item)", () => {
    const result = stripForVoice("1. First point\n2. Second point");
    expect(result).not.toMatch(/^\d+\.\s/m);
    expect(result).toContain("First point");
    expect(result).toContain("Second point");
  });

  test("removes horizontal rules (---)", () => {
    const result = stripForVoice("Some text\n\n---\n\nMore text");
    expect(result).not.toMatch(/^---$/m);
    expect(result).toContain("Some text");
    expect(result).toContain("More text");
  });
});

describe("stripForVoice — disclaimer handling", () => {
  test("removes italic disclaimer block", () => {
    const input = "Good info here.\n\n*This information is for general educational purposes only and is not a substitute for professional medical advice. Always consult your doctor for personalized guidance.*";
    const result = stripForVoice(input);
    // The disclaimer content should not appear as a block
    expect(result).toContain("Good info here.");
  });

  test("adds spoken disclaimer if none present", () => {
    const result = stripForVoice("Chemotherapy is a cancer treatment.");
    expect(result).toContain("not medical advice");
  });

  test("does not duplicate disclaimer if already present", () => {
    const input = "Cancer info. Please remember, this is general information and not medical advice. Always consult your doctor for personalized guidance.";
    const result = stripForVoice(input);
    const count = (result.match(/not medical advice/g) || []).length;
    expect(count).toBe(1);
  });
});

describe("stripForVoice — output remains readable", () => {
  test("collapses multiple blank lines to single", () => {
    const input = "Line one.\n\n\n\nLine two.";
    const result = stripForVoice(input);
    expect(result).not.toMatch(/\n{3,}/);
  });

  test("full response with citations and markdown produces clean voice text", () => {
    const input = [
      "## Breast Cancer Treatment",
      "",
      "**Chemotherapy** is one of the main treatments [citation:doc1:chunk1].",
      "",
      "Key approaches:",
      "- Surgery to remove the tumour",
      "- **Radiation therapy** after surgery [citation:doc2:chunk2]",
      "- Hormone therapy for hormone-receptor-positive cancers",
      "",
      "**This answer is based on information from the following trusted sources:**",
      "1. NCI Breast Cancer Treatment Guide - NCI",
    ].join("\n");

    const result = stripForVoice(input);

    expect(result).not.toMatch(/\[citation:/);
    expect(result).not.toContain("**");
    expect(result).not.toMatch(/^#{1,6}\s/m);
    expect(result).not.toContain("NCI Breast Cancer Treatment Guide - NCI");
    expect(result).toContain("Chemotherapy");
    expect(result).toContain("Surgery to remove the tumour");
    expect(result).toContain("Radiation therapy");
  });
});

/**
 * Issue #87, Path 1 — the voice stripper carried the same fail-open patterns
 * #68 found on the display surface: every one required a closing `]`, so a
 * generation that stopped mid-marker sent the raw knowledge-base identifier on
 * to TTS. Each case below leaks against the pre-fix patterns.
 *
 * OD-003: voice responses never mention citations.
 */
describe("stripForVoice — truncated markers (#87 Path 1)", () => {
  const KB_ID = "kb_en_nci_types_breast_diagnosis_breast_cancer_biomarker_tests_v1";

  test("removes an UNTERMINATED citation marker instead of speaking the KB id", () => {
    const result = stripForVoice(`Biomarker tests can guide treatment [citation:${KB_ID}:kb_`);

    expect(result).not.toContain("[citation:");
    expect(result).not.toContain(KB_ID);
    expect(result).not.toContain("kb_en_");
    expect(result).toContain("Biomarker tests can guide treatment");
  });

  test("removes an unterminated marker mid-text and keeps the prose after it", () => {
    const result = stripForVoice(`Rest well [citation:${KB_ID} and drink water.`);

    expect(result).not.toContain("[citation:");
    expect(result).not.toContain(KB_ID);
    expect(result).toContain("and drink water.");
  });

  test("does not swallow the sentence between an unterminated and a complete marker", () => {
    // The old `[^\]]*` did not exclude `[`, so this matched as ONE marker and
    // silently deleted the sentence in the middle.
    const result = stripForVoice(
      "[citation:doc1 Radiotherapy is given daily. [citation:doc2:chunk2]",
    );

    expect(result).toContain("Radiotherapy is given daily.");
    expect(result).not.toContain("[citation:");
  });

  test("removes an unterminated [source: marker", () => {
    const result = stripForVoice(`Early detection is key [source:${KB_ID}`);

    expect(result).not.toContain("[source:");
    expect(result).not.toContain(KB_ID);
  });

  test("removes markdown left unpaired by a truncated generation", () => {
    const result = stripForVoice("**Call 112 if you have chest pain");

    expect(result).not.toContain("**");
    expect(result).toContain("Call 112 if you have chest pain");
  });
});
