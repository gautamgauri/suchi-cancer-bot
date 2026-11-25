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

  it("refuses a link on Instagram and asks for the profile sentence", () => {
    expect(codes(checkSources("instagram", `Call 14555. ${webChatLink("instagram")}`, brief))).toEqual(expect.arrayContaining(["instagram_link", "next_step_missing"]));
    expect(checkSources("instagram", "Call 14555. The link is in our profile.", brief)).toEqual([]);
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
    expect(s.sourceAccuracy).toBeLessThanOrEqual(15);
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
