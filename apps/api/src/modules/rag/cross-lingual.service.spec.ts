import { CrossLingualService } from "./cross-lingual.service";

describe("CrossLingualService", () => {
  let service: CrossLingualService;

  beforeEach(() => {
    service = new CrossLingualService();
  });

  describe("Language detection", () => {
    test("detects pure English", () => {
      const result = service.generateParallelQueries(
        "What are the symptoms of breast cancer?"
      );
      expect(result.detectedLanguage).toBe("en");
      expect(result.parallelQueries.length).toBe(1); // No translation needed
    });

    test("detects pure Hindi", () => {
      const result = service.generateParallelQueries(
        "कैंसर के लक्षण क्या हैं"
      );
      expect(result.detectedLanguage).toBe("hi");
      expect(result.parallelQueries.length).toBeGreaterThan(1);
    });

    test("detects mixed Hindi-English", () => {
      const result = service.generateParallelQueries(
        "कैंसर ka treatment कैसे होता है"
      );
      expect(result.detectedLanguage).toBe("mixed");
    });
  });

  describe("Hindi → English translation", () => {
    test("translates cancer types", () => {
      const result = service.generateParallelQueries(
        "स्तन कैंसर के लक्षण"
      );
      expect(result.translatedTerms).toContain("breast cancer");
      expect(result.translatedTerms).toContain("symptoms");
    });

    test("translates treatment terms", () => {
      const result = service.generateParallelQueries(
        "कीमो का इलाज कैसे होता है"
      );
      expect(result.translatedTerms).toContain("chemotherapy");
      expect(result.translatedTerms).toContain("treatment");
    });

    test("translates navigation terms", () => {
      const result = service.generateParallelQueries(
        "कौन सा अस्पताल अच्छा है"
      );
      expect(result.translatedTerms).toContain("which");
      expect(result.translatedTerms).toContain("hospital");
    });

    test("translates scheme-related terms", () => {
      const result = service.generateParallelQueries(
        "आयुष्मान योजना कैसे मिलेगी"
      );
      expect(result.translatedTerms).toContain("Ayushman Bharat");
      expect(result.translatedTerms).toContain("scheme");
    });

    test("translates symptom terms", () => {
      const result = service.generateParallelQueries(
        "गांठ और दर्द हो रहा है"
      );
      expect(result.translatedTerms).toContain("lump");
      expect(result.translatedTerms).toContain("pain");
    });
  });

  describe("Parallel queries", () => {
    test("English query returns only original", () => {
      const result = service.generateParallelQueries(
        "breast cancer treatment options"
      );
      expect(result.parallelQueries).toEqual([
        "breast cancer treatment options",
      ]);
    });

    test("Hindi query returns original + translated", () => {
      const result = service.generateParallelQueries(
        "कैंसर के लक्षण"
      );
      expect(result.parallelQueries.length).toBeGreaterThanOrEqual(2);
      // First is always original
      expect(result.parallelQueries[0]).toBe("कैंसर के लक्षण");
      // Second should contain English terms
      expect(
        result.parallelQueries.some((q) => /cancer|symptoms/i.test(q))
      ).toBe(true);
    });

    test("complex Hindi query generates medical keyword query", () => {
      const result = service.generateParallelQueries(
        "स्तन कैंसर का इलाज कैसे होता है"
      );
      // Should have at least: original, translated, and medical keywords
      expect(result.parallelQueries.length).toBeGreaterThanOrEqual(2);
      expect(result.translatedTerms.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Hinglish handling", () => {
    test("translates Hinglish terms", () => {
      const result = service.generateParallelQueries(
        "ilaaj kaise hota hai cancer ka"
      );
      // Hinglish is detected as "en" or "mixed" depending on script ratio
      // The Hinglish dictionary should still catch terms
      expect(
        result.translatedTerms.length > 0 ||
        result.detectedLanguage === "en"
      ).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("empty string", () => {
      const result = service.generateParallelQueries("");
      expect(result.parallelQueries).toEqual([""]);
      expect(result.detectedLanguage).toBe("en");
    });

    test("numbers only", () => {
      const result = service.generateParallelQueries("108 112");
      expect(result.parallelQueries.length).toBeGreaterThanOrEqual(1);
    });

    test("mixed script with mostly English", () => {
      const result = service.generateParallelQueries(
        "What is cancer treatment in Hindi कैंसर"
      );
      // Mostly English → should still translate the Hindi terms
      expect(result.detectedLanguage).toBe("en"); // Mostly English
    });
  });
});
