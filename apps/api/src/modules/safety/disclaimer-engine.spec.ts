import {
  appendDisclaimer,
  detectLocale,
  hasDisclaimer,
  getDisclaimer,
} from "./disclaimer-engine";

describe("DisclaimerEngine", () => {
  describe("detectLocale", () => {
    test("detects Hindi from locale string", () => {
      expect(detectLocale("hi")).toBe("hi");
      expect(detectLocale("hi-IN")).toBe("hi");
    });

    test("detects English from locale string", () => {
      expect(detectLocale("en")).toBe("en");
      expect(detectLocale("en-US")).toBe("en");
    });

    test("detects Bhojpuri from locale string", () => {
      expect(detectLocale("bh")).toBe("bh");
      expect(detectLocale("bhojpuri")).toBe("bh");
    });

    test("detects Maithili from locale string", () => {
      expect(detectLocale("mai")).toBe("mai");
      expect(detectLocale("maithili")).toBe("mai");
    });

    test("detects Hindi from Devanagari text content", () => {
      expect(detectLocale(undefined, "कैंसर का इलाज कैसे होता है")).toBe("hi");
    });

    test("detects English for Latin text", () => {
      expect(detectLocale(undefined, "What is cancer treatment?")).toBe("en");
    });

    test("defaults to English when nothing detected", () => {
      expect(detectLocale()).toBe("en");
      expect(detectLocale(null)).toBe("en");
      expect(detectLocale(undefined, "")).toBe("en");
    });
  });

  // Issue #162 — the language of the response body is a detection signal in its
  // own right, ranked above a locale of "en" (which is the default, and on
  // WhatsApp is itself only derived from the absence of Devanagari in the
  // incoming message) but below an explicit Indic locale (the only signal that
  // can distinguish Bhojpuri and Maithili from Hindi).
  describe("detectLocale — response body as a signal (#162)", () => {
    const HINDI_BODY =
      "कीमोथेरेपी एक ऐसा इलाज है जिसमें दवाओं से कैंसर कोशिकाओं को नष्ट किया जाता है।";
    const ENGLISH_BODY =
      "Chemotherapy is a treatment that uses medicines to destroy cancer cells.";

    test("a Devanagari response selects Hindi even with no locale and no user text", () => {
      expect(detectLocale(undefined, undefined, HINDI_BODY)).toBe("hi");
    });

    test("a Devanagari response outranks a romanised-Hinglish question", () => {
      // The question is Latin script, so user-script detection yields "en" — but
      // the reader is looking at a Devanagari answer.
      expect(detectLocale(undefined, "kya cancer ka ilaj sambhav hai?", HINDI_BODY)).toBe("hi");
    });

    test("a Devanagari response outranks a locale of 'en'", () => {
      expect(detectLocale("en", "kya cancer ka ilaj sambhav hai?", HINDI_BODY)).toBe("hi");
    });

    test("an explicit Indic locale still wins — it is the only carrier of bh/mai", () => {
      expect(detectLocale("bh", undefined, HINDI_BODY)).toBe("bh");
      expect(detectLocale("mai", undefined, HINDI_BODY)).toBe("mai");
      expect(detectLocale("hi", undefined, ENGLISH_BODY)).toBe("hi");
    });

    test("an English response leaves the other signals in charge", () => {
      expect(detectLocale(undefined, undefined, ENGLISH_BODY)).toBe("en");
      expect(detectLocale("en", undefined, ENGLISH_BODY)).toBe("en");
      // Devanagari question, English answer: the user's own script still decides.
      expect(detectLocale(undefined, "कैंसर का इलाज कैसे होता है", ENGLISH_BODY)).toBe("hi");
    });

    test("Latin citation markers and URLs do not drag a Hindi body to English", () => {
      const bodyWithArtefacts =
        HINDI_BODY +
        "\n\n**Sources:** [citation:nci-chemotherapy-overview:chunk-0007] " +
        "[citation:nci-side-effects-management:chunk-0012] https://www.cancer.gov/about-cancer/treatment/types/chemotherapy";
      expect(detectLocale(undefined, undefined, bodyWithArtefacts)).toBe("hi");
    });
  });

  describe("appendDisclaimer", () => {
    test("appends English standard disclaimer", () => {
      const result = appendDisclaimer("Here is some information.", "en");
      expect(result).toContain("educational purposes");
      expect(result).toContain("healthcare provider");
      expect(result).toContain("---");
    });

    test("appends Hindi standard disclaimer", () => {
      const result = appendDisclaimer("यहाँ कुछ जानकारी है।", "hi");
      expect(result).toContain("शैक्षिक उद्देश्यों");
      expect(result).toContain("डॉक्टर");
    });

    test("appends emergency disclaimer when isEmergency=true", () => {
      const result = appendDisclaimer("This is urgent.", "en", true);
      expect(result).toContain("medical emergency");
      expect(result).toContain("112");
      expect(result).toContain("108");
    });

    test("appends Hindi emergency disclaimer", () => {
      const result = appendDisclaimer("यह आपातकालीन है।", "hi", true);
      expect(result).toContain("112");
      expect(result).toContain("108");
      expect(result).toContain("आपातकालीन");
    });

    test("does NOT double-append if disclaimer already present", () => {
      const withDisclaimer = appendDisclaimer("Info here.", "en");
      const doubleApplied = appendDisclaimer(withDisclaimer, "en");
      // Should only have one disclaimer
      const disclaimerCount = (doubleApplied.match(/educational purposes/g) || []).length;
      expect(disclaimerCount).toBe(1);
    });

    test("uses userText for language detection when locale is missing", () => {
      const result = appendDisclaimer(
        "Some info",
        undefined,
        false,
        "कैंसर के बारे में बताइए"
      );
      expect(result).toContain("शैक्षिक उद्देश्यों");
    });

    test("Bhojpuri disclaimer", () => {
      const result = appendDisclaimer("Some info", "bh");
      expect(result).toContain("डॉक्टर");
      expect(result).toContain("जानकारी");
    });

    test("Maithili disclaimer", () => {
      const result = appendDisclaimer("Some info", "mai");
      expect(result).toContain("डॉक्टरक");
      expect(result).toContain("शिक्षा");
    });

    test("#162: a Hindi answer gets the Hindi disclaimer with no locale passed at all", () => {
      const result = appendDisclaimer("कीमोथेरेपी से कैंसर कोशिकाएँ नष्ट होती हैं।");
      expect(result).toContain("शैक्षिक उद्देश्यों");
      expect(result).not.toContain("educational purposes");
    });

    test("#162: a Hindi emergency answer gets the Hindi emergency disclaimer", () => {
      const result = appendDisclaimer("तुरंत नज़दीकी अस्पताल जाएँ।", undefined, true);
      expect(result).toContain("आपातकालीन");
      expect(result).not.toContain("medical emergency");
    });
  });

  describe("hasDisclaimer", () => {
    test("detects English disclaimer", () => {
      const text =
        "Some info\n\n---\n*This information is for general educational purposes only and is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your healthcare provider for personalized guidance.*";
      expect(hasDisclaimer(text)).toBe(true);
    });

    test("detects Hindi disclaimer", () => {
      const text =
        "कुछ जानकारी\n\n---\n*यह जानकारी केवल सामान्य शैक्षिक उद्देश्यों के लिए है और पेशेवर चिकित्सा सलाह, निदान या उपचार का विकल्प नहीं है। व्यक्तिगत मार्गदर्शन के लिए हमेशा अपने डॉक्टर से परामर्श करें।*";
      expect(hasDisclaimer(text)).toBe(true);
    });

    test("detects emergency disclaimer", () => {
      const text =
        "Urgent info\n\n---\n*If this is a medical emergency, call 112 or 108 immediately. This information does not replace emergency medical care.*";
      expect(hasDisclaimer(text)).toBe(true);
    });

    test("returns false for text without disclaimer", () => {
      expect(hasDisclaimer("Just some regular text")).toBe(false);
      expect(hasDisclaimer("")).toBe(false);
    });
  });

  describe("getDisclaimer", () => {
    test("returns standard English disclaimer", () => {
      const d = getDisclaimer("en");
      expect(d).toContain("educational purposes");
    });

    test("returns emergency English disclaimer", () => {
      const d = getDisclaimer("en", true);
      expect(d).toContain("emergency");
    });
  });
});
