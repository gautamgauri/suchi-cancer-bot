import { ResponseTemplates } from "./response-templates";
import * as greetingPhrases from "./greeting-phrases";
import { isHindiGreetingText } from "./greeting-phrases";

/**
 * G1 in Hindi. A first greeting written in Devanagari or romanised Hindi gets
 * G1Hindi. Every other first greeting gets the English G1, unchanged. No
 * other template's selection changes.
 */

const SITE_GREETING = "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.";

const G1_TEXT =
  "Hi. I'm Suchi, the Suchitra Cancer Bot. How can I help today?\n\nIs this about symptoms, a report, treatment side effects, or finding care?";
const G1_HINDI_TEXT =
  "नमस्ते। मैं सुचि हूँ। मैं सुचित्रा कैंसर केयर फ़ाउंडेशन की ओर से कैंसर से जुड़ी जानकारी देती हूँ। आज मैं आपकी क्या मदद कर सकती हूँ?" +
  "\n\n" +
  "क्या आपका सवाल लक्षणों, किसी जाँच रिपोर्ट, इलाज के साइड इफ़ेक्ट या इलाज की जगह ढूँढने के बारे में है?";

const first = (userText: string) => ResponseTemplates.selectTemplate("GREETING_ONLY", { isFirstMessage: true, userText });

describe("G1Hindi: the Hindi first greeting", () => {
  it("is pinned character for character, in G1's two-paragraph layout", () => {
    expect(ResponseTemplates.G1Hindi({ isFirstMessage: true, userText: "" })).toBe(G1_HINDI_TEXT);
    expect(G1_HINDI_TEXT.split("\n\n")).toHaveLength(2);
  });

  it("leaves the English G1 unchanged", () => {
    expect(ResponseTemplates.G1({ isFirstMessage: true, userText: "" })).toBe(G1_TEXT);
  });

  it("spells the bot's name सुचि and uses no other Devanagari spelling of it", () => {
    const text = ResponseTemplates.G1Hindi({ isFirstMessage: true, userText: "" });
    // Every स + (ु or ू) + च + vowel sign must be सुचि (also the start of सुचित्रा).
    const forms = text.match(/स[ुू]च[ा-ौ]?/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) expect(form).toBe("सुचि");
    for (const wrong of ["सुची", "सूचि", "सूची"]) expect(text).not.toContain(wrong);
    expect(text).toContain("मैं सुचि हूँ");
  });

  it("speaks in the feminine", () => {
    expect(G1_HINDI_TEXT).toContain("देती हूँ");
    expect(G1_HINDI_TEXT).toContain("कर सकती हूँ");
    expect(G1_HINDI_TEXT).not.toMatch(/देता हूँ|सकता हूँ/);
  });
});

describe("GREETING_ONLY template selection by the greeting's language", () => {
  it.each([SITE_GREETING, "नमस्ते", "नमस्ते सुचि", "नमस्कार", "प्रणाम जी", "हेलो", "namaste", "Namaste!", "namaskar", "pranam ji", "namaste suchi"])(
    "%s gets the Hindi greeting",
    (text) => {
      expect(first(text)).toBe(G1_HINDI_TEXT);
    },
  );

  it.each(["hello", "hi", "Hi", "hey", "Hello Suchi", "Hello Suchi, I would like some information.", "good morning", "👋"])(
    "%s gets the English G1",
    (text) => {
      expect(first(text)).toBe(G1_TEXT);
    },
  );

  it("a later greeting still gets the English G2", () => {
    const g2 = ResponseTemplates.G2({ isFirstMessage: false, userText: "" });
    expect(ResponseTemplates.selectTemplate("GREETING_ONLY", { isFirstMessage: false, userText: "नमस्ते" })).toBe(g2);
    expect(ResponseTemplates.selectTemplate("GREETING_ONLY", { isFirstMessage: false, userText: "hello" })).toBe(g2);
  });

  it("does not change how other templates are chosen for Hindi text", () => {
    const intents = ["SYMPTOMS_URGENT_RED_FLAGS", "INSUFFICIENT_EVIDENCE", "MISSING_CONTEXT", "SAFETY_RESTRICTED", "UNCLEAR_REQUEST"];
    const ctx = { isFirstMessage: true, userText: "नमस्ते सुचि", locale: "hi" };
    const now = intents.map((intent) => ResponseTemplates.selectTemplate(intent, { ...ctx }));
    // The same calls with the language check switched off, as on main.
    const spy = jest.spyOn(greetingPhrases, "isHindiGreetingText").mockReturnValue(false);
    const asOnMain = intents.map((intent) => ResponseTemplates.selectTemplate(intent, { ...ctx }));
    spy.mockRestore();
    expect(now).toEqual(asOnMain);
    for (const text of now) expect(text).not.toBe(G1_HINDI_TEXT);
  });
});

describe("isHindiGreetingText", () => {
  it("is linear and quick on long input", () => {
    const started = process.hrtime.bigint();
    expect(isHindiGreetingText("hello " + "x ".repeat(2_500))).toBe(false);
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(50);
  });
});
