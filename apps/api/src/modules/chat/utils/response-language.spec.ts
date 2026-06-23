import { selectResponseLanguage, responseLanguageDirective } from "./response-language";
import { SYMPTOM_SOFT_REDIRECT_PROMPT } from "../../llm/prompts";

describe("selectResponseLanguage — reply in the user's dominant language", () => {
  it("English text -> en", () => {
    expect(selectResponseLanguage("what are the symptoms of breast cancer")).toBe("en");
    expect(selectResponseLanguage("I have a lump in my breast")).toBe("en");
  });

  it("Devanagari Hindi -> hi", () => {
    expect(selectResponseLanguage("मुझे पेट में दर्द हो रहा है")).toBe("hi");
    expect(selectResponseLanguage("कैंसर के लक्षण क्या हैं")).toBe("hi");
  });

  it("Romanized Hindi (Hinglish) -> hinglish", () => {
    expect(selectResponseLanguage("mujhe pet mein dard ho raha hai")).toBe("hinglish");
    expect(selectResponseLanguage("mujhko bukhar aur khansi hai")).toBe("hinglish");
  });

  it("clearly mixed English-Hindi -> hinglish", () => {
    // Latin + Devanagari in one message
    expect(selectResponseLanguage("breast cancer के लक्षण")).toBe("hinglish");
    // All-Latin but Hindi framing around an English medical term
    expect(selectResponseLanguage("mujhe breast mein lump hai")).toBe("hinglish");
  });

  it("unclear / too short -> unknown", () => {
    expect(selectResponseLanguage("")).toBe("unknown");
    expect(selectResponseLanguage("   ")).toBe("unknown");
    expect(selectResponseLanguage("123 456")).toBe("unknown");
    expect(selectResponseLanguage("ok")).toBe("unknown");
  });
});

describe("responseLanguageDirective", () => {
  it("gives a concrete, language-appropriate instruction", () => {
    expect(responseLanguageDirective("hi")).toMatch(/Hindi/);
    expect(responseLanguageDirective("hinglish")).toMatch(/Hinglish/i);
    expect(responseLanguageDirective("en")).toMatch(/English/);
    // Unknown → simple English + invite to choose
    expect(responseLanguageDirective("unknown")).toMatch(/English/);
    expect(responseLanguageDirective("unknown").toLowerCase()).toMatch(/invite|prefer|choose/);
  });
});

describe("SYMPTOM_SOFT_REDIRECT_PROMPT", () => {
  it("encodes the language policy (semantic, not brittle wording)", () => {
    expect(SYMPTOM_SOFT_REDIRECT_PROMPT.toLowerCase()).toContain("language");
    expect(SYMPTOM_SOFT_REDIRECT_PROMPT.toLowerCase()).toMatch(/hinglish|romanized/);
  });
});
