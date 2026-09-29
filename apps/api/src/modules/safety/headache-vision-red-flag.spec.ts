/**
 * QA0904-1 — severe headache + blurred vision, and "bahut kamzor" (very weak).
 *
 * A Hindi report of a child on treatment with severe headache plus blurred
 * vision (possible raised intracranial pressure / CNS involvement) returned
 * `none` from every rule layer, while the English "severe headache" already
 * escalates as urgent (`severe_symptom_en`) and "sudden vision loss" as urgent
 * (`sudden_sensory_loss_en`). Same meaning, same escalation, any script.
 *
 * "bahut kamzor" (very weak) on its own stays NON-emergency — fatigue is the
 * most common treatment side effect. It escalates (urgent) only together with
 * a second signal: dizziness, not eating / drinking, fever, or bleeding.
 *
 * All text below is synthetic. Nukta spellings are written as escapes so both
 * the precomposed (U+095B ज़, U+095E फ़) and decomposed (+ U+093C) forms are
 * pinned explicitly.
 */

import { evaluateEmergencyFastPath } from "./emergency-fast-path";
import { AbstentionService } from "../abstention/abstention.service";

const ZW = "​"; // zero-width space
const TEZ_PRE = "तेज़"; // तेज़, precomposed ज़
const TEZ_DEC = "तेज़"; // तेज़, decomposed ज + nukta
const SAAF_PRE = "साफ़"; // साफ़, precomposed फ़
const ZYADA_DEC = "ज़्यादा"; // ज़्यादा, decomposed

/** The query exactly as asked in the QA0904-1 production run. */
const QA0904_1 = "बच्चे को कैंसर है, इलाज के दौरान उसे तेज़ सिरदर्द और धुंधला दिखने लगा है। क्या यह खतरनाक है?";

describe("QA0904-1 — headache + blurred vision / very weak", () => {
  const abstention = new AbstentionService();

  function expectUrgent(text: string) {
    const result = evaluateEmergencyFastPath(text);
    expect(result.isEmergency).toBe(true);
    expect(result.severity).toBe("urgent");
    // The existing urgent reply is reused, not new wording.
    expect(result.responseText).toContain("Contact your care team today");
    expect(result.responseText).toContain("112");
    expect(result.responseText).toContain("108");
    return result;
  }

  // ── The production query ──
  describe("the QA0904-1 sentence escalates as urgent", () => {
    it("as asked", () => {
      const result = expectUrgent(QA0904_1);
      expect(result.matchedPatterns).toContain("headache_with_vision_change_multilingual");
    });

    it("with a decomposed nukta in तेज़", () => {
      expectUrgent(QA0904_1.replace("तेज़", TEZ_DEC));
    });

    it("with a precomposed nukta in तेज़", () => {
      expectUrgent(QA0904_1.replace("तेज़", TEZ_PRE));
    });

    it("romanised twin from the #196 PR body", () => {
      expectUrgent("bachche ko cancer hai, tez sirdard aur dhundhla dikh raha hai");
    });
  });

  // ── Headache + vision change cluster: both signals, any script, no intensifier needed ──
  describe("headache + vision change escalates as urgent in any script", () => {
    it.each([
      // Devanagari
      ["Devanagari, सिर में दर्द + आँखों से धुंधला", "बेटी को सिर में दर्द है और आँखों से धुंधला दिख रहा है"],
      ["Devanagari, धुँधला (chandrabindu)", "कीमो के बाद सिरदर्द और धुँधला दिखने लगा"],
      ["Devanagari, double vision", "सरदर्द के साथ डबल दिख रहा है"],
      ["Devanagari, दो-दो दिख", "सिरदर्द है और सब दो-दो दिख रहा है"],
      ["Devanagari, साफ़ नहीं दिख (precomposed)", `सिरदर्द के बाद से ${SAAF_PRE} नहीं दिख रहा`],
      ["Devanagari, नज़र धुंधली", "इलाज के दौरान सिर दर्द और नज़र धुंधली हो गई है"],
      // Hinglish
      ["Hinglish, ilaaj ke dauran", "ilaaj ke dauran beti ko sir dard aur dhundhla dikhne laga hai"],
      ["Hinglish, double dikh", "sar me dard hai aur double dikh raha hai"],
      ["Hinglish, saaf nahi dikh", "sir dard ke saath saaf nahi dikh raha"],
      ["Hinglish, dhundla spelling", "sirdard hai aur aankhon se dhundla dikhta hai"],
      ["Hinglish, dhundhli nazar", "chemo ke baad sir me dard, nazar dhundhli ho gayi"],
      ["Hinglish, kam dikhne laga", "bete ko sir dard ke saath kam dikhne laga hai"],
      // English
      ["English, headache + blurred vision", "my child on chemo has a headache and blurred vision"],
      ["English, blurry vision", "headache since morning and his vision is blurry"],
      ["English, seeing double", "bad headache and she is seeing double"],
      ["English, can't see clearly", "her head hurts and she can't see clearly"],
      // mixed script / code-mixed
      ["mixed, Hinglish headache + English blurry", "sir dard aur blurry vision ho raha hai"],
      ["mixed, English headache + Devanagari vision", "headache aur धुंधला दिख रहा है"],
      // obfuscation
      ["WhatsApp elongation", "sirdarddd aur dhundhlaaa dikh raha hai"],
      ["zero-width obfuscation", `sir${ZW}dard aur dhun${ZW}dhla dikh raha hai`],
    ])("%s", (_variant, text) => {
      const result = expectUrgent(text);
      expect(result.matchedPatterns).toContain("headache_with_vision_change_multilingual");
    });
  });

  // ── Severe headache alone: parity with English "severe headache" (severe_symptom_en, urgent) ──
  describe("severe headache alone escalates as urgent (parity with severe_symptom_en)", () => {
    it.each([
      "tez sirdard ho raha hai",
      "tej sir dard hai subah se",
      "bahut tez sir dard hai",
      "bahut sir dard ho raha hai",
      "sir dard bahut zyada hai",
      "sirdard bahut tez hai",
      "sir phat raha hai dard se",
      `${TEZ_PRE} सिरदर्द हो रहा है`,
      `${TEZ_DEC} सिरदर्द हो रहा है`,
      "बहुत तेज सिर दर्द है",
      `सिर में ${TEZ_PRE} दर्द है`,
      `सिर में ${TEZ_DEC} दर्द है`,
      `सिरदर्द बहुत ${ZYADA_DEC} है`,
      "सिर फट रहा है",
      "severe headache since last night",
    ])("%p", (text) => {
      expectUrgent(text);
    });
  });

  // Devanagari `तेज़ दर्द` (nukta) broke severe_symptom_hi's `\s*` join — the
  // generic pain / vomiting / diarrhoea / swelling rule, not just headache.
  describe("Devanagari severe symptom with a nukta'd तेज़ escalates as urgent", () => {
    it.each([
      `पेट में ${TEZ_PRE} दर्द है`,
      `पेट में ${TEZ_DEC} दर्द है`,
      `${ZYADA_DEC} उल्टी हो रही है`,
    ])("%p", (text) => {
      expectUrgent(text);
    });
  });

  // ── A critical signal alongside still wins (critical is checked first) ──
  describe("headache + vision change with a critical signal is critical", () => {
    it.each([
      "tez sir dard aur dhundhla dikh raha tha, ab behosh ho gaya",
      "headache and blurred vision, and now she had a seizure",
      "सिरदर्द और धुंधला दिख रहा है, दौरा आ रहा है",
      "सिरदर्द और धुंधला दिख रहा है, अब होश नहीं है",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
    });
  });

  // ── "bahut kamzor" + a second signal: urgent ──
  describe("very weak + a second signal escalates as urgent", () => {
    it.each([
      // + not eating / drinking
      ["Hinglish, + kuch nahi kha rahe", "chemo ke baad papa bahut kamzor hain, kuch nahi kha rahe"],
      ["Hinglish, + paani bhi nahi pee pa rahi", "mummy bahut kamzor ho gayi hai, paani bhi nahi pee pa rahi"],
      ["Hinglish, + khana peena band", "didi bahut kamjor hai aur khana peena band hai"],
      ["Devanagari, + कुछ नहीं खा रहे", "कीमो के बाद पापा बहुत कमज़ोर हैं, कुछ नहीं खा रहे"],
      ["Devanagari, + खाना पीना बंद", "मम्मी बहुत कमजोर हैं, खाना पीना बंद है"],
      ["English, + can't eat or drink", "he is very weak and can't eat or drink anything"],
      ["English, + not eating", "my mother is extremely weak and is not eating since chemo"],
      // + dizziness
      ["Hinglish, + chakkar", "radiation ke baad bahut kamzori hai aur chakkar aa raha hai"],
      ["Devanagari, + चक्कर", "बहुत कमज़ोरी है और चक्कर आ रहे हैं"],
      ["English, + dizzy", "she is so weak and feels dizzy after chemo"],
      // + fever
      ["Hinglish, + bukhar", "papa bahut kamzor hain aur bukhar bhi hai"],
      ["Devanagari, + बुखार", "बहुत कमजोरी है और बुखार है"],
      ["English, + fever", "he is very weak and has a fever"],
      // + bleeding (no heavy signal). Note "bahut … khoon" is already critical
      // via severe_bleeding_hinglish, so this uses a different intensifier.
      ["Hinglish, + khoon", "papa kaafi kamzor hain aur masudon se khoon aa raha hai"],
      ["English, + bleeding", "she is very weak and her gums are bleeding"],
      // intensifier after the noun, elongation
      ["Hinglish, kamzori bahut zyada", "kamzori bahut zyada hai aur kuch nahi kha pa rahi"],
      ["WhatsApp elongation", "bahuttt kamzor hai aur chakkarrr aa raha hai"],
    ])("%s", (_variant, text) => {
      const result = expectUrgent(text);
      expect(result.matchedPatterns).toContain("weakness_with_second_signal_multilingual");
    });
  });

  // ── "bahut kamzor" with a critical signal is critical (the other signal alone already is) ──
  describe("very weak + a critical signal is critical", () => {
    it.each([
      "bahut kamzor hai aur behosh ho gayi",
      "बहुत कमजोर हैं और बेहोशी आ गई",
      "meri didi chemo ke baad se bahut kamjor hai, aaj bleeding bahut zyada ho gayi",
      "very weak and she fainted this morning",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(true);
      expect(result.severity).toBe("critical");
    });
  });

  // ── The S2 urgency layer agrees (shared matchers via matchesIndicRedFlag) ──
  describe("AbstentionService.hasUrgencyIndicators agrees", () => {
    it.each([
      QA0904_1,
      "bachche ko cancer hai, tez sirdard aur dhundhla dikh raha hai",
      "my child on chemo has a headache and blurred vision",
      "sar me dard hai aur double dikh raha hai",
      "tez sirdard ho raha hai",
      `${TEZ_DEC} सिरदर्द हो रहा है`,
      `पेट में ${TEZ_DEC} दर्द है`,
      "chemo ke baad papa bahut kamzor hain, kuch nahi kha rahe",
      "बहुत कमज़ोरी है और चक्कर आ रहे हैं",
      "he is very weak and can't eat or drink anything",
    ])("%p", (text) => {
      expect(abstention.hasUrgencyIndicators(text)).toBe(true);
    });
  });

  // ── False-positive guards ──
  describe("benign phrasing does NOT escalate", () => {
    it.each([
      // headache alone, without an intensifier
      "sir dard ho raha hai",
      "thoda sir dard hai",
      "सिरदर्द है",
      "chemo ke baad sir dard hota hai kya?",
      // headache medicine questions
      "headache ki dawai kaunsi hai?",
      "sir dard ki dawai le sakte hain chemo ke saath?",
      "सिरदर्द की दवा कौन सी लें?",
      "can I take paracetamol for a headache during chemo?",
      // weak eyesight / glasses / eye tests
      "aankh kamzor hai",
      "bachche ki aankh bahut kamzor hai, chashma lagega?",
      "chashma kab lagana chahiye?",
      "chemo se pehle aankh ki jaanch zaroori hai kya?",
      "is an eye test needed before radiation?",
      "मेरी आँखें कमज़ोर हैं, चश्मे का नंबर बढ़ गया",
      // glasses-related eyestrain, headache + blur, no treatment context
      "purana chashma lagane se dhundhla dikhta hai aur sir dard hota hai",
      "glasses ke bina blurry dikhta hai aur headache hota hai",
      // vision alone, including with a negated headache
      "dhundhla dikhta hai kabhi kabhi",
      "No headache, but blurry vision since the eye drops",
      "sir dard nahi hai, bas thoda dhundhla dikhta hai",
      "सिरदर्द नहीं है, बस धुंधला दिखता है",
      // "dhul" (washed) is not "dhundhla"
      "kapde dhul gaye, sir dard hai",
      // "कैंसर" ends in सर but is not "head"
      "कैंसर में दर्द है और धुंधला दिख रहा",
      // "dhoondh" = search, not blur
      "hospital dhundh raha hoon, sir dard hai",
      // "Sir" as a form of address
      "Sir, dard ke liye kya karein?",
      // very weak ALONE — deliberately not escalated
      "chemo ke baad bahut kamzori lagti hai, kya khayein?",
      "mummy chemo ke baad bahut kamzor ho gayi hai",
      "बहुत कमज़ोरी लगती है, क्या खाएं?",
      "I feel very weak after chemo, what should I eat?",
      // weak + fever as an awareness list without an intensifier
      "blood cancer ke lakshan kya hain? kamzori, bukhar, vajan kam hona",
      // weak immunity / bones / eyes are not a weakness report
      "immunity bahut kamzor hai, bukhar se kaise bachein?",
      "haddiyan bahut kamzor hain, bukhar ke baad dard hota hai",
      // not-eating questions that are diet questions
      "chemo ke baad kya nahi khana chahiye?",
      "what should I not eat during chemo?",
    ])("%p", (text) => {
      const result = evaluateEmergencyFastPath(text);
      expect(result.isEmergency).toBe(false);
      expect(abstention.hasUrgencyIndicators(text)).toBe(false);
    });
  });
});
