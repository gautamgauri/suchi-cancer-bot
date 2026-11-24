import { GreetingDetector } from "./greeting-detector";

/** Bound the input length for greeting detection (PR #202). */
describe("GreetingDetector input length bound", () => {
  it("still detects ordinary greetings", () => {
    expect(GreetingDetector.isGreeting("hi")).toBe(true);
    expect(GreetingDetector.isGreeting("hello how are you")).toBe(true);
    expect(GreetingDetector.isGreeting("namaste")).toBe(true);
  });

  it("treats text longer than 500 characters as not a greeting", () => {
    expect(GreetingDetector.MAX_GREETING_LENGTH).toBe(500);
    const long = "hello how are you " + "x".repeat(GreetingDetector.MAX_GREETING_LENGTH);
    expect(GreetingDetector.isGreeting(long)).toBe(false);
  });

  it("returns quickly on long padded input", () => {
    const inputs = ["hello " + "x".repeat(19_990), "namaste " + "y".repeat(19_990)];
    for (const text of inputs) {
      const started = process.hrtime.bigint();
      expect(GreetingDetector.isGreeting(text)).toBe(false);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      expect(ms).toBeLessThan(5);
    }
  });
});
