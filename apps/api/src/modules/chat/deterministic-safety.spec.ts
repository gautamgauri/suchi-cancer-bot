import { flaggedByDeterministicSafetyChecks, isUrgentSafetyText } from "./deterministic-safety";
import { MAX_USER_TEXT_HARD_LIMIT, MAX_USER_TEXT_LENGTH } from "./dto";

/**
 * Review B1 of PR #202: every caller of the shared screen sees the whole
 * message. A safety phrase beyond MAX_USER_TEXT_LENGTH must still be caught by
 * the WhatsApp stale guard and the rate limiter's bypass. Synthetic text.
 */
const LONG_EN_SELF_HARM = "I have some questions about my treatment plan. ".repeat(200) + " I want to kill myself";
const LONG_HI_EMERGENCY = "मेरे इलाज के बारे में कुछ सवाल हैं। ".repeat(400) + " सांस नहीं आ रही";
const LONG_ORDINARY = "I have some questions about my treatment plan. ".repeat(200);

describe("shared safety screen on long messages", () => {
  it.each([
    ["English", LONG_EN_SELF_HARM],
    ["Devanagari", LONG_HI_EMERGENCY],
  ])("%s: the phrase sits beyond the pipeline bound", (_name, text) => {
    expect(text.length).toBeGreaterThan(MAX_USER_TEXT_LENGTH);
    expect(text.length).toBeLessThan(MAX_USER_TEXT_HARD_LIMIT);
    expect(flaggedByDeterministicSafetyChecks(text.slice(0, MAX_USER_TEXT_LENGTH))).toBe(false);
  });

  it.each([
    ["English", LONG_EN_SELF_HARM],
    ["Devanagari", LONG_HI_EMERGENCY],
  ])("%s: the stale guard flags the whole message", (_name, text) => {
    expect(flaggedByDeterministicSafetyChecks(text)).toBe(true);
  });

  it.each([
    ["English", LONG_EN_SELF_HARM],
    ["Devanagari", LONG_HI_EMERGENCY],
  ])("%s: the limiter bypass sees the whole message", (_name, text) => {
    expect(isUrgentSafetyText(text, "web")).toBe(true);
  });

  it("an ordinary long message is flagged by neither", () => {
    expect(flaggedByDeterministicSafetyChecks(LONG_ORDINARY)).toBe(false);
    expect(isUrgentSafetyText(LONG_ORDINARY, "web")).toBe(false);
  });
});
