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

  it("does not catch a downgrade phrased without any urgency marker", () => {
    // Documented limit, not an oversight: a timeline-only downgrade survives.
    // Closing this class needs the generator to know the turn escalated, which
    // is a prompt change and therefore an SCCF decision.
    const softDowngrade = "You should see a doctor within a week or two.";

    expect(statesEmergencyTriage(softDowngrade)).toBe(false);
    expect(reconcileAppendedAnswer(softDowngrade).text).toBe(softDowngrade);
  });
});
