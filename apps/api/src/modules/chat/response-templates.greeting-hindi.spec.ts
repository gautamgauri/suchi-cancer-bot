import { ResponseTemplates } from "./response-templates";
import * as greetingPhrases from "./greeting-phrases";
import { greetingReplyLanguage, isHindiGreetingText } from "./greeting-phrases";

/**
 * First-greeting replies by the greeting's language:
 * - a Hindi line and an English line (the site's message): Hindi, then English
 * - Devanagari or romanised Hindi only: Hindi (G1Hindi)
 * - anything else: the English G1, unchanged
 * No other template's selection changes.
 */

const SITE_GREETING = "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.";

const G1_TEXT =
  "Hi. I'm Suchi, the Suchitra Cancer Bot. How can I help today?\n\nIs this about symptoms, a report, treatment side effects, or finding care?";
const G1_HINDI_TEXT =
  "नमस्ते। मैं सुचि हूँ, सुचित्रा कैंसर केयर फ़ाउंडेशन की कैंसर जानकारी बॉट। आज मैं आपकी क्या मदद कर सकती हूँ?" +
  "\n\n" +
  "क्या आपका सवाल लक्षणों, किसी जाँच रिपोर्ट, इलाज के साइड इफ़ेक्ट, या अस्पताल और डॉक्टर ढूँढने के बारे में है?";
const G1_BILINGUAL_TEXT = G1_HINDI_TEXT + "\n\n" + G1_TEXT;

const ctx = { isFirstMessage: true, userText: "" };
const first = (userText: string) => ResponseTemplates.selectTemplate("GREETING_ONLY", { isFirstMessage: true, userText });

describe("Greeting templates", () => {
  it("pins the Hindi welcome character for character, in G1's two-paragraph layout", () => {
    expect(ResponseTemplates.G1Hindi(ctx)).toBe(G1_HINDI_TEXT);
    expect(G1_HINDI_TEXT.split("\n\n")).toHaveLength(2);
  });

  it("pins the two-language welcome: Hindi, a blank line, then the English G1", () => {
    expect(ResponseTemplates.G1Bilingual(ctx)).toBe(G1_BILINGUAL_TEXT);
  });

  it("leaves the English G1 unchanged", () => {
    expect(ResponseTemplates.G1(ctx)).toBe(G1_TEXT);
  });

  it("spells the bot's name सुचि and uses no other Devanagari spelling of it", () => {
    for (const text of [ResponseTemplates.G1Hindi(ctx), ResponseTemplates.G1Bilingual(ctx)]) {
      // Every स + (ु or ू) + च + vowel sign must be सुचि (also the start of सुचित्रा).
      const forms = text.match(/स[ुू]च[ा-ौ]?/g) ?? [];
      expect(forms.length).toBeGreaterThan(0);
      for (const form of forms) expect(form).toBe("सुचि");
      for (const wrong of ["सुची", "सूचि", "सूची"]) expect(text).not.toContain(wrong);
    }
    expect(G1_HINDI_TEXT).toContain("मैं सुचि हूँ");
  });

  it("says Suchi is a bot and speaks in the feminine", () => {
    expect(G1_HINDI_TEXT).toContain("बॉट");
    expect(G1_HINDI_TEXT).toContain("कर सकती हूँ");
    expect(G1_HINDI_TEXT).not.toMatch(/सकता हूँ|देता हूँ/);
  });
});

describe("GREETING_ONLY template selection by the greeting's language", () => {
  it("the site greeting gets Hindi then English", () => {
    expect(greetingReplyLanguage(SITE_GREETING)).toBe("both");
    expect(first(SITE_GREETING)).toBe(G1_BILINGUAL_TEXT);
    expect(first(SITE_GREETING.replace("चाहिए", "चाहिये"))).toBe(G1_BILINGUAL_TEXT);
    expect(first("नमस्ते सुचि\nhello")).toBe(G1_BILINGUAL_TEXT);
  });

  it.each(["नमस्ते", "नमस्ते सुचि", "नमस्कार", "प्रणाम जी", "हेलो", "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।", "namaste", "Namaste!", "namaskar", "pranam ji", "namaste suchi"])(
    "%s gets Hindi only",
    (text) => {
      expect(first(text)).toBe(G1_HINDI_TEXT);
    },
  );

  it.each(["hello", "hi", "Hi", "hey", "Hello Suchi", "Hello Suchi, I would like some information.", "good morning", "👋"])(
    "%s gets the English G1 only",
    (text) => {
      expect(first(text)).toBe(G1_TEXT);
    },
  );

  it("a later greeting still gets the English G2", () => {
    const g2 = ResponseTemplates.G2({ isFirstMessage: false, userText: "" });
    for (const userText of ["नमस्ते", "hello", SITE_GREETING]) {
      expect(ResponseTemplates.selectTemplate("GREETING_ONLY", { isFirstMessage: false, userText })).toBe(g2);
    }
  });

  it("does not change how other templates are chosen for Hindi text", () => {
    const intents = ["SYMPTOMS_URGENT_RED_FLAGS", "INSUFFICIENT_EVIDENCE", "MISSING_CONTEXT", "SAFETY_RESTRICTED", "UNCLEAR_REQUEST"];
    const c = { isFirstMessage: true, userText: SITE_GREETING, locale: "hi" };
    const now = intents.map((intent) => ResponseTemplates.selectTemplate(intent, { ...c }));
    // The same calls with the language choice switched off, as on main.
    const spy = jest.spyOn(greetingPhrases, "greetingReplyLanguage").mockReturnValue("en");
    const asOnMain = intents.map((intent) => ResponseTemplates.selectTemplate(intent, { ...c }));
    spy.mockRestore();
    expect(now).toEqual(asOnMain);
    for (const text of now) expect([G1_HINDI_TEXT, G1_BILINGUAL_TEXT]).not.toContain(text);
  });
});

describe("isHindiGreetingText and greetingReplyLanguage", () => {
  it("are quick on long input", () => {
    const started = process.hrtime.bigint();
    expect(isHindiGreetingText("hello " + "x ".repeat(2_500))).toBe(false);
    expect(greetingReplyLanguage("नमस्ते\n" + "hello ".repeat(800))).toBe("hi");
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(50);
  });
});
