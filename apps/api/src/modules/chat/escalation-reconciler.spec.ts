import { reconcileAppendedAnswer, statesEmergencyTriage } from "./escalation-reconciler";

/**
 * Issue #112 — the answer appended below an escalation must not restate
 * urgency thresholds.
 *
 * The fixture below is the shape of the appended half observed on live prod
 * (browser QA run 2026-09-10T19-02-52, q05, messageId f35aa46a). No patient
 * text is reproduced — the user question is not part of this fixture.
 */
describe("reconcileAppendedAnswer (issue #112)", () => {
  const CONTRADICTING_SENTENCE =
    "While a new lump is concerning and needs evaluation, it does not typically require an emergency call to 112 or 108 unless you have other severe, life-threatening symptoms.";

  const APPENDED_HALF = `**Educational answer**:
Finding a new lump or a thick, firm area in or near your breast is an unusual change that should be checked by a doctor. While most breast changes are not cancer, it is important to get them evaluated.

**What to do next**:
It's important to see a doctor promptly for any new or unusual breast changes. ${CONTRADICTING_SENTENCE}

1. **See a doctor**: Schedule an appointment with your general physician as soon as possible.
2. **Diagnostic tests**: Your doctor will likely recommend a diagnostic mammogram, ultrasound, and possibly a biopsy.`;

  it("removes the observed contradicting sentence", () => {
    const result = reconcileAppendedAnswer(APPENDED_HALF);

    expect(result.text).not.toContain("does not typically require an emergency call");
    expect(result.text).not.toMatch(/\b(?:112|108|102)\b/);
    expect(result.removed).toContain(CONTRADICTING_SENTENCE);
  });

  it("keeps the rest of the grounded answer intact", () => {
    const result = reconcileAppendedAnswer(APPENDED_HALF);

    expect(result.text).toContain("should be checked by a doctor");
    expect(result.text).toContain("see a doctor promptly");
    expect(result.text).toContain("Diagnostic tests");
    expect(result.text).toContain("**Educational answer**:");
  });

  it("removes reassurance that a symptom is not an emergency", () => {
    const result = reconcileAppendedAnswer(
      "A firm lump is common. This is not an emergency. Book an appointment this week."
    );

    expect(result.text).toBe("A firm lump is common. Book an appointment this week.");
  });

  it("removes an urgency restatement even when it agrees with the escalation", () => {
    // Once escalated, the escalation block is the only voice on urgency — a
    // reinforcing sentence is already printed verbatim above.
    const result = reconcileAppendedAnswer(
      "Chemotherapy can lower your white blood cell count. Call 108 for an ambulance if you develop a fever."
    );

    expect(result.text).toBe("Chemotherapy can lower your white blood cell count.");
    expect(result.removed).toHaveLength(1);
  });

  it("drops a whole list item that is only triage talk, marker included", () => {
    const result = reconcileAppendedAnswer(
      `1. **Watch for fever**: Take your temperature twice a day.
2. **Emergency**: Call 112 immediately if you cannot breathe.
3. **Bring your card**: Carry your Ayushman Bharat card.`
    );

    expect(result.text).not.toContain("112");
    expect(result.text).toContain("Take your temperature twice a day");
    expect(result.text).toContain("Carry your Ayushman Bharat card");
    expect(result.text.split("\n")).toHaveLength(2);
  });

  it("drops a section label left with no content under it", () => {
    const result = reconcileAppendedAnswer(
      `**Educational answer**:
Radiation can cause skin changes.

**When to seek emergency care**:
Call 112 right away.`
    );

    expect(result.text).toBe("**Educational answer**:\nRadiation can cause skin changes.");
  });

  it("returns empty text when the whole appended half was triage talk", () => {
    const result = reconcileAppendedAnswer(
      "Call 112 immediately. Go to the nearest hospital now."
    );

    expect(result.text).toBe("");
    expect(result.removed).toHaveLength(2);
  });

  it("leaves an answer with no urgency claims untouched", () => {
    const answer = `**Educational answer**:
A biopsy takes a small sample of tissue for testing.

**What to do next**:
1. Ask your doctor which type of biopsy is planned.
2. Ask when results will be ready.`;

    expect(reconcileAppendedAnswer(answer).text).toBe(answer);
    expect(reconcileAppendedAnswer(answer).removed).toHaveLength(0);
  });

  it("does not treat descriptive medical vocabulary as a triage statement", () => {
    // "life-threatening" as a description of a condition is information, not a
    // competing instruction about what the patient should do right now.
    expect(statesEmergencyTriage("Sepsis is a life-threatening infection.")).toBe(false);
    expect(statesEmergencyTriage("Some side effects are serious.")).toBe(false);
  });

  it("recognises the triage shapes it does cover", () => {
    expect(statesEmergencyTriage("You do not need to call 112 for this.")).toBe(true);
    expect(statesEmergencyTriage("This is not an emergency.")).toBe(true);
    expect(statesEmergencyTriage("Seek urgent care if it worsens.")).toBe(true);
    expect(statesEmergencyTriage("Go to the nearest hospital.")).toBe(true);
    expect(statesEmergencyTriage("An ambulance is not required.")).toBe(true);
    expect(statesEmergencyTriage("This does not require emergency care.")).toBe(true);
  });

  // ---------------------------------------------------------------------
  // #114 review — P1: negated emergency phrasings must not survive.
  // ---------------------------------------------------------------------
  describe("negated emergency phrasings (#114 review, P1)", () => {
    const NEGATED_PHRASES = [
      "This does not require emergency medical care.",
      "You do not need emergency medical care.",
      "There is no need to seek emergency medical care now.",
      "This is not an emergency.",
      "It's not typically an emergency department visit unless you have other severe symptoms.",
      "You are unlikely to need emergency medical attention for this.",
      "This isn't a medical emergency.",
      "An ambulance is not needed.",
      "No need to call 112 or 108 for this.",
      "This doesn't require emergency care.",
      "It is not an emergency room visit.",
      "You don't need emergency services right now.",
    ];

    it.each(NEGATED_PHRASES)("matches %s", (phrase) => {
      expect(statesEmergencyTriage(phrase)).toBe(true);
    });

    it.each(NEGATED_PHRASES)("removes %s from the appended half", (phrase) => {
      const result = reconcileAppendedAnswer(`A biopsy takes a small tissue sample. ${phrase}`);

      expect(result.text).toBe("A biopsy takes a small tissue sample.");
      expect(result.removed).toEqual([phrase]);
    });

    it("removes the exact live-prod downgrade reported in issue #112", () => {
      // Observed 2026-09-10 (browser QA run, q05). No patient text reproduced.
      const live =
        "It's not typically an emergency department visit unless you have other severe, life-threatening symptoms.";

      expect(statesEmergencyTriage(live)).toBe(true);
      expect(reconcileAppendedAnswer(`A new lump should be evaluated. ${live}`).text).toBe(
        "A new lump should be evaluated."
      );
    });

    it("also removes the reinforcing polarity of the same phrase shapes", () => {
      expect(statesEmergencyTriage("Seek emergency medical care immediately.")).toBe(true);
      expect(statesEmergencyTriage("Go for emergency medical attention now.")).toBe(true);
      expect(statesEmergencyTriage("This is a medical emergency.")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // #114 review — P2: bold-only lines are not automatically headings.
  // ---------------------------------------------------------------------
  describe("bold lines that are sentences, not headings (#114 review, P2)", () => {
    it("keeps a terminal bold factual line", () => {
      const answer = `**Educational answer**:
Chemotherapy is given in cycles.

**Do not stop treatment without speaking to your doctor.**`;

      const result = reconcileAppendedAnswer(answer);

      expect(result.text).toContain("**Do not stop treatment without speaking to your doctor.**");
      expect(result.removed).toHaveLength(0);
    });

    it("keeps an answer that is nothing but one bold factual line", () => {
      // A bold-only answer used to collapse to empty text, which made
      // ChatService discard the whole grounded half.
      const answer = "**Do not stop treatment without speaking to your doctor.**";

      expect(reconcileAppendedAnswer(answer).text).toBe(answer);
    });

    it("keeps a bold Devanagari sentence ending in a danda", () => {
      const answer = "**\u0921\u0949\u0915\u094D\u091F\u0930 \u0938\u0947 \u092C\u093E\u0924 \u0915\u093F\u090F \u092C\u093F\u0928\u093E \u0907\u0932\u093E\u091C \u0928\u093E \u0930\u094B\u0915\u0947\u0902\u0964**";

      expect(reconcileAppendedAnswer(answer).text).toBe(answer);
    });

    it("keeps a long bold line that is prose rather than a heading", () => {
      const answer =
        "**Your care team will decide the schedule that fits your blood counts and overall health**";

      expect(reconcileAppendedAnswer(answer).text).toBe(answer);
    });

    it("still drops a genuine heading left with no content under it", () => {
      const result = reconcileAppendedAnswer(
        `**Educational answer**:
Radiation can cause skin changes.

**When to seek emergency care**:
Call 112 right away.`
      );

      expect(result.text).toBe("**Educational answer**:\nRadiation can cause skin changes.");
    });

    it("drops a colon-less heading from the known vocabulary when it is empty", () => {
      const result = reconcileAppendedAnswer(
        `**Educational answer**:
Radiation can cause skin changes.

**Red flags**
Call an ambulance immediately.`
      );

      expect(result.text).toBe("**Educational answer**:\nRadiation can cause skin changes.");
    });
  });

  // ---------------------------------------------------------------------
  // #114 review — P2: emergency-number stripping needs a dialling context.
  // ---------------------------------------------------------------------
  describe("emergency numbers need a dialling context (#114 review, P2)", () => {
    it("keeps fever guidance that mentions a temperature of 102", () => {
      const fever =
        "Contact your oncology team the same day if your temperature reaches 102\u00B0F or higher.";

      expect(statesEmergencyTriage(fever)).toBe(false);
      expect(reconcileAppendedAnswer(fever).text).toBe(fever);
    });

    it.each([
      "Tell your doctor if your temperature reaches 102 degrees or more.",
      "A reading above 102 F means you should let your care team know.",
      "Fever is defined as 102\u00B0F or higher on an oral thermometer.",
    ])("keeps %s", (sentence) => {
      expect(statesEmergencyTriage(sentence)).toBe(false);
    });

    it.each([
      "Call 112 immediately.",
      "Dial 108 for an ambulance.",
      "You do not need to call 112 for this.",
      "It does not typically require an emergency call to 112 or 108.",
      "Phone the national emergency number 112 without delay.",
      "108 is the ambulance helpline in Bihar.",
    ])("still removes %s", (sentence) => {
      expect(statesEmergencyTriage(sentence)).toBe(true);
    });
  });

  it("does not catch a downgrade phrased without any urgency marker", () => {
    // Documented limit, not an oversight: a timeline-only downgrade survives.
    // Closing this class needs the generator to know the turn escalated, which
    // is a prompt change and therefore an SCCF decision.
    const softDowngrade = "You should see a doctor within a week or two.";

    expect(statesEmergencyTriage(softDowngrade)).toBe(false);
    expect(reconcileAppendedAnswer(softDowngrade).text).toBe(softDowngrade);
  });
});
