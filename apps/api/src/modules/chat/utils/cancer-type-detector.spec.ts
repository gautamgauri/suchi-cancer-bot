import { detectCancerType, detectCancerTypes, detectExplicitCancerTypes } from "./cancer-type-detector";

/**
 * Issue #170 — a Hindi question about MOUTH cancer on a session already tagged
 * `lung` was answered with lung-cancer content. The detector had no Devanagari
 * site words at all, so "मुँह के कैंसर" named no type and the stale `lung` tag
 * steered retrieval. Synthetic texts only.
 */
describe("detectCancerType — Hindi / Hinglish disease sites (#170)", () => {
  it("a Devanagari mouth-cancer question overrides a stale lung session tag (chandrabindu spelling)", () => {
    expect(detectCancerType("तंबाकू छोड़ दिया है, क्या अब भी मुँह के कैंसर का डर है?", "lung")).toBe("oral");
  });

  it("anusvara spelling and the का/की postpositions", () => {
    expect(detectCancerType("मुंह का कैंसर कैसे पहचानें", "lung")).toBe("oral");
    expect(detectCancerType("मुंह की कैंसर जांच", null)).toBe("oral");
  });

  it("lung in its oblique plural form, breast, stomach", () => {
    expect(detectCancerType("फेफड़ों के कैंसर के लक्षण", "breast")).toBe("lung");
    expect(detectCancerType("फेफड़े का कैंसर", null)).toBe("lung");
    expect(detectCancerType("स्तन कैंसर की जांच", "lung")).toBe("breast");
    expect(detectCancerType("पेट के कैंसर का इलाज", "lung")).toBe("stomach");
  });

  it("Hinglish mouth-cancer wording overrides the session tag", () => {
    expect(detectCancerType("tambaku chhodne ke baad bhi munh ke cancer ka khatra hai kya", "lung")).toBe("oral");
    expect(detectCancerType("muh ka cancer", "lung")).toBe("oral");
  });

  it("a bare organ word without cancer wording is not a disease (session tag kept)", () => {
    expect(detectCancerType("मुँह में छाले हो गए हैं", "breast")).toBe("breast");
    expect(detectCancerType("पेट में दर्द है", "lung")).toBe("lung");
    expect(detectCancerTypes("मुँह में छाले")).toEqual([]);
  });

  it("an organ word inside a longer Devanagari word does not count (प्रमुख = 'major', not मुख = 'mouth')", () => {
    expect(detectCancerTypes("भारत में प्रमुख कैंसर कौन से हैं?")).toEqual([]);
    expect(detectCancerType("भारत में प्रमुख कैंसर कौन से हैं?", "lung")).toBe("lung");
  });

  it("detectExplicitCancerTypes lists every site the message itself names", () => {
    const sites = detectExplicitCancerTypes("मुँह के कैंसर और फेफड़ों के कैंसर में क्या फर्क है?");
    expect(sites).toHaveLength(2);
    expect(sites).toEqual(expect.arrayContaining(["oral", "lung"]));
    expect(detectExplicitCancerTypes("oral cancer after quitting tobacco")).toEqual(["oral"]);
    expect(detectExplicitCancerTypes("क्या कैंसर के मरीज़ को टीका लगवाना चाहिए?")).toEqual([]);
  });
});

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

  describe("a session tag is only overturned by an explicit naming", () => {
    it("keeps the session type when an organ is mentioned as a symptom", () => {
      // A lung-cancer patient describing a side effect must not have the answer
      // reframed around stomach cancer.
      expect(detectCancerType("I have stomach pain after chemo", "lung")).toBe("lung");
      expect(detectCancerType("my skin is dry and my mouth hurts", "lung")).toBe("lung");
    });

    it("switches when the message names the other cancer", () => {
      expect(detectCancerType("is stomach cancer treatable?", "lung")).toBe("stomach");
      expect(detectCancerType("cancer of the stomach — what is the treatment?", "lung")).toBe("stomach");
    });

    it("still picks up a bare organ when there is no session type to protect", () => {
      expect(detectCancerType("stomach pain", null)).toBe("stomach");
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

    it("recognises oral cancer, a supported type with its own essential terms", () => {
      expect(detectCancerType("oral cancer treatment", "breast")).toBe("oral");
      expect(detectCancerType("mouth cancer ke lakshan", "breast")).toBe("oral");
      expect(detectCancerType("oral cavity cancer")).toBe("oral");
      expect(detectCancerTypes("Biopsy of the oral lesion confirms oral cancer")).toContain("oral");
    });

    it("does not read everyday 'oral'/'mouth' wording as oral cancer", () => {
      expect(detectCancerType("can I take oral chemotherapy at home?", "breast")).toBe("breast");
      expect(detectCancerTypes("temporal lobe changes and mouth sores")).toEqual([]);
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
