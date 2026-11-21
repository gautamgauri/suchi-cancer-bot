import { stripRetrievalNoise } from "./retrieval-query-noise";

/**
 * Issue #182 — the retrieval query must carry only what the question is ABOUT.
 *
 * The flagship awareness probe (synthetic here, written for this test) was sent to
 * retrieval as "suchi, cancer about ek line me tell me": the bot's own name and
 * an answer-LENGTH directive ("in one line") became search terms. "line" + the
 * generic "cancer" matched every "first-line / second-line treatment" chunk, so
 * colorectal/breast/drug chunks came back and "Cancer Basics" did not.
 *
 * These words still reach the LLM (the user did ask for one line); they are
 * removed only from the text used to SEARCH the knowledge base.
 */
describe("stripRetrievalNoise (issue #182)", () => {
  describe("answer-length / format directives are not topic words", () => {
    it.each([
      ["cancer ke bare me ek line me batao", "cancer ke bare me batao"],
      ["cancer about ek line me tell me", "cancer about tell me"],
      ["cancer kya hai do line mein samjhao", "cancer kya hai samjhao"],
      ["tell me about cancer in one line", "tell me about cancer"],
      ["explain cancer in 2 lines please", "explain cancer please"],
      ["what is cancer, in a few words?", "what is cancer?"],
      ["what is chemotherapy in short", "what is chemotherapy"],
      ["कैंसर के बारे में एक लाइन में बताओ", "कैंसर के बारे में बताओ"],
      ["कैंसर क्या है संक्षेप में बताइए", "कैंसर क्या है बताइए"],
    ])("%s → %s", (input, expected) => {
      expect(stripRetrievalNoise(input)).toBe(expected);
    });
  });

  describe("addressing the bot by name is not a topic word", () => {
    it.each([
      ["suchi, cancer ke bare me batao", "cancer ke bare me batao"],
      ["Suchi ji cancer kya hai", "cancer kya hai"],
      ["hi suchi! what is cancer?", "what is cancer?"],
      ["what is cancer, suchi?", "what is cancer?"],
    ])("%s → %s", (input, expected) => {
      expect(stripRetrievalNoise(input)).toBe(expected);
    });

    it("the full flagship probe keeps only its topic", () => {
      expect(stripRetrievalNoise("suchi, cancer ke bare me ek line me batao")).toBe("cancer ke bare me batao");
      expect(stripRetrievalNoise("suchi, cancer about ek line me tell me")).toBe("cancer about tell me");
    });
  });

  describe("content that merely looks similar is preserved", () => {
    it.each([
      "first-line treatment for metastatic colorectal cancer",
      "second line chemotherapy options",
      "is there one line of treatment left after bevacizumab",
      "how do I care for a PICC line during chemo",
      "Suchitra Cancer Care Foundation helpline",
      "mujhe ek gaanth hai",
    ])("%s", (input) => {
      expect(stripRetrievalNoise(input)).toBe(input);
    });

    it("removes the directive but keeps the rest of a sentence around it", () => {
      expect(stripRetrievalNoise("in one sentence what is the difference between a biopsy and a scan")).toBe(
        "what is the difference between a biopsy and a scan"
      );
    });

    it("never returns an empty query — a message that is only noise is left as it was", () => {
      expect(stripRetrievalNoise("suchi")).toBe("suchi");
      expect(stripRetrievalNoise("ek line me batao")).toBe("batao");
      expect(stripRetrievalNoise("in one line")).toBe("in one line");
      expect(stripRetrievalNoise("")).toBe("");
    });
  });
});
