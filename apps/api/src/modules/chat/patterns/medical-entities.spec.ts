import { getAllPatterns, PatternEntry } from "./medical-entities";

/**
 * Registry-level guards.
 *
 * `valueBearing` is a SAFETY flag: it tells ResponseValidatorService that a
 * match carries a clinical value (a figure, a percentage, a stage, a
 * duration) and must therefore be grounded on the exact surface string, not
 * on the surrounding concept. Forgetting it on a numeric pattern lets the
 * model assert a number the evidence never states — which is how a fabricated
 * prognosis figure reached a draft answer during the #179 review.
 *
 * These tests exist so a new numeric pattern cannot be added without that
 * decision being made explicitly.
 */
describe("medical entity registry", () => {
  const patterns = getAllPatterns();

  const describePattern = (p: PatternEntry) => `${p.key} (${p.regex.source})`;

  it("marks every pattern that can capture a number as valueBearing", () => {
    const numeric = patterns.filter(p => /\\d/.test(p.regex.source));

    // Guard the guard: if this ever drops to zero the assertion below is vacuous.
    expect(numeric.length).toBeGreaterThan(0);

    const unflagged = numeric.filter(p => !p.valueBearing).map(describePattern);
    expect(unflagged).toEqual([]);
  });

  it("marks the cancer stage pattern as valueBearing", () => {
    // `stage` carries its value in a character class rather than \d.
    const stage = patterns.find(p => p.key === "stage");
    expect(stage?.valueBearing).toBe(true);
  });

  it("marks the prose survival-rate patterns as valueBearing", () => {
    // "survival rate" is the phrase a prognosis figure hangs off; grounding it
    // at concept level lets "survival depends on many factors" ground
    // "the 5-year survival rate is about 92%".
    for (const key of ["survival_rate", "survival_percent", "survival_statistic"]) {
      const entry = patterns.find(p => p.key === key);
      expect(entry).toBeDefined();
      expect(entry?.valueBearing).toBe(true);
    }
  });

  it("does not flag patterns whose digits are part of a test NAME", () => {
    // CA-125 / CA 19-9 are marker names, not measured values — flagging them
    // would cost grounding for no safety gain.
    for (const key of ["ca125", "ca199"]) {
      const entry = patterns.find(p => p.key === key);
      expect(entry).toBeDefined();
      expect(entry?.valueBearing).toBeFalsy();
    }
  });

  it("keeps pattern keys unique", () => {
    const keys = patterns.map(p => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
