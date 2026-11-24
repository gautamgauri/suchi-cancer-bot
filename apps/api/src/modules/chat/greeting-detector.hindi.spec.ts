import { GreetingDetector } from "./greeting-detector";
import { isHindiOrBilingualGreeting } from "./greeting-phrases";
import { IntentClassifier } from "./intent-classifier";
import { AbstentionService } from "../abstention/abstention.service";

/**
 * Hindi, Hinglish and the website's bilingual WhatsApp greeting.
 *
 * Before this change the site greeting (a Devanagari line, then an English
 * line) was not a greeting, and the intent classifier sent it to an
 * abstention. The English patterns are untouched. This file checks the new
 * forms and that the matcher stays strict.
 */

/** The site greeting as the pipeline sees it, after the `(src: ...)` line is stripped. */
const SITE_GREETING = "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.";

const OK_GATE = {
  status: "ok",
  approvedChunks: [],
  reasonCode: null,
  shouldAbstain: false,
  confidence: "high",
  quality: "strong",
} as any;

describe("GreetingDetector: Hindi, Hinglish and the site greeting", () => {
  it("recognises the site greeting", () => {
    expect(GreetingDetector.isGreeting(SITE_GREETING)).toBe(true);
  });

  it("recognises each line of the site greeting on its own", () => {
    expect(GreetingDetector.isGreeting("नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।")).toBe(true);
    expect(GreetingDetector.isGreeting("Hello Suchi, I would like some information.")).toBe(true);
  });

  it.each([
    "नमस्ते",
    "नमस्ते सुचि",
    "नमस्ते जी",
    "नमस्ते 🙏",
    "🙏 नमस्ते सुचि जी",
    "नमस्कार",
    "प्रणाम",
    "प्रणाम जी",
    "हेलो",
    "हैलो सुचि",
    "हाय",
    "namaste ji",
    "namastey",
    "namaskar suchi",
    "pranam",
    "pranaam ji",
    "hi suchi",
    "helo",
    "Hello Suchi",
    "hello, hello",
    "namaste suchi, mujhe kuch jaankari chahiye",
    "Namaste Suchi! Mujhe kuchh jankari chahie.",
    "नमस्ते​ सुचि", // zero-width space
  ])("recognises %s", (text) => {
    expect(GreetingDetector.isGreeting(text)).toBe(true);
  });

  it("still recognises the existing English greetings", () => {
    for (const text of ["hi", "hello", "hey!", "good morning", "hi there how are you", "namaste", "🙏"]) {
      expect(GreetingDetector.isGreeting(text)).toBe(true);
    }
  });

  // A greeting followed by anything beyond the fixed greeting words is not a greeting.
  it.each([
    "नमस्ते सुचि, मुझे कैंसर के बारे में जानकारी चाहिए",
    "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए। स्तन कैंसर के लक्षण क्या हैं?",
    "नमस्ते, छाती में बहुत तेज दर्द",
    "नमस्ते, खून बहुत आ रहा है",
    "नमस्ते सुचि, सांस नहीं आ रही",
    "नमस्ते, मैं मरना चाहता हूँ",
    "नमस्ते सुचि, क्या आप मदद करेंगी?",
    "हाई बीपी",
    "Hello Suchi, I would like some information about chemotherapy.",
    "Hello Suchi, I would like some information.\nMy mother has fainted and is unconscious",
    "hello suchi seene mein bahut tez dard",
    "pranam, khoon ruk nahi raha",
    "नमस्ते सुचि\n(src: WA-HEADER)", // an invalid source line is left in, so not a greeting
    "जानकारी चाहिए",
    "सुचि",
    "मुझे कुछ जानकारी चाहिए",
    // Pinned as not a greeting by chat.service.slow-turn-fallback.spec.ts.
    "Hii",
  ])("does not treat %s as a greeting", (text) => {
    expect(GreetingDetector.isGreeting(text)).toBe(false);
  });

  it("does not accept more than three greeting parts or long text", () => {
    expect(isHindiOrBilingualGreeting("नमस्ते नमस्ते नमस्ते")).toBe(true);
    expect(isHindiOrBilingualGreeting("नमस्ते नमस्ते नमस्ते नमस्ते")).toBe(false);
    expect(isHindiOrBilingualGreeting("नमस्ते " + "जी ".repeat(200))).toBe(false);
  });

  it("returns quickly on a 5,000-character input", () => {
    const inputs = [
      "नमस्ते सुचि " + "जी ".repeat(1_662),
      "नमस्ते " + "क".repeat(4_993),
      "hello " + ", ".repeat(2_497),
      "नमस्ते" + "​".repeat(4_994),
      SITE_GREETING + "x".repeat(5_000 - SITE_GREETING.length),
    ];
    for (const text of inputs) {
      expect(text.length).toBeGreaterThanOrEqual(4_990);
      const started = process.hrtime.bigint();
      expect(isHindiOrBilingualGreeting(text)).toBe(false);
      GreetingDetector.isGreeting(text);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      expect(ms).toBeLessThan(50);
    }
  });
});

describe("IntentClassifier: the second caller of GreetingDetector", () => {
  const classifier = new IntentClassifier(new AbstentionService());

  it("classifies the site greeting as GREETING_ONLY", () => {
    expect(classifier.classify(SITE_GREETING, [], OK_GATE, "normal").intent).toBe("GREETING_ONLY");
  });

  it("classifies a Devanagari greeting as GREETING_ONLY", () => {
    expect(classifier.classify("नमस्ते सुचि", [], OK_GATE, "normal").intent).toBe("GREETING_ONLY");
  });

  it("still puts urgency and safety ahead of a greeting", () => {
    expect(classifier.classify(SITE_GREETING, [], OK_GATE, "self_harm").intent).toBe("SAFETY_RESTRICTED");
    const urgent = classifier.classify("नमस्ते सुचि, fever above 102 and on chemo", [], OK_GATE, "normal");
    expect(urgent.intent).not.toBe("GREETING_ONLY");
  });
});
