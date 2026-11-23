import { ClinicalKeywordEnforcerService } from "./clinical-keyword-enforcer";
import { PatientState } from "../chat/patient-state.service";

/**
 * Issue #224 — `enforce()` spliced hardcoded ENGLISH clinical sentences
 * ("Your doctor may recommend a mammogram (breast X-ray) as a first step.")
 * into replies of any language, and `appendBeforeDisclaimer()` only knows
 * English insertion patterns, so on a Hindi reply the English sentence landed
 * at the very end. Same reader-facing defect as #186 (completeness fallback)
 * and #222 (essential-terms addendum), third path.
 *
 * These tests assert only *which existing* English sentence does or does not
 * come out. No clinical copy is defined or translated here — that needs SCCF
 * review (AGENTS.md §1.3).
 *
 * All bodies below are synthetic; no patient data.
 */

const MAMMOGRAM_INJECTION =
  "Your doctor may recommend a mammogram (breast X-ray) as a first step.";
const ONCOLOGIST_INJECTION =
  "We recommend consulting with an oncologist for personalized guidance.";

// A Hindi answer body about a breast lump. Deliberately contains no English
// clinical term, so the breast/symptomatic rule finds nothing and wants to inject.
const HINDI_BREAST_ANSWER =
  "स्तन में गांठ महसूस होने पर घबराएँ नहीं। कृपया जल्द से जल्द डॉक्टर से मिलें, " +
  "वे जाँच करके आगे की सलाह देंगे।";
const HINDI_BREAST_QUESTION = "मेरे स्तन में गांठ है, मुझे क्या करना चाहिए?";

// The same answer in Romanized Hinglish — detectLocale() cannot see this one
// (it is all-Latin), which is why resolveFallbackLocale() exists (PR #187).
const HINGLISH_BREAST_ANSWER =
  "Stan mein gaanth hai to ghabraiye nahin. Kripya jald se jald doctor se milein, " +
  "ve jaanch karke aage ki salah denge.";
const HINGLISH_BREAST_QUESTION = "mujhe stan mein gaanth hai, kya karein";

const ENGLISH_BREAST_ANSWER =
  "A new lump in the breast is worth getting checked promptly. Please see a " +
  "clinician soon so they can examine it and advise you on next steps.";
const ENGLISH_BREAST_QUESTION = "I found a lump in my breast, what should I do?";

describe("ClinicalKeywordEnforcerService — reply-locale awareness (issue #224)", () => {
  let service: ClinicalKeywordEnforcerService;

  beforeEach(() => {
    service = new ClinicalKeywordEnforcerService();
  });

  describe("non-English replies", () => {
    it("does not append the English mammogram sentence to a Hindi reply", () => {
      const out = service.enforce(
        HINDI_BREAST_ANSWER,
        "breast",
        PatientState.SYMPTOMATIC,
        "hi",
        HINDI_BREAST_QUESTION,
      );

      expect(out).not.toContain(MAMMOGRAM_INJECTION);
      expect(out).not.toMatch(/mammogram/i);
      expect(out).toBe(HINDI_BREAST_ANSWER);
    });

    it("does not append the English mammogram sentence to a Devanagari reply with no locale signal", () => {
      // The pre-#224 call site passed no locale at all; the Devanagari body is
      // signal enough on its own. This is the behavioural shape of the defect.
      const out = service.enforce(HINDI_BREAST_ANSWER, "breast", PatientState.SYMPTOMATIC);

      expect(out).not.toContain(MAMMOGRAM_INJECTION);
      expect(out).toBe(HINDI_BREAST_ANSWER);
    });

    it("does not append the English mammogram sentence to a Romanized Hinglish reply", () => {
      // WhatsApp labels an all-Latin message "en" — the locale argument lies here.
      const out = service.enforce(
        HINGLISH_BREAST_ANSWER,
        "breast",
        PatientState.SYMPTOMATIC,
        "en",
        HINGLISH_BREAST_QUESTION,
      );

      expect(out).not.toContain(MAMMOGRAM_INJECTION);
      expect(out).toBe(HINGLISH_BREAST_ANSWER);
    });

    it("does not append the English oncologist sentence to a Hindi caregiver reply", () => {
      const body =
        "अपनी माँ की देखभाल करते समय उनकी दवाइयों का समय ध्यान रखें और उनके साथ " +
        "अस्पताल जाएँ। आप अकेले नहीं हैं।";

      const out = service.enforce(body, null, PatientState.CAREGIVER, "hi", "माँ की देखभाल कैसे करें");

      expect(out).not.toContain(ONCOLOGIST_INJECTION);
      expect(out).toBe(body);
    });

    it("still normalizes a synonym the reply already contains (swap is language-safe)", () => {
      // "mammography" is already in the reader's text; swapping it for the
      // canonical term adds no new English, so #224 must not disable it.
      const body = `${HINDI_BREAST_ANSWER} डॉक्टर mammography की सलाह दे सकते हैं।`;

      const out = service.enforce(
        body,
        "breast",
        PatientState.SYMPTOMATIC,
        "hi",
        HINDI_BREAST_QUESTION,
      );

      expect(out).toContain("mammogram");
      expect(out).not.toContain(MAMMOGRAM_INJECTION);
    });
  });

  describe("English replies (behaviour preserved)", () => {
    it("still appends the mammogram sentence to an English reply", () => {
      const out = service.enforce(
        ENGLISH_BREAST_ANSWER,
        "breast",
        PatientState.SYMPTOMATIC,
        "en",
        ENGLISH_BREAST_QUESTION,
      );

      expect(out).toContain(MAMMOGRAM_INJECTION);
    });

    it("still appends the mammogram sentence when no locale signal is supplied", () => {
      const out = service.enforce(ENGLISH_BREAST_ANSWER, "breast", PatientState.SYMPTOMATIC);

      expect(out).toContain(MAMMOGRAM_INJECTION);
    });

    it("keeps inserting before the disclaimer section rather than at the end", () => {
      const body = `${ENGLISH_BREAST_ANSWER}\n\n**What to do next**\n- Book an appointment.`;

      const out = service.enforce(
        body,
        "breast",
        PatientState.SYMPTOMATIC,
        "en",
        ENGLISH_BREAST_QUESTION,
      );

      expect(out.indexOf(MAMMOGRAM_INJECTION)).toBeLessThan(out.indexOf("**What to do next**"));
    });

    it("leaves an English reply untouched when the required term is already present", () => {
      const body = `${ENGLISH_BREAST_ANSWER} A mammogram is usually the first test.`;

      const out = service.enforce(
        body,
        "breast",
        PatientState.SYMPTOMATIC,
        "en",
        ENGLISH_BREAST_QUESTION,
      );

      expect(out).toBe(body);
    });
  });
});
