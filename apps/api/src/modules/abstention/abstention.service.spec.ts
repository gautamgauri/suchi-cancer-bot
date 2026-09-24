/**
 * Unit tests for AbstentionService.
 *
 * This service is the safety net: when the evidence gate blocks the LLM, when
 * the LLM fails, or when citation enforcement fails, the user must still get a
 * safe, helpful, non-medical response — never a raw error or a guess.
 *
 * Covers FR-CHAT-004 / NFR-AVAIL-001 (failure → safe template) at the unit
 * level. The pure service has no dependencies, so it is instantiated directly.
 */

import { AbstentionService } from "./abstention.service";
import { AbstentionReason } from "../evidence/evidence-gate.service";
import { QueryType } from "../../config/trusted-sources.config";

const ALL_REASONS: AbstentionReason[] = [
  "insufficient_passages",
  "insufficient_sources",
  "untrusted_sources",
  "outdated_content",
  "conflicting_evidence",
  "no_evidence",
  "citation_validation_failed",
];

const ALL_QUERY_TYPES: QueryType[] = [
  "prevention",
  "screening",
  "treatment",
  "sideEffects",
  "symptoms",
  "caregiver",
  "navigation",
  "general",
];

describe("AbstentionService", () => {
  let service: AbstentionService;

  beforeEach(() => {
    service = new AbstentionService();
  });

  // ── Safe-but-Helpful structure ──────────────────────────────────────────

  describe("generateAbstentionMessage", () => {
    it("produces a non-empty Safe-but-Helpful message for every reason × queryType", () => {
      for (const reason of ALL_REASONS) {
        for (const queryType of ALL_QUERY_TYPES) {
          const msg = service.generateAbstentionMessage(reason, queryType);
          expect(msg.length).toBeGreaterThan(0);
          // 1. Safety boundary
          expect(msg).toContain("I want to be careful here");
          // 2. What Suchi can do
          expect(msg).toContain("What I can do right now:");
          expect(msg).toMatch(/•/);
        }
      }
    });

    it("includes the emergency numbers when the user message signals urgency", () => {
      const msg = service.generateAbstentionMessage(
        "no_evidence",
        "symptoms",
        "I have severe chest pain and trouble breathing",
      );
      expect(msg).toContain("112");
      expect(msg).toContain("108");
    });

    it("omits the emergency block for non-urgent messages", () => {
      const msg = service.generateAbstentionMessage(
        "no_evidence",
        "general",
        "what foods are good after treatment",
      );
      expect(msg).not.toContain("call **112**");
    });

    it("never asserts a diagnosis, cure, or specific medical instruction", () => {
      for (const reason of ALL_REASONS) {
        const msg = service.generateAbstentionMessage(reason, "treatment");
        expect(msg).not.toMatch(/you have (cancer|a tumou?r)/i);
        expect(msg).not.toMatch(/\bcured?\b/i);
        expect(msg).not.toMatch(/take \d+\s*mg/i);
      }
    });

    it("uses a reason-specific safety boundary for conflicting evidence", () => {
      const msg = service.generateAbstentionMessage("conflicting_evidence", "treatment");
      expect(msg).toContain("different perspectives");
    });
  });

  // ── Urgency detection ───────────────────────────────────────────────────

  describe("hasUrgencyIndicators", () => {
    it.each([
      "severe chest pain",
      "I can't breathe",
      "heavy bleeding",
      "she fainted",
      "fever during chemotherapy",
      "weakness on one side",
      "coughed up blood",
      "this is an emergency",
    ])("flags %p as urgent", (text) => {
      expect(service.hasUrgencyIndicators(text)).toBe(true);
    });

    it.each([
      "what is chemotherapy",
      "how do I prepare questions for my oncologist",
      "tell me about radiation therapy side effects",
    ])("does not flag %p as urgent", (text) => {
      expect(service.hasUrgencyIndicators(text)).toBe(false);
    });

    // ── #164: asking ABOUT an emergency is not reporting one ────────────────
    //
    // A bare `emergency|urgent|immediate|right now` pattern used to sit in this
    // list, so every one of these escalated to the S2 template — "call 112 /
    // 108" — and `end_conversation` closed the chat. Reproduced on production
    // before the fix: the lump question below returned red_flag, and the same
    // sentence without its final question returned a normal answer.
    it.each([
      "I found a new hard lump in my breast that wasn't there last week and it's painful. Is this an emergency?",
      "Is this an emergency?",
      "Is a headache an emergency?",
      "When is a cough NOT an emergency?",
      "what counts as an emergency during chemo",
      // negation — the old pattern fired on these too
      "I have a mild rash. This is not urgent, just curious.",
      "this is not an emergency but I wanted to ask",
      // our own KB phrases it this way; a user quoting it back used to escalate
      "the website said a lump should be evaluated immediately by a doctor",
    ])("does not escalate on the word alone: %p", (text) => {
      expect(service.hasUrgencyIndicators(text)).toBe(false);
    });

    // The declaration still escalates — this is the half worth keeping.
    it.each([
      "this is an emergency",
      "It is urgent, she is very weak",
      "this is an emergency, please help",
    ])("still flags a stated emergency: %p", (text) => {
      expect(service.hasUrgencyIndicators(text)).toBe(true);
    });

    // Genuine emergencies are described by symptom, never by vocabulary, so
    // none of these depend on the removed pattern.
    it.each([
      "she can't breathe properly and her face is swollen",
      "my mother is bleeding heavily after surgery",
      "he fainted this morning",
      "fever during chemotherapy",
    ])("still flags a described emergency: %p", (text) => {
      expect(service.hasUrgencyIndicators(text)).toBe(true);
    });
  });

  // ── Safe fallback response (LLM/evidence-gate failure path) ───────────────

  describe("generateSafeFallbackResponse", () => {
    it("contains no medical content — only referral + navigational resources", () => {
      const msg = service.generateSafeFallbackResponse("NO_RESULTS", "treatment");
      expect(msg).toContain("consult with your healthcare provider");
      expect(msg).toContain("cancer.gov");
      expect(msg).toContain("who.int");
      // Must not fabricate medical guidance
      expect(msg).not.toMatch(/\bcured?\b/i);
      expect(msg).not.toMatch(/take \d+\s*mg/i);
      expect(msg).not.toMatch(/you have cancer/i);
    });

    it.each(["NO_RESULTS", "LOW_TRUST", "INSUFFICIENT_CITATIONS", "LOW_SCORE"])(
      "adds reason-specific guidance for %s",
      (reasonCode) => {
        const msg = service.generateSafeFallbackResponse(reasonCode, "general");
        // base + resources always present; reason guidance makes it longer than base alone
        const base = service.generateSafeFallbackResponse("UNKNOWN_REASON", "general");
        expect(msg.length).toBeGreaterThan(base.length);
      },
    );

    it("returns the base safe message even for an unrecognized reason code", () => {
      const msg = service.generateSafeFallbackResponse("SOMETHING_ELSE", "general");
      expect(msg).toContain("don't have enough specific information");
      expect(msg).toContain("consult with your healthcare provider");
    });
  });

  // ── Clarifying questions (Rule B2) ────────────────────────────────────────

  describe("generateClarifyingQuestion", () => {
    it("asks about the cancer type for treatment queries", () => {
      const q = service.generateClarifyingQuestion("what treatment is best", "treatment");
      expect(q).toMatch(/cancer type or stage/i);
    });

    it("asks about the report type for report/scan queries", () => {
      const q = service.generateClarifyingQuestion("what does my scan mean", "general");
      expect(q).toMatch(/type of report or test/i);
    });

    it("falls back to a generic clarifier when nothing matches", () => {
      const q = service.generateClarifyingQuestion("hello there", "general");
      expect(q).toMatch(/bit more context/i);
    });
  });
});
