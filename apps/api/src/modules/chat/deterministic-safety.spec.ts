import { AbstentionService } from "../abstention/abstention.service";
import { SafetyService } from "../safety/safety.service";
import {
  SAFETY_TAIL_LENGTH,
  flaggedByDeterministicSafetyChecks,
  isUrgentSafetyText,
  safetyBypassCategory,
  screenWholeMessage,
} from "./deterministic-safety";
import { MAX_USER_TEXT_HARD_LIMIT } from "./dto";
import { EmpathyDetector } from "./empathy-detector";

/**
 * The shared safety screen on long messages (PR #202). Every caller (the
 * pipeline, the WhatsApp stale guard and no-session reply, the rate limiter)
 * screens the first 20,000 characters and, for a longer message, its last
 * 4,096 characters as well. Synthetic text.
 */
const FILLER = "I have some questions about my treatment plan. ";
const HI_FILLER = "मेरे इलाज के बारे में कुछ सवाल हैं। ";
const SELF_HARM = "I want to kill myself";
const deps = { safety: new SafetyService(), abstention: new AbstentionService(), empathy: new EmpathyDetector() };

const padTo = (filler: string, n: number) => filler.repeat(Math.ceil(n / filler.length)).slice(0, n);

describe("shared safety screen on long messages", () => {
  it.each([
    ["English, 9,400 characters", FILLER.repeat(200) + " " + SELF_HARM],
    ["Devanagari, 14,000 characters", HI_FILLER.repeat(400) + " सांस नहीं आ रही"],
  ])("%s: a phrase inside the first 20,000 characters is caught by every caller", (_n, text) => {
    expect(text.length).toBeLessThanOrEqual(MAX_USER_TEXT_HARD_LIMIT);
    expect(flaggedByDeterministicSafetyChecks(text)).toBe(true);
    expect(isUrgentSafetyText(text, "web")).toBe(true);
  });

  // Review F1: the tail of an over-long message is screened as well.
  it.each([30_000, 90_000])("a phrase at the very end of a %i character message is caught", (n) => {
    const text = padTo(FILLER, n - SELF_HARM.length - 1) + " " + SELF_HARM;
    expect(text.length).toBe(n);
    const m = screenWholeMessage(text, "web", undefined, deps);
    expect(m.text.length).toBeLessThanOrEqual(MAX_USER_TEXT_HARD_LIMIT);
    expect(m.fromTail).toBe(true);
    expect(m.screen.gate).toBe("safety");
    expect(m.screen.safety.classification).toBe("self_harm");
    expect(flaggedByDeterministicSafetyChecks(text)).toBe(true);
    expect(isUrgentSafetyText(text, "web")).toBe(true);
  });

  it("the more severe verdict wins between the head and the tail", () => {
    // Head: an urgency-only phrase. Tail: self-harm. The safety gate outranks urgency.
    const text = "coughed up blood. " + padTo(FILLER, 30_000) + " " + SELF_HARM;
    const m = screenWholeMessage(text, "web", undefined, deps);
    expect(m.screen.gate).toBe("safety");
    // Head: self-harm. Tail: urgency only. The head's verdict stands.
    const text2 = SELF_HARM + ". " + padTo(FILLER, 30_000) + " coughed up blood";
    const m2 = screenWholeMessage(text2, "web", undefined, deps);
    expect(m2.screen.gate).toBe("safety");
    expect(m2.fromTail).toBe(false);
  });

  it("known limit: a phrase only in the middle of a message longer than 24,096 characters is not screened", () => {
    const text = padTo(FILLER, 21_000) + " " + SELF_HARM + " " + padTo(FILLER, SAFETY_TAIL_LENGTH + 10);
    expect(text.length).toBeGreaterThan(MAX_USER_TEXT_HARD_LIMIT + SAFETY_TAIL_LENGTH);
    expect(screenWholeMessage(text, "web", undefined, deps).screen.gate).toBe("none");
  });

  it("an ordinary long message is flagged by none of them", () => {
    const text = padTo(FILLER, 30_000);
    expect(flaggedByDeterministicSafetyChecks(text)).toBe(false);
    expect(safetyBypassCategory(text, "web")).toBeNull();
  });

  // Review F2: urgency messages get their own, lower bypass cap.
  it("classifies the limiter bypass: critical, urgency or none", () => {
    expect(safetyBypassCategory("I am coughing up blood right now", "web")).toBe("critical");
    expect(safetyBypassCategory(SELF_HARM, "web")).toBe("critical");
    expect(safetyBypassCategory("I don't want to live anymore", "web")).toBe("critical");
    expect(safetyBypassCategory("coughed up blood", "web")).toBe("urgency");
    expect(safetyBypassCategory("what dose of tamoxifen should I take", "web")).toBeNull();
    expect(safetyBypassCategory("what is chemotherapy?", "web")).toBeNull();
  });
});
