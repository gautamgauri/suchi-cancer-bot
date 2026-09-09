/**
 * Tests for VoiceResponseCondenser — the LAST code between the chat pipeline
 * and the speech synthesiser. `voice.service.ts` hands its output straight to
 * `tts.synthesize(ssml)`, so anything that survives here is spoken aloud.
 *
 * Issue #87, Path 1: the marker strip here required a closing `]`, exactly like
 * the display-surface bug #68/PR #82 fixed. A generation that stopped inside a
 * marker therefore read a raw knowledge-base identifier to the user. Every case
 * in the first block leaks against the pre-fix implementation.
 *
 * OD-003: voice responses never mention citations. FR-CHAT-014 / FR-VOICE-004:
 * no markers and no markdown in TTS-bound text.
 *
 * No clinical or safety wording is asserted on here — machine identifiers and
 * markup only.
 */

import { VoiceResponseCondenser } from "./voice-response-condenser.service";

const KB_ID = "kb_en_nci_types_breast_diagnosis_breast_cancer_biomarker_tests_v1";

describe("VoiceResponseCondenser — citation markers never reach TTS (#87 Path 1)", () => {
  let condenser: VoiceResponseCondenser;

  beforeEach(() => {
    condenser = new VoiceResponseCondenser();
  });

  test("removes an UNTERMINATED marker instead of speaking the KB id", () => {
    const { plainText, ssml } = condenser.condense(
      `Biomarker tests guide treatment [citation:${KB_ID}:kb_`,
    );

    expect(plainText).not.toContain("[citation:");
    expect(plainText).not.toContain(KB_ID);
    expect(plainText).not.toContain("kb_en_");
    expect(ssml).not.toContain(KB_ID);
    expect(plainText).toContain("Biomarker tests guide treatment");
  });

  test("removes a complete marker", () => {
    const { plainText } = condenser.condense(
      `Biomarker tests guide treatment [citation:${KB_ID}:kb_2].`,
    );

    expect(plainText).not.toContain("[citation:");
    expect(plainText).not.toContain(KB_ID);
  });

  test("does not swallow the sentence between an unterminated and a complete marker", () => {
    // The old `[^\]]+` did not exclude `[`, so this matched as ONE marker and
    // silently deleted the sentence in the middle.
    const { plainText } = condenser.condense(
      "[citation:doc1 Radiotherapy is given daily. [citation:doc2:chunk2]",
    );

    expect(plainText).toContain("Radiotherapy is given daily.");
    expect(plainText).not.toContain("[citation:");
  });

  test("removes a truncated `[citation:` prefix at end of text", () => {
    const { plainText } = condenser.condense("Talk to your oncologist. [cita");

    expect(plainText).not.toContain("[cita");
  });
});

describe("VoiceResponseCondenser — markdown never reaches TTS (#87)", () => {
  let condenser: VoiceResponseCondenser;

  beforeEach(() => {
    condenser = new VoiceResponseCondenser();
  });

  test("removes markdown left unpaired by a truncated generation", () => {
    const { plainText, ssml } = condenser.condense("**Call 112 if you have chest pain");

    expect(plainText).not.toContain("**");
    expect(ssml).not.toContain("**");
    expect(plainText).toContain("Call 112 if you have chest pain");
  });

  test("removes a heading marker written without a space", () => {
    const { plainText } = condenser.condense("###Next steps\nAsk your oncologist.");

    expect(plainText).not.toContain("#");
    expect(plainText).toContain("Next steps");
  });

  test("keeps link text and drops the URL", () => {
    const { plainText } = condenser.condense("See [the NCI page](https://www.cancer.gov/x) today.");

    expect(plainText).toContain("the NCI page");
    expect(plainText).not.toContain("https://");
    expect(plainText).not.toContain("](");
  });

  test("removes backticks and blockquote markers", () => {
    const { plainText } = condenser.condense("> A quoted line about `chemotherapy` today.");

    expect(plainText).not.toContain("`");
    expect(plainText).not.toContain(">");
    expect(plainText).toContain("chemotherapy");
  });

  test("preserves Devanagari text and its punctuation", () => {
    const { plainText } = condenser.condense("**कीमोथेरेपी** एक इलाज है।");

    expect(plainText).not.toContain("**");
    expect(plainText).toContain("कीमोथेरेपी एक इलाज है।");
  });
});

describe("VoiceResponseCondenser — existing shaping still applies", () => {
  let condenser: VoiceResponseCondenser;

  beforeEach(() => {
    condenser = new VoiceResponseCondenser();
  });

  test("turns a numbered list into spoken steps", () => {
    const { plainText } = condenser.condense("1. Book a scan.\n2. Meet your doctor.");

    expect(plainText).toContain("Step 1,");
    expect(plainText).toContain("Step 2,");
  });

  test("appends the voice disclaimer and wraps the result in <speak>", () => {
    const { plainText, ssml } = condenser.condense("Chemotherapy is a treatment.");

    expect(plainText).toContain("Please consult your doctor for personal medical advice.");
    expect(ssml.startsWith("<speak>")).toBe(true);
    expect(ssml.endsWith("</speak>")).toBe(true);
  });
});
