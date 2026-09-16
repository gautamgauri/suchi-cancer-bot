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

  /**
   * PR #156 review, P1 — "Require an actual diagnosis before marking biopsy
   * ownership".
   *
   * The first cut of FIRST_PERSON_DISEASE_OWNERSHIP matched `my (biopsy|
   * oncologist|surgery|results)`, so possessing a PENDING procedure counted as
   * proof of disease and routed to POST_DIAGNOSIS. That contract opens by
   * acknowledging the diagnosis ("I understand receiving a [cancer type]
   * diagnosis can be overwhelming") and then enumerates treatment options —
   * i.e. it tells an undiagnosed person, at the most frightened moment they
   * will ever have, that they have cancer. This is the highest-cost mistake
   * this classifier can make, so the assertion is on the harm (never
   * POST_DIAGNOSIS) rather than on any one replacement state.
   */
  describe("a pending procedure is not a diagnosis (PR #156 review, P1)", () => {
    it.each([
      // The exact string from the review finding.
      "My biopsy is scheduled tomorrow; what should I expect?",
      "My biopsy is next week — what happens during the procedure?",
      "I am waiting for my biopsy results.",
      "I have an appointment with an oncologist on Monday. What should I ask?",
      "My surgery is scheduled for Friday, what should I expect?",
      // Hinglish and Devanagari: the ownership sets are per-script, so the
      // narrowing has to hold in all three or the bug simply moves.
      "Meri biopsy kal hai, mujhe kya expect karna chahiye?",
      "मेरी बायोप्सी कल है, मुझे क्या उम्मीद करनी चाहिए?",
      "मेरी सर्जरी अगले हफ्ते है",
    ])("is never told they are diagnosed: %s", (q) => {
      expect(state(q)).not.toBe(PatientState.POST_DIAGNOSIS);
    });

    it("the flagship case lands on a contract that assumes nothing", () => {
      // INFORMATIONAL carries no response contract at all, and SYMPTOMATIC's
      // contract explicitly forbids assuming a diagnosis. Either is safe;
      // today this text reaches INFORMATIONAL.
      expect(state("My biopsy is scheduled tomorrow; what should I expect?")).toBe(
        PatientState.INFORMATIONAL
      );
    });

    it("a lump one is still having looked at is a symptom, not a diagnosis", () => {
      expect(state("I have a lump in my breast, what should I do?")).toBe(
        PatientState.SYMPTOMATIC
      );
    });

    it("narrowing did not break actual diagnoses", () => {
      expect(state("I was diagnosed with breast cancer last week.")).toBe(
        PatientState.POST_DIAGNOSIS
      );
      expect(state("My chemotherapy starts next month.")).toBe(
        PatientState.POST_DIAGNOSIS
      );
      expect(state("My mastectomy is scheduled for next month.")).toBe(
        PatientState.POST_DIAGNOSIS
      );
      expect(state("My biopsy report says grade 2 — what does that mean?")).toBe(
        PatientState.POST_DIAGNOSIS
      );
    });
  });

  /**
   * PR #156 review, P2 — "Preserve patient routing for unlisted first-person
   * forms".
   *
   * The CAREGIVER early return was gated on the disease-ownership list, so a
   * diagnosed patient who mentioned a supporting relative in a form the list
   * did not enumerate was handed the caregiver contract: addressed as somebody
   * else's attendant, and given checklists and helplines instead of their own
   * treatment information.
   *
   * The gate is now self-reference, which is deliberately broader than
   * diagnosis ownership. The two findings pull in opposite directions and this
   * asymmetry is the resolution: proving WHO is speaking may be generous
   * (worst case: the routing this file had before issue #154), proving a
   * DIAGNOSIS must be strict (worst case: telling someone they have cancer).
   */
  describe("a patient who mentions a relative stays a patient (PR #156 review, P2)", () => {
    it.each([
      // The exact string from the review finding.
      "My wife wants to understand my treatment plan",
      "My daughter is asking about my chemo schedule.",
      "My son wants to know what my oncologist recommended.",
      "My husband will come with me to my radiation sessions.",
      "Meri patni mera treatment plan samajhna chahti hai",
      "मेरी पत्नी मेरे इलाज के बारे में जानना चाहती है",
    ])("routes to POST_DIAGNOSIS, not CAREGIVER: %s", (q) => {
      expect(state(q)).toBe(PatientState.POST_DIAGNOSIS);
    });

    it("the relative's own illness still reads as CAREGIVER", () => {
      // The discriminator is the possessive, not the relation word: "her
      // treatment plan" is the relative's, "my treatment plan" is the
      // speaker's.
      expect(state("My wife wants to understand her treatment plan")).toBe(
        PatientState.CAREGIVER
      );
    });

    it("self-reference alone does not manufacture a diagnosis", () => {
      // It suppresses CAREGIVER (who is speaking) without unlocking
      // POST_DIAGNOSIS (what is confirmed).
      expect(state("My mother had breast cancer. I found a lump last week.")).toBe(
        PatientState.SYMPTOMATIC
      );
    });
  });
});
