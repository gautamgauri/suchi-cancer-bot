import { ResponseTemplates } from "./response-templates";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

describe("ResponseTemplates.explainModeFrame — no 'undefined' leaks", () => {
  const chunks: EvidenceChunk[] = [];
  const q = "What tests are used?";

  // Pre-launch gate: a user-facing answer must never contain a literal
  // "undefined" (seen for subject-less / thin-evidence queries when the model
  // produced no content).
  it("returns a safe fallback (no 'undefined') when content is undefined", () => {
    const out = ResponseTemplates.explainModeFrame(undefined as unknown as string, q, chunks);
    expect(out).not.toContain("undefined");
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toMatch(/couldn'?t|sorry/);
  });

  it("returns a safe fallback for empty / whitespace content", () => {
    expect(ResponseTemplates.explainModeFrame("", q, chunks)).not.toContain("undefined");
    expect(ResponseTemplates.explainModeFrame("   \n  ", q, chunks).trim().length).toBeGreaterThan(0);
  });

  it("returns a safe fallback when content is the literal string 'undefined'", () => {
    const out = ResponseTemplates.explainModeFrame("undefined", q, chunks);
    expect(out).not.toContain("undefined");
    expect(out.toLowerCase()).toMatch(/couldn'?t|sorry/);
  });

  it("preserves real model content", () => {
    const out = ResponseTemplates.explainModeFrame(
      "Diagnosis may involve a CT scan and biopsy.",
      q,
      chunks,
    );
    expect(out).toContain("Diagnosis may involve a CT scan and biopsy.");
  });
});

// Issue #260: the navigation template quotes only numbers in the verified
// financial support file. The PM-JAY helpline stays. The Indian Cancer Society
// number is not in the verified reference, and the Tata Memorial switchboard
// was labelled a helpline; hospital numbers now come from the directory.
describe("ResponseTemplates.N1 — verified numbers only (#260)", () => {
  it("keeps the PM-JAY helpline and drops the unverified numbers", () => {
    const out = ResponseTemplates.N1({} as any);
    expect(out).toContain("14555");
    expect(out).not.toContain("1800-22-1951");
    expect(out).not.toContain("022-24177000");
  });
});
