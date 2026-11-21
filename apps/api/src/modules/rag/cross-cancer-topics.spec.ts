import { detectCrossCancerTopic } from "./cross-cancer-topics";

/**
 * Issue #170 (web/English repro in the issue thread): a chewing-tobacco question
 * retrieved 4x lung + 2x bladder chunks and no oral chunk at all. The cross-cancer
 * "smoking" topic matched on the word `tobacco` and fanned retrieval out to
 * `<query> lung cancer` / `<query> bladder cancer` — the first entries of its
 * site list — regardless of what the question was about. Synthetic questions.
 */
describe("detectCrossCancerTopic (#170)", () => {
  describe("smokeless tobacco is not routed to the smoking (lung-first) topic", () => {
    it.each([
      "Is chewing tobacco also a cancer risk, or is it only cigarettes?",
      "gutka khane se cancer hota hai kya?",
      "does khaini or zarda cause cancer",
      "is paan with supari harmful?",
      "smokeless tobacco and cancer",
    ])("%s", (q) => {
      const topic = detectCrossCancerTopic(q);
      expect(topic).not.toBeNull();
      expect(topic!.cancerTypes[0]).toBe("oral");
      // The first three sites are the ones crossCancerRetrieve builds per-site queries from.
      expect(topic!.cancerTypes.slice(0, 3)).not.toContain("lung");
      expect(topic!.cancerTypes.slice(0, 3)).not.toContain("bladder");
      for (const e of topic!.enhancements) {
        expect(e).not.toMatch(/\b(lung|cigarette)\b/i);
      }
    });
  });

  describe("a question that names its site is scoped to that site", () => {
    it("tobacco + oral cancer → oral / head-and-neck only", () => {
      const topic = detectCrossCancerTopic("does quitting tobacco lower my oral cancer risk?")!;
      expect(topic).not.toBeNull();
      expect(topic.cancerTypes[0]).toBe("oral");
      expect(topic.cancerTypes).not.toContain("lung");
      expect(topic.cancerTypes).not.toContain("bladder");
      for (const e of topic.enhancements) {
        expect(e).not.toMatch(/\b(lung|cigarette)\b/i);
      }
    });

    it("the half-translated Hindi query (Devanagari site words left in place) is scoped too", () => {
      const topic = detectCrossCancerTopic("what tobacco छोड़ने के बाद मुँह के कैंसर का risk")!;
      expect(topic).not.toBeNull();
      expect(topic.cancerTypes).not.toContain("lung");
      expect(topic.cancerTypes[0]).toBe("oral");
    });
  });

  describe("unchanged behaviour", () => {
    it("a generic smoking question still fans out across sites, lung first", () => {
      const topic = detectCrossCancerTopic("does smoking cause cancer?")!;
      expect(topic.topic).toBe("smoking");
      expect(topic.cancerTypes[0]).toBe("lung");
      expect(topic.cancerTypes.length).toBeGreaterThan(5);
    });

    it("'other cancers besides lung cancer' is NOT narrowed to lung — it asks beyond it", () => {
      const topic = detectCrossCancerTopic("does smoking cause other cancers besides lung cancer")!;
      expect(topic.topic).toBe("smoking");
      expect(topic.cancerTypes.length).toBeGreaterThan(5);
    });

    it("a question with no cross-cancer topic returns null", () => {
      expect(detectCrossCancerTopic("what are the stages of breast cancer")).toBeNull();
    });
  });
});
