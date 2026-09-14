/**
 * Issue #154 — who is speaking must outrank what is wrong.
 *
 * `detect()` returns on the first matching tier. POST_DIAGNOSIS used to be
 * checked before CAREGIVER, and its markers ("stage 4", "diagnosed with", "my
 * report") are DISEASE FACTS that are equally true of a relative's illness. The
 * relation words are the only signal of who is asking, so every caregiver query
 * that mentioned a clinical fact was answered with the patient contract — and
 * the caregiver lost the action steps, the preparation checklist and the
 * support helplines, which exist only in the CAREGIVER contract.
 *
 * Fixtures cover English, Hinglish and Devanagari because the relation and
 * ownership cues differ per script, and because `\b` is ASCII-only and cannot
 * be used to anchor the Devanagari ones.
 */

import { PatientStateService, PatientState } from "./patient-state.service";

describe("patient-state speaker ownership (issue #154)", () => {
  const svc = new PatientStateService();
  const state = (t: string) => svc.detect(t).state;

  describe("the regression: a caregiver naming a clinical fact", () => {
    it.each([
      // The query from the #152 QA run that exposed this.
      "My uncle has stage 4 lung cancer. Exactly how many months does he have left?",
      // The most natural caregiver opening there is.
      "My father was diagnosed with breast cancer, what should I do?",
      "My mother's biopsy report shows grade 2. What does that mean?",
      "My wife is stage 3. What treatment options does she have?",
      "My brother was diagnosed with leukemia last week.",
    ])("routes to CAREGIVER, not POST_DIAGNOSIS: %s", (q) => {
      expect(state(q)).toBe(PatientState.CAREGIVER);
    });
  });

  describe("first-person disease ownership still wins", () => {
    it.each([
      "I have stage 4 lung cancer, what are my options?",
      "I was diagnosed with breast cancer last week.",
      "My biopsy report says grade 2 — what does that mean?",
      "My oncologist said I need chemotherapy.",
      "I'm a cancer patient and I want to understand my treatment plan.",
    ])("routes to POST_DIAGNOSIS: %s", (q) => {
      expect(state(q)).toBe(PatientState.POST_DIAGNOSIS);
    });

    it("a relation word does NOT hijack an explicit first-person claim", () => {
      // Both signals present; the speaker owns the illness.
      expect(state("My father had cancer and now I have stage 2")).toBe(
        PatientState.POST_DIAGNOSIS
      );
      expect(state("My mother died of breast cancer. I was diagnosed with it too.")).toBe(
        PatientState.POST_DIAGNOSIS
      );
    });
  });

  describe("Hinglish", () => {
    it.each([
      "Mere papa ko cancer hai, main kya karu?",
      "My bhai was diagnosed with cancer, what should I do?",
      "Meri maa ki biopsy report aayi hai, stage 2 hai",
    ])("caregiver: %s", (q) => {
      expect(state(q)).toBe(PatientState.CAREGIVER);
    });

    it("patient keeps POST_DIAGNOSIS when they own the illness", () => {
      expect(state("Mujhe cancer hai, ab kya hoga?")).toBe(PatientState.POST_DIAGNOSIS);
    });
  });

  describe("Devanagari", () => {
    it.each([
      "मेरे पिता को कैंसर है, मुझे क्या करना चाहिए?",
      "मेरी माँ का इलाज चल रहा है, कीमोथेरेपी के बारे में बताइए",
      "मेरे भाई की बायोप्सी रिपोर्ट आई है",
    ])("caregiver: %s", (q) => {
      expect(state(q)).toBe(PatientState.CAREGIVER);
    });

    it.each([
      "मुझे कैंसर है, आगे क्या होगा?",
      "मेरी रिपोर्ट में क्या लिखा है?",
    ])("patient: %s", (q) => {
      expect(state(q)).toBe(PatientState.POST_DIAGNOSIS);
    });

    it("does not rely on ASCII word boundaries", () => {
      // `\b` is meaningless against Devanagari; if the patterns regressed to
      // using it these would fall through to INFORMATIONAL.
      expect(state("मेरे पिता को कैंसर है")).not.toBe(PatientState.INFORMATIONAL);
      expect(state("मुझे कैंसर है")).not.toBe(PatientState.INFORMATIONAL);
    });
  });

  describe("higher and lower tiers are unaffected", () => {
    it("URGENT still outranks everything", () => {
      expect(
        state("My mother has cancer and suddenly she can't breathe properly")
      ).toBe(PatientState.URGENT);
    });

    it("a relation word with no cancer context does not become CAREGIVER", () => {
      expect(state("My father asked me to book an appointment")).not.toBe(
        PatientState.CAREGIVER
      );
    });

    it("general informational questions are untouched", () => {
      expect(state("What is a biopsy?")).toBe(PatientState.INFORMATIONAL);
      expect(state("What are the early signs of breast cancer?")).toBe(
        PatientState.INFORMATIONAL
      );
    });

    it("first-person symptom reports still route to SYMPTOMATIC", () => {
      expect(state("I found a lump in my breast last week")).toBe(
        PatientState.SYMPTOMATIC
      );
    });
  });
});
