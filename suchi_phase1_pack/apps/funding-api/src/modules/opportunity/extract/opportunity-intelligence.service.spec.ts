import { OpportunityIntelligenceService } from "./opportunity-intelligence.service";
import type { OpportunityPayload } from "../opportunity.types";

describe("OpportunityIntelligenceService", () => {
  const service = new OpportunityIntelligenceService();

  const basePayload: OpportunityPayload = {
    opportunityId: "OPP-TEST",
    sourceType: "email",
    source: {
      emailMessageId: "msg-1",
      threadId: "thr-1",
      receivedAt: new Date().toISOString(),
      from: { email: "funder@example.org", name: "Funder Org" },
      to: ["team@example.org"],
      subject: "Education Grant Call 2026",
      attachments: [],
    },
    funder: {
      name: "Funder Org",
      programName: "Education Grant Call",
    },
    keyConstraints: {
      deadline: "2026-03-15T23:59:00+05:30",
      geography: ["India", "Bihar"],
      maxGrantAmountINR: 2500000,
    },
    themes: {
      primary: ["Education"],
      secondary: ["Youth skills"],
    },
  };

  it("produces stable dedupe id for repeated opportunities", () => {
    const keyA = service.buildDedupeKey({
      funder: "Funder Org",
      program: "Education Grant Call",
      deadline: "2026-03-15",
      geography: ["India", "Bihar"],
      sourceSubject: "Apply now: Education Grant Call",
    });
    const keyB = service.buildDedupeKey({
      funder: "funder org",
      program: " Education Grant  Call ",
      deadline: "2026-03-15T00:00:00.000Z",
      geography: ["bihar", "india"],
      sourceSubject: "Education Grant Call (repeat posting)",
    });

    expect(service.buildOpportunityId(keyA)).toBe(service.buildOpportunityId(keyB));
  });

  it("returns numeric score with at least 3 reasons", () => {
    const card = service.buildCard({
      payload: basePayload,
      constraints: {
        funderName: "Funder Org",
        programName: "Education Grant Call",
        deadline: "2026-03-15T23:59:00+05:30",
        geography: ["India", "Bihar"],
        themes: { primary: ["Education"], secondary: ["Youth"] },
        maxGrantAmountINR: 2500000,
      },
      rfpText: "FCRA required for foreign contributions.",
      sourceLink: "https://example.org/rfp",
    });

    const fit = service.buildFitAssessment({
      payload: basePayload,
      constraints: {
        funderName: "Funder Org",
        programName: "Education Grant Call",
        deadline: "2026-03-15T23:59:00+05:30",
        geography: ["India", "Bihar"],
        themes: { primary: ["Education"] },
        maxGrantAmountINR: 2500000,
      },
      card,
    });

    expect(typeof fit.score).toBe("number");
    expect(fit.score).toBeGreaterThanOrEqual(0);
    expect(fit.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(fit.reasons)).toBe(true);
    expect(fit.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts structured submission checklist from sample RFP text", () => {
    const checklist = service.buildSubmissionChecklist(`
Submission mode: Online portal submission only.
Narrative section: 800 words maximum.
Impact section - 500 words.
Budget must be submitted in Excel line-item format.
Attachments: registration certificate, audited financials, PAN card.
Annexure A: Budget template.
Annexure B: Monitoring framework.
`);

    expect(checklist.wordLimits.length).toBeGreaterThanOrEqual(2);
    expect(checklist.attachments.length).toBeGreaterThanOrEqual(2);
    expect(checklist.annexures.length).toBeGreaterThanOrEqual(2);
    expect(checklist.submissionMode).toBe("online portal");
    expect(checklist.budgetFormat).toBe("Excel/XLSX template");
    expect(checklist.items.length).toBeGreaterThan(0);
  });
});

