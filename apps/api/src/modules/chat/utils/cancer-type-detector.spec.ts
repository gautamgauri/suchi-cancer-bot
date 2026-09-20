import { detectCancerType, detectCancerTypes } from "./cancer-type-detector";

/**
 * Issue #175 — a WhatsApp session tagged `breast` answered a *prostate*
 * question with breast screening notes. Two things had to be true for that:
 * the session tag was returned before the message was even looked at, and the
 * message's "Prostrate" typo matched no keyword. Both are covered here.
 */
describe("detectCancerType", () => {
  describe("the current message wins over the session tag", () => {
    it("returns the type named in the message, not the stale session type", () => {
      expect(detectCancerType("What are the treatment options for prostate cancer?", "breast")).toBe("prostate");
    });

    it("handles the reported typo 'Prostrate' with a stale breast session", () => {
      // The exact message from the issue (the tester's own probe text).
      expect(detectCancerType("Prostrate cancer treatment options India", "breast")).toBe("prostate");
    });

    it("still switches when the session tag matches no essential-term set", () => {
      expect(detectCancerType("lung cancer screening", "thyroid")).toBe("lung");
    });
  });

  describe("the session tag remains the fallback", () => {
    it("is used when the message names no cancer type", () => {
      expect(detectCancerType("kya cancer ka ilaj sambhav hai?", "breast")).toBe("breast");
    });

    it("yields null when neither the message nor the session names a type", () => {
      expect(detectCancerType("kya cancer ka ilaj sambhav hai?")).toBeNull();
      expect(detectCancerType("what should I ask my doctor?", null)).toBeNull();
    });
  });

  describe("keyword mapping", () => {
    it("keeps the existing aliases", () => {
      expect(detectCancerType("colon cancer")).toBe("colorectal");
      expect(detectCancerType("melanoma")).toBe("skin");
      expect(detectCancerType("larynx")).toBe("laryngeal");
    });

    it("accepts common spelling variants", () => {
      expect(detectCancerType("prostrate")).toBe("prostate");
      expect(detectCancerType("leukaemia treatment")).toBe("leukemia");
      expect(detectCancerType("oesophageal cancer")).toBe("esophageal");
    });
  });
});

describe("detectCancerTypes", () => {
  it("lists every cancer type named in the text", () => {
    expect(detectCancerTypes("Mammogram confirms breast cancer; PSA is for prostate cancer")).toEqual([
      "breast",
      "prostate",
    ]);
  });

  it("de-duplicates aliases of the same type", () => {
    expect(detectCancerTypes("colon and colorectal cancer")).toEqual(["colorectal"]);
  });

  it("returns an empty list when no type is named", () => {
    expect(detectCancerTypes("kya cancer ka ilaj sambhav hai?")).toEqual([]);
  });
});
