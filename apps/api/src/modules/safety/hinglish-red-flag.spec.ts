/**
 * Issue #81 — Hinglish / Devanagari red-flag coverage.
 *
 * A caregiver reporting heavy bleeding plus dizziness after chemo in romanised
 * Hindi was classified `normal` by all three detection layers
 * (`evaluateEmergencyFastPath`, `SafetyService.evaluate`,
 * `AbstentionService.hasUrgencyIndicators`) and was served chemo-prep content,
 * while the English twin escalated. The rule these tests pin down is the one
 * in hindi-safety-regression.spec.ts: the SAME meaning must escalate whatever
 * the script, spelling or mix.
 *
 * All text below is synthetic.
 */

import { evaluateEmergencyFastPath } from "./emergency-fast-path";
import { AbstentionService } from "../abstention/abstention.service";

const ZW = "​"; // zero-width space

describe("Issue #81 — Hinglish / Devanagari red flags", () => {
  const abstention = new AbstentionService();

  // ── Heavy / won't-stop bleeding + dizziness after chemo: critical ──
  // Critical patterns are checked first, so a heavy-bleeding or won't-stop
  // signal keeps the message critical even though bleeding + dizziness on its
  // own is urgent (SCCF decision on #196).
  describe("post-chemo HEAVY bleeding + dizziness escalates as critical", () => {
    it.each([
      [
        "issue sentence (romanised Hinglish)",
        "meri didi chemo ke baad se bahut kamjor hai, aaj bleeding bahut zyada ho gayi aur chakkar aa raha hai. kya karu??",
      ],
      [
        "Devanagari counterpart",
        "मेरी दीदी कीमो के बाद से बहुत कमजोर है, आज ब्लीडिंग बहुत ज़्यादा हो गई और चक्कर आ रहा है। क्या करूँ?",
      ],
      [
        "Devanagari, khoon",
        "कीमो के बाद मम्मी को खून बहुत ज़्यादा निकल रहा है और चक्कर आ रहे हैं",
      ],
      [
        "Devanagari, decomposed nukta (NFD ज़)",
        "कीमो के बाद ब्लीडिंग बहुत ज़्यादा है और चक्कर आ रहा है",
      ],
      [
        "Hinglish, heavy bleeding + chakkar in one sentence",
        "bleeding bahut zyada ho rahi hai aur chakkar aa raha hai",
      ],
      [
        "Hinglish, 'kimo', bleeding rukti nahi",
        "kimo ke baad se bleeding rukti hi nahi, mummy ko chakkar aata hai",
      ],
      [
        "Hinglish, intensifier before noun",
        "chemo ke 5 din baad bahut zyada bleeding ho rahi hai, sir ghoom raha hai",
      ],
      [
        "WhatsApp elongation",
        "chemo ke baad bleeding bahuttt zyada hai aur chakkarrr aa raha hai",
      ],
      [
        "zero-width obfuscation",
        `chemo ke baad blee${ZW}ding bahut zyada hai aur chak${ZW}kar aa raha hai`,
      ],
      // Owner decision on #196: these two are critical signals in their own
      // right, so bleeding + either one is critical, not the urgent cluster.
      [
        "near-fainting (behoshi jaisi) + khoon",
        "chemo ke baad khoon aa raha hai, behoshi jaisi lag rahi hai",
      ],
      [
        "English, 'a lot' phrasing (no 'heavy' keyword)",
        "my sister is very weak since chemo, today she is bleeding a lot and feels dizzy",
      ],
      [
        "English, 'so much' + chakkar",
        "chemo ke baad she is bleeding so much, chakkar aa raha hai",
      ],
      [
        "English, 'lots of blood' + dizzy",
        "there is lots of blood and she feels dizzy",
      ],
    ])("%s", (_variant, text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
      // The existing escalation response is reused, not new wording.
      expect(result.responseText).toContain("112");
      expect(result.responseText).toContain("108");
    });

    it("heavy bleeding + dizziness reports the heavy-bleeding rule, not the urgent cluster", () => {
      const result = evaluateEmergencyFastPath("bleeding bahut zyada ho rahi hai aur chakkar aa raha hai");
      expect(result.severity).toBe("critical");
      expect(result.matchedPatterns).toContain("severe_bleeding_loanword_hinglish");
      expect(result.matchedPatterns).not.toContain("bleeding_with_dizziness_multilingual");
    });
  });

  // ── Plain bleeding + dizziness (no heavy / won't-stop signal): urgent ──
  // SCCF decision on #196: urgent reply ("contact your care team today",
  // 112/108 still shown, "go to Emergency if bleeding won't stop").
  describe("post-chemo bleeding + dizziness WITHOUT a heavy signal escalates as urgent", () => {
    it.each([
      [
        "Hinglish, 'kemo' spelling + khoon",
        "kemo ke baad papa ki naak se khoon aa raha hai aur chakar aa rahe hain",
      ],
      [
        "Hinglish, loanword + chakkar",
        "chemo ke baad bleeding ho rahi hai aur chakkar aa raha hai",
      ],
      [
        "mixed script",
        "chemo ke baad bleeding ho rahi hai aur चक्कर आ रहा है",
      ],
      [
        "Devanagari",
        "कीमो के बाद ब्लीडिंग हो रही है और चक्कर आ रहा है",
      ],
      [
        "code-mixed English dizziness",
        "didi ko chemo ke baad bleeding ho rahi hai aur dizzy feel ho raha hai",
      ],
      [
        "zero-width obfuscation",
        `chemo ke baad blee${ZW}ding ho rahi hai aur chak${ZW}kar aa raha hai`,
      ],
    ])("%s", (_variant, text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("urgent");
      expect(result.matchedPatterns).toContain("bleeding_with_dizziness_multilingual");
      // The existing urgent response is reused: care team today, 112/108 shown.
      expect(result.responseText).toContain("Contact your care team today");
      expect(result.responseText).toContain("112");
      expect(result.responseText).toContain("108");
      expect(result.responseText).toContain("Bleeding that won't stop");
    });
  });

  // ── Heavy bleeding alone (loanword "bleeding") matches the khoon rule ──
  describe("heavy bleeding in Hinglish / Devanagari escalates as critical", () => {
    it.each([
      "bleeding bahut zyada ho rahi hai",
      "bleeding bohot ho rahi hai",
      "bleeding ruk nahi rahi",
      "bleeding band hi nahi ho rahi",
      "khoon rukta nahi hai",
      "ब्लीडिंग बहुत ज़्यादा हो रही है",
      "बहुत ज़्यादा ब्लीडिंग हो रही है",
      "ब्लीडिंग रुक नहीं रही",
      "खून बहुत ज्यादा निकल रहा है",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
    });
  });

  // ── English heavy bleeding without the words heavy / severe / uncontrolled ──
  describe("English 'bleeding a lot' and close variants escalate as critical", () => {
    it.each([
      "she is bleeding a lot",
      "my father is bleeding so much from the nose",
      "he has been bleeding too much since yesterday",
      "she is bleeding really a lot",
      "bleeding heavily after chemo",
      "the wound is bleeding profusely",
      "there is lots of blood on the bedsheet",
      "she lost a lot of blood",
      "so much blood is coming out",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
      expect(result.matchedPatterns).toContain("severe_bleeding_en_2");
    });
  });

  // ── Fainting / near-fainting: "behoshi" is critical, like "behosh" and
  // English "fainting" (unconscious_hinglish / unconscious_en) ──
  describe("behoshi (fainting / near-fainting) escalates as critical", () => {
    it.each([
      "mummy ko behoshi aa gayi",
      "behoshi jaisi lag rahi hai",
      "papa behoshi mein hain, jawab nahi de rahe",
      "use behoshee aa rahi hai",
      "बेहोशी आ गई",
      "मम्मी को बेहोशी जैसी लग रही है",
      `mummy ko beho${ZW}shi aa gayi`,
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
    });
  });

  // ── Fever during chemo (febrile neutropenia) — parity with chemo_fever_en ──
  describe("fever after chemo in Hinglish / Devanagari escalates as urgent or higher", () => {
    it.each([
      "chemo ke baad bukhar aa gaya hai",
      "kemo ke 7 din baad se bukhaar hai",
      "papa ko bukhar hai, pichle hafte kimo hua tha",
      "कीमो के बाद बुखार आ गया",
      "तेज़ बुखार और उल्टी, पिछले हफ्ते कीमो हुई थी",
      "fever aa raha hai chemo ke baad",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
    });
  });

  // ── The S2 urgency layer agrees (defence in depth; intent classifier uses it) ──
  describe("AbstentionService.hasUrgencyIndicators agrees", () => {
    it.each([
      "meri didi chemo ke baad se bahut kamjor hai, aaj bleeding bahut zyada ho gayi aur chakkar aa raha hai. kya karu??",
      "मेरी दीदी कीमो के बाद से बहुत कमजोर है, आज ब्लीडिंग बहुत ज़्यादा हो गई और चक्कर आ रहा है। क्या करूँ?",
      "bleeding ruk nahi rahi",
      "chemo ke baad bukhar aa gaya hai",
      "कीमो के बाद बुखार आ गया",
      "my sister is bleeding a lot and feels dizzy",
      // plain bleeding + dizziness is urgent on the fast path; the S2 layer
      // must still see it
      "kemo ke baad papa ki naak se khoon aa raha hai aur chakar aa rahe hain",
      "chemo ke baad bleeding ho rahi hai aur चक्कर आ रहा है",
      "कीमो के बाद ब्लीडिंग हो रही है और चक्कर आ रहा है",
      // new critical signals (owner decision on #196)
      "she is bleeding so much",
      "there is lots of blood on the bedsheet",
      "mummy ko behoshi aa gayi",
      "बेहोशी आ गई",
    ])("%p", (text) => {
      expect(abstention.hasUrgencyIndicators(text)).toBe(true);
    });
  });

  // ── False-positive guards: benign Hinglish must stay non-emergency ──
  describe("benign phrasing does NOT escalate", () => {
    it.each([
      // acceptance criterion from the issue
      "breast cancer ke early symptoms kya hote hain?",
      // "chakkar" = trip / errand / hassle, not dizziness
      "report ke liye hospital ke bahut chakkar lagane pade",
      "blood test ke liye do baar chakkar lagaya, report kab aayegi?",
      "chemo ke chakkar mein naukri chhoot gayi",
      "Ayushman card ke chakkar mein pareshan hain",
      "insurance ke chakkar kaatne padte hain",
      // blood tests / counts are not bleeding
      "blood test report bahut late aayi",
      "chemo se pehle blood test zaroori hai kya?",
      // anaemia question (khoon ki kami) is not a bleeding report
      "khoon ki kami se chakkar aata hai kya?",
      // tiny amount of bleeding
      "bleeding bahut kam hai ab",
      "कीमो से पहले क्या खाना चाहिए?",
      "मुझे कब और कितनी बार पैप स्मियर टेस्ट करवाना चाहिए?",
      // "a lot" / "lots of blood" that is not a bleeding report
      "chemo helped her a lot",
      "I have read a lot about bleeding risks during chemo",
      "lots of blood tests before chemo, is that normal?",
      "they took a lot of blood for tests today",
      "does she need so much blood pressure medicine?",
      "he needed a lot of blood transfusions last year",
      // "behoshi" meaning anaesthesia, not fainting
      "operation se pehle behoshi ki dawai dete hain kya?",
      "behoshi ka injection kaun deta hai?",
      "surgery se pehle behoshi ke doctor se milna hai",
      "ऑपरेशन से पहले बेहोशी की दवा दी जाती है क्या?",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(false);
      expect(abstention.hasUrgencyIndicators(text)).toBe(false);
    });
  });
});
