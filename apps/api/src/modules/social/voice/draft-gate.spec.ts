import { ContentBrief } from "../social.types";
import { gateDraft } from "./draft-gate";
import { checkSources } from "./source-check";
import { scoreEditorial, EDITORIAL_GATE } from "./editorial-score";
import { webChatLink, whatsappLink, siteLink } from "../links";

const brief: ContentBrief = {
  topicId: "pmjay",
  lane: "practical",
  title: "PM-JAY",
  angle: "test",
  facts: [
    { text: "PM-JAY gives health cover of Rs 5 lakh per family per year for hospital care.", url: "https://www.pib.gov.in/x", fetchedOn: "2026-11-25" },
    { text: "Call the helpline 14555 to find out whether you are covered.", url: "https://example.gov.in/h", fetchedOn: "2026-11-25" },
  ],
  nextStep: "chat",
};

const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe("source check", () => {
  const good = `PM-JAY gives eligible families health cover of Rs 5 lakh a year for hospital care. Call 14555 to check.\n${webChatLink("x")}`;

  it("passes a post that states only sourced facts and ends with its link", () => {
    expect(checkSources("x", good, brief)).toEqual([]);
  });

  it("fails a number that is not in the sources", () => {
    expect(codes(checkSources("x", good.replace("5 lakh", "10 lakh"), brief))).toContain("unsourced_number");
  });

  it("fails a statistic that is not in the sources", () => {
    expect(codes(checkSources("x", `About 40% of families qualify.\n${webChatLink("x")}`, brief))).toContain("unsourced_number");
  });

  it("allows a source link and fails any other link", () => {
    expect(checkSources("x", `Source https://www.pib.gov.in/x\n${webChatLink("x")}`, brief)).toEqual([]);
    expect(codes(checkSources("x", `See https://blog.example.com/pmjay\n${webChatLink("x")}`, brief))).toContain("unknown_link");
  });

  it("needs exactly one next-step link with this platform's code, last", () => {
    expect(codes(checkSources("x", "No link at all.", brief))).toContain("next_step_missing");
    expect(codes(checkSources("x", `Wrong code.\n${webChatLink("linkedin")}`, brief))).toContain("next_step_missing");
    expect(codes(checkSources("x", `${webChatLink("x")}\nSource https://www.pib.gov.in/x`, brief))).toContain("next_step_position");
  });

  it("accepts the Facebook WhatsApp link and a site link", () => {
    expect(checkSources("facebook", `Call 14555.\n${whatsappLink("facebook")}`, brief)).toEqual([]);
    expect(checkSources("facebook", `Call 14555.\n${siteLink("/find-care/hospitals/", "facebook")}`, brief)).toEqual([]);
  });

  it("refuses a link on Instagram and does not force a profile formula", () => {
    expect(codes(checkSources("instagram", `Call 14555. ${webChatLink("instagram")}`, brief))).toContain("instagram_link");
    expect(checkSources("instagram", "To find out whether you are covered, call the helpline 14555.", brief)).toEqual([]);
  });

  describe("web addresses", () => {
    const portal: ContentBrief = {
      ...brief,
      facts: [...brief.facts, { text: "A family can check its cover on the beneficiary portal, beneficiary.nha.gov.in.", url: "https://beneficiary.nha.gov.in/", fetchedOn: "2026-11-25" }],
    };
    const post = (addr: string) => `Check your family's cover at ${addr} or call 14555.\n${webChatLink("x")}`;

    it("allows the address the facts name", () => {
      expect(checkSources("x", post("beneficiary.nha.gov.in"), portal)).toEqual([]);
      expect(checkSources("x", post("beneficiary.nha.gov.in."), portal)).toEqual([]);
    });

    it("fails a look-alike that puts the real host first", () => {
      const hits = checkSources("x", post("beneficiary.nha.gov.in.cover-check.xyz"), portal);
      expect(hits).toContainEqual(expect.objectContaining({ code: "unknown_link", excerpt: "beneficiary.nha.gov.in.cover-check.xyz" }));
    });

    it("fails a look-alike with an ending outside the usual few", () => {
      expect(codes(checkSources("x", post("beneficiary-nha.online"), portal))).toContain("unknown_link");
      expect(codes(checkSources("x", post("nha-gov.in"), portal))).toContain("unknown_link");
    });

    it("fails a subdomain of a source host that no fact names", () => {
      expect(codes(checkSources("x", post("cover.beneficiary.nha.gov.in"), portal))).toContain("unknown_link");
    });

    it("does not read a decimal number as an address", () => {
      expect(codes(checkSources("x", `Cover is 5.0 lakh. Call 14555.\n${webChatLink("x")}`, brief))).not.toContain("unknown_link");
    });
  });

  it("holds text in Devanagari or another non-Latin script instead of skipping it", () => {
    const hindi = `PM-JAY gives eligible families health cover of Rs 5 lakh a year for hospital care.\nइलाज के लिए 10 लाख रुपये मिलते हैं।\n${webChatLink("x")}`;
    expect(codes(checkSources("x", hindi, brief))).toContain("non_latin");
    expect(gateDraft("x", hindi, brief).passed).toBe(false);
    expect(codes(checkSources("instagram", "Call the helpline 14555 to find out whether you are covered.", brief, "হেল্পলাইন 14555"))).toContain("non_latin");
    expect(codes(checkSources("x", `Rs 5 lakh, or ₹5 lakh, for hospital care. Call 14555.\n${webChatLink("x")}`, brief))).not.toContain("non_latin");
  });

  it("fails clinical words that the sources do not use, in the safe lanes", () => {
    const text = `Early screening can catch symptoms. Call 14555.\n${webChatLink("x")}`;
    expect(codes(checkSources("x", text, brief))).toContain("clinical_term");
  });

  it("allows a clinical word that the source itself uses", () => {
    const ep: ContentBrief = { ...brief, title: "Onco Talks Episode 3: Cancer Surgery", facts: [{ text: "This episode is about cancer surgery.", url: "https://suchitracancercare.org/watch/x/", fetchedOn: "2026-11-25" }], allowedTerms: ["cancer surgery"] };
    expect(codes(checkSources("x", `In episode 3 an oncologist speaks about cancer surgery.\n${webChatLink("x")}`, ep))).not.toContain("clinical_term");
  });
});

describe("editorial score", () => {
  it("rewards a plain, sourced, useful post", () => {
    const s = scoreEditorial("facebook", `PM-JAY gives eligible families health cover of Rs 5 lakh a year for hospital care. To find out whether your family is covered, call the helpline on 14555.\n${whatsappLink("facebook")}`, brief);
    expect(s.total).toBeGreaterThanOrEqual(EDITORIAL_GATE);
  });

  it("gives the old scorer's favourite habits nothing and marks down sales talk", () => {
    // The old scorer gave points for a question opener, "did you know", Bihar and a timeframe.
    const oldStyle = `Did you know? In Bihar, many families wait 2-3 weeks. Our holistic, world-class programme empowers families to transform their lives with seamless care.\n${webChatLink("facebook")}`;
    const s = scoreEditorial("facebook", oldStyle, brief);
    expect(s.total).toBeLessThan(EDITORIAL_GATE);
    expect(s.notes.join(" ")).toMatch(/sales word/);
  });

  it("scores accuracy against the source", () => {
    const s = scoreEditorial("facebook", `PM-JAY gives cover of Rs 7 lakh. Call 14555.\n${whatsappLink("facebook")}`, brief);
    expect(s.sourceAccuracy).toBeLessThan(25);
  });
});

describe("gateDraft", () => {
  it("passes a good draft", () => {
    const r = gateDraft("x", `PM-JAY gives eligible families health cover of Rs 5 lakh a year for hospital care. Call 14555 to check.\n${webChatLink("x")}`, brief);
    expect(r.violations).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("fails on any hard rule whatever the score", () => {
    const r = gateDraft("x", `PM-JAY gives eligible families health cover of Rs 5 lakh a year; call 14555.\n${webChatLink("x")}`, brief);
    expect(r.passed).toBe(false);
    expect(codes(r.violations)).toContain("semicolon");
  });
});
