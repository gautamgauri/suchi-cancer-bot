import { ChatService } from "./chat.service";

/**
 * Issue #175 — `injectEssentialTermsIfMissing` appended the `essentialTerms.breast`
 * notes (mammogram / "biopsy confirms breast cancer" / breast ultrasound) to an
 * answer whose body was entirely about prostate cancer, because the cancer type
 * it was handed came from a stale session tag.
 *
 * The injector only ever asked "is this term present?", never "is this the same
 * disease?". These tests pin the disease-consistency guard: disease-specific
 * notes are dropped when the answer is about a different cancer, and are still
 * added when the answer is about the right one.
 *
 * The method uses no instance state, so it is exercised off the prototype (the
 * pattern used by chat.service.hospital-context.spec.ts).
 */
const svc: any = Object.create(ChatService.prototype);
const inject = (text: string, cancerType: string | null, queryType: string): string =>
  svc.injectEssentialTermsIfMissing(text, cancerType, queryType);

// A prostate-framed answer shaped like the delivered reply in the issue:
// correct body, then the injection point.
const PROSTATE_ANSWER = [
  "**Important:** This information is for general educational purposes and is not a diagnosis.",
  "",
  "Treatment options for prostate cancer depend significantly on the stage of the cancer.",
  "There are specific approaches for Stage I, Stage II and Stage III prostate cancer.",
  "",
  "**What to do next:** Consult an oncologist or urologist to understand the options available.",
].join("\n");

// The same shape for an oral-cancer turn — the type most likely to reach this
// injector on a stale session in Bihar, where oral cancer is the commonest
// cancer in men.
const ORAL_ANSWER = [
  "**Important:** This information is for general educational purposes and is not a diagnosis.",
  "",
  "Treatment for oral cancer depends on the stage of the disease and the site of the lesion.",
  "A biopsy confirms the diagnosis before surgery or radiotherapy is planned.",
  "",
  "**What to do next:** Consult an oncologist who treats oral cancer.",
].join("\n");

describe("injectEssentialTermsIfMissing — disease consistency (issue #175)", () => {
  it("does not splice breast screening notes into a prostate answer", () => {
    const out = inject(PROSTATE_ANSWER, "breast", "treatment");

    expect(out).not.toMatch(/mammogra/i);
    expect(out).not.toMatch(/breast/i);
    // Nothing disease-specific was missing-and-appendable, and the universal
    // terms (oncologist, staging) are already present, so the text is untouched.
    expect(out).toBe(PROSTATE_ANSWER);
  });

  it("still appends the matching cancer's notes when the type is right", () => {
    const out = inject(PROSTATE_ANSWER, "prostate", "treatment");

    expect(out).toMatch(/\*\*Key points to be aware of:\*\*/);
    expect(out).toMatch(/PSA/);
    expect(out).toMatch(/Prostate biopsy/i);
    // Inserted above the closing section, not tacked on after it.
    expect(out.indexOf("Key points to be aware of")).toBeLessThan(out.indexOf("What to do next"));
  });

  it("does not splice breast screening notes into an oral-cancer answer", () => {
    const out = inject(ORAL_ANSWER, "breast", "treatment");

    expect(out).not.toMatch(/mammogra/i);
    expect(out).not.toMatch(/breast/i);
    expect(out).toBe(ORAL_ANSWER);
  });

  it("still appends the oral notes when the type is right", () => {
    const out = inject(ORAL_ANSWER, "oral", "treatment");

    expect(out).toMatch(/\*\*Key points to be aware of:\*\*/);
    expect(out).toMatch(/tobacco and gutka/i);
  });

  it("keeps the disease-agnostic notes when the disease-specific ones are dropped", () => {
    const answerMissingOncologist = "Treatment for prostate cancer depends on the stage of disease.";

    const out = inject(answerMissingOncologist, "breast", "treatment");

    expect(out).not.toMatch(/mammogra|breast/i);
    expect(out).toMatch(/\*\*Key points to be aware of:\*\*/);
    expect(out).toMatch(/oncologist \(cancer specialist\)/i);
  });

  it("injects normally when the answer names no cancer type at all", () => {
    const genericAnswer = "Screening tests can find disease early. Talk to your doctor about what is right for you.";

    const out = inject(genericAnswer, "breast", "screening");

    expect(out).toMatch(/Mammogram \(breast X-ray\)/);
  });

  it("is unchanged for a null cancer type or an irrelevant query type", () => {
    expect(inject(PROSTATE_ANSWER, null, "treatment")).toBe(PROSTATE_ANSWER);
    expect(inject(PROSTATE_ANSWER, "prostate", "emergency")).toBe(PROSTATE_ANSWER);
  });
});
