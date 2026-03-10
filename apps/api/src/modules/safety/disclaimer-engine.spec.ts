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
