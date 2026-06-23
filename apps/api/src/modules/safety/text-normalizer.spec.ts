import { normalizeForMatch } from "./text-normalizer";

describe("normalizeForMatch", () => {
  it("strips zero-width characters", () => {
    expect(normalizeForMatch("kill​myself")).toBe("killmyself");
    expect(normalizeForMatch("कैंसर‍ है")).toBe("कैंसर है");
  });

  it("normalizes smart quotes/apostrophes to straight", () => {
    expect(normalizeForMatch("can’t cope")).toBe("can't cope");
    expect(normalizeForMatch("“cured”")).toBe('"cured"');
  });

  it("collapses whitespace", () => {
    expect(normalizeForMatch("a   b\n\nc")).toBe("a b c");
  });

  // FR-1: WhatsApp emphasis typing.
  it("collapses 3+ repeated letters but keeps legitimate doubles", () => {
    expect(normalizeForMatch("dardddd")).toBe("dard");
    expect(normalizeForMatch("naheeee")).toBe("nahe");
    expect(normalizeForMatch("gaanth")).toBe("gaanth"); // legit double 'aa'
    expect(normalizeForMatch("maa")).toBe("maa");
  });

  it("leaves digits intact (helpline / phone numbers survive)", () => {
    expect(normalizeForMatch("call 108 or 112")).toBe("call 108 or 112");
    expect(normalizeForMatch("1800-22-1951")).toBe("1800-22-1951");
  });

  // FR-1: Romanized medical-term folding -> canonical English.
  it("folds Romanized medical variants to the canonical English term", () => {
    expect(normalizeForMatch("mujhe kainsar hai")).toBe("mujhe cancer hai");
    expect(normalizeForMatch("keemo ke side effects")).toBe("chemo ke side effects");
    expect(normalizeForMatch("meri baipsi ho gayi")).toBe("meri biopsy ho gayi");
    expect(normalizeForMatch("radiyeshan kab shuru hoga")).toBe("radiation kab shuru hoga");
  });

  it("folds even with emphasis typing (collapse then fold)", () => {
    expect(normalizeForMatch("mujhe kainsarrr hai")).toBe("mujhe cancer hai");
  });

  it("does not touch already-canonical English terms", () => {
    expect(normalizeForMatch("you have cancer")).toBe("you have cancer");
    expect(normalizeForMatch("biopsy report")).toBe("biopsy report");
  });
});
