import {
  selectResponseLanguage,
  responseLanguageDirective,
  buildSymptomSoftRedirectPrompt,
} from "./response-language";
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

// Integration: classification -> the actual final prompt the pipeline sends.
// Closes the gap between language selection and patient-facing output (this is
// exactly what chat.service passes to llm.generate on the symptom-soft-redirect
// path).
describe("buildSymptomSoftRedirectPrompt — final prompt carries the right directive", () => {
  it("Romanized-Hindi symptom query -> final prompt has LANGUAGE: ...Hinglish", () => {
    const prompt = buildSymptomSoftRedirectPrompt("mujhe pet mein dard ho raha hai, kya yeh cancer ho sakta hai");
    // It IS the full system prompt (base + directive), not just the directive.
    expect(prompt).toContain(SYMPTOM_SOFT_REDIRECT_PROMPT);
    expect(prompt).toMatch(/LANGUAGE:.*Hinglish/i);
    expect(prompt).not.toMatch(/LANGUAGE:.*Reply in English\b/);
  });

  it("English symptom query -> LANGUAGE: Reply in English", () => {
    const prompt = buildSymptomSoftRedirectPrompt("I have a persistent lump, could this be cancer?");
    expect(prompt).toContain(SYMPTOM_SOFT_REDIRECT_PROMPT);
    expect(prompt).toMatch(/LANGUAGE: Reply in English/);
  });

  it("Devanagari symptom query -> LANGUAGE: ...Hindi (Devanagari)", () => {
    const prompt = buildSymptomSoftRedirectPrompt("मुझे पेट में दर्द हो रहा है, क्या यह कैंसर है");
    expect(prompt).toContain(SYMPTOM_SOFT_REDIRECT_PROMPT);
    expect(prompt).toMatch(/LANGUAGE: Reply in Hindi/);
  });
});
