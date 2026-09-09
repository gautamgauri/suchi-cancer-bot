/**
 * Tests for the shared text-cleaning primitives (issue #87).
 *
 * These are the patterns PR #82 hardened for the display surface and that the
 * voice/TTS surface used to carry weaker copies of. Every case here failed
 * against at least one of those copies.
 *
 * No clinical or safety wording is asserted on — this is machine identifiers
 * and markup only.
 */

import {
  cleanForSpeech,
  stripCitationMarkers,
  stripResidualMarkdownForSpeech,
} from "./text-cleaning";

const KB_ID = "kb_en_nci_types_breast_diagnosis_breast_cancer_biomarker_tests_v1";

describe("stripCitationMarkers", () => {
  it("removes a complete marker", () => {
    expect(stripCitationMarkers(`Chemotherapy is a treatment [citation:${KB_ID}:kb_3].`)).toBe(
      "Chemotherapy is a treatment .",
    );
  });

  it("removes an UNTERMINATED marker — the #68/#87 fail-open gap", () => {
    // The generation stopped inside the marker, so no `]` ever arrived. Every
    // pre-fix voice pattern required one and spoke the raw KB id aloud.
    const truncated = `Biomarker tests can guide treatment [citation:${KB_ID}:kb_`;

    const out = stripCitationMarkers(truncated);

    expect(out).not.toContain("[citation:");
    expect(out).not.toContain(KB_ID);
    expect(out).not.toContain("kb_en_");
    expect(out).toBe("Biomarker tests can guide treatment ");
  });

  it("stops an unterminated marker at the first space, keeping the prose after it", () => {
    const out = stripCitationMarkers(`Rest well [citation:${KB_ID} and drink water.`);

    expect(out).not.toContain("[citation:");
    expect(out).toContain("and drink water.");
  });

  it("does NOT swallow the sentence between two markers (the #82 data-loss bug)", () => {
    // `[^\]]*` did not exclude `[`, so an unterminated marker matched forward
    // into the next complete one and deleted the prose in between.
    const input = "[citation:doc1 Radiotherapy is given daily. [citation:doc2:chunk2]";

    const out = stripCitationMarkers(input);

    expect(out).toContain("Radiotherapy is given daily.");
    expect(out).not.toContain("[citation:");
  });

  it("removes a truncated `[citation:` prefix at end of text", () => {
    expect(stripCitationMarkers("Talk to your oncologist. [cita")).toBe(
      "Talk to your oncologist. ",
    );
  });

  it("removes [source:...] markers in all three shapes", () => {
    expect(stripCitationMarkers("A [source:nci_breast_v1] B")).not.toContain("[source:");
    expect(stripCitationMarkers(`A [source:${KB_ID}`)).not.toContain(KB_ID);
    expect(stripCitationMarkers("Trailing [sou")).toBe("Trailing ");
  });

  it("removes numbered refs and a truncated trailing one", () => {
    expect(stripCitationMarkers("Point one [1] and two [23].")).toBe("Point one and two.");
    expect(stripCitationMarkers("Point one [12")).toBe("Point one");
  });

  it("removes a raw Sources section and a dangling Sources header", () => {
    expect(
      stripCitationMarkers(`Body text.\n\n**Sources:** [citation:${KB_ID}:kb_1] [citation:d:c]`),
    ).toBe("Body text.");
    expect(stripCitationMarkers("Body text.\n\n**Sources:**")).toBe("Body text.");
  });

  it("leaves ordinary bracketed prose alone", () => {
    const prose = "Chemotherapy (also called chemo) uses drugs [not radiation] to treat cancer.";
    expect(stripCitationMarkers(prose)).toBe(prose);
  });

  it("handles empty and undefined input without throwing", () => {
    expect(stripCitationMarkers("")).toBe("");
    expect(stripCitationMarkers(undefined as unknown as string)).toBeUndefined();
  });
});

describe("stripResidualMarkdownForSpeech", () => {
  it("removes unpaired ** that survived a bold unwrap", () => {
    const out = stripResidualMarkdownForSpeech("**Call 112 immediately if you have chest pain.");
    expect(out).not.toContain("**");
    expect(out).toBe("Call 112 immediately if you have chest pain.");
  });

  it("removes markdown headings", () => {
    expect(stripResidualMarkdownForSpeech("### What is chemotherapy\nIt is a treatment.")).toBe(
      "What is chemotherapy\nIt is a treatment.",
    );
  });

  it("keeps link text and drops the URL", () => {
    expect(
      stripResidualMarkdownForSpeech("See [the NCI page](https://www.cancer.gov/x) for more."),
    ).toBe("See the NCI page for more.");
  });

  it("unwraps underscore and strikethrough emphasis", () => {
    expect(stripResidualMarkdownForSpeech("This is __important__ and ~~outdated~~.")).toBe(
      "This is important and outdated.",
    );
    expect(stripResidualMarkdownForSpeech("This is _important_.")).toBe("This is important.");
  });

  it("removes backticks, blockquotes, fences and horizontal rules", () => {
    expect(stripResidualMarkdownForSpeech("Run `npm test` now.")).toBe("Run npm test now.");
    expect(stripResidualMarkdownForSpeech("> A quoted line")).toBe("A quoted line");
    expect(stripResidualMarkdownForSpeech("A\n\n---\n\nB")).toBe("A\n\nB");
  });

  it("leaves an underscore inside a word alone", () => {
    expect(stripResidualMarkdownForSpeech("The post_op period")).toBe("The post_op period");
  });

  it("preserves Devanagari text and its punctuation", () => {
    const hi = "**कीमोथेरेपी** एक इलाज है। डॉक्टर से बात करें।";
    expect(stripResidualMarkdownForSpeech(hi)).toBe("कीमोथेरेपी एक इलाज है। डॉक्टर से बात करें।");
  });
});

describe("cleanForSpeech", () => {
  it("leaves nothing a synthesiser could read as a machine identifier", () => {
    const input =
      `**Biomarker tests** help choose treatment [citation:${KB_ID}:kb_2].\n\n` +
      `## Next steps\n- Ask your oncologist [citation:${KB_ID}:kb_`;

    const out = cleanForSpeech(input);

    expect(out).not.toContain("[citation:");
    expect(out).not.toContain("[source:");
    expect(out).not.toContain("kb_en_");
    expect(out).not.toContain("**");
    expect(out).not.toMatch(/^#{1,6}\s/m);
    expect(out).toContain("Biomarker tests");
    expect(out).toContain("Ask your oncologist");
  });
});
