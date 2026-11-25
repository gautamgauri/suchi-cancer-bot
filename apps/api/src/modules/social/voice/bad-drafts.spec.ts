/**
 * Bad drafts the gate should stop. The independent review of PR #265 found
 * 27 drafts that passed the first gate. Their texts were not available to the
 * author of this change, so this set was written from the categories the
 * review named (an instruction about medicines, the reader addressed as a
 * patient, promises, fear, engagement bait, a named doctor, numbers in words,
 * bare links, inflected clinical words, drug names, sentences off the brief,
 * groups of three, slogans and sign-offs) and from the review's one quoted
 * case.
 *
 * Two drafts still pass, on purpose, and are pinned here so the limit is
 * visible: a claim made in the brief's own words that the source does not
 * support. The gate compares strings. The owner's reading against the source
 * links is the check for those.
 */
import { ContentBrief, Platform } from "../social.types";
import { gateDraft } from "./draft-gate";
import { webChatLink } from "../links";
import { NCI_RECORDS, PMJAY_CHECK, PMJAY_COVER, PMJAY_HELPLINE } from "../content/sources";
import { EDITORIAL_GATE } from "./editorial-score";

const records: ContentBrief = { topicId: "keep-records", lane: "practical", title: "Keeping medical papers in one place", angle: "", facts: NCI_RECORDS, nextStep: "chat" };
const pmjay: ContentBrief = { topicId: "pmjay-check", lane: "practical", title: "Checking PM-JAY cover", angle: "", facts: [PMJAY_COVER, PMJAY_CHECK, PMJAY_HELPLINE], nextStep: "chat" };

interface Case { id: number; what: string; text: string; brief: ContentBrief; platform?: Platform }

export const BAD_DRAFTS: Case[] = [
  { id: 1, what: "instruction to stop medicines (the review's quoted case)", brief: records, text: "Don't take medicines. Keep a folder with the dates of medical visits and copies of test results." },
  { id: 2, what: "reader addressed as a patient", brief: records, text: "Keep copies of your test results and treatment plans after your diagnosis." },
  { id: 3, what: "reader told they were diagnosed", brief: records, text: "When you were diagnosed, the doctor gave you treatment plans. Keep them in a folder." },
  { id: 4, what: "promise of recovery", brief: records, text: "Keeping test results in a folder means a full recovery is easier." },
  { id: 5, what: "fear", brief: records, text: "Lost test results can be dangerous. Keep them in a folder before it is too late." },
  { id: 6, what: "engagement bait, please share", brief: records, text: "Keep treatment plans and test results in a folder. Please share this with every family you know." },
  { id: 7, what: "engagement bait, tag a friend", brief: records, text: "Keep test results in a folder. Tag a friend who needs this." },
  { id: 8, what: "a named doctor", brief: records, text: "Dr Sharma says keep test results and treatment plans in a folder." },
  { id: 9, what: "number written in words", brief: pmjay, text: "PM-JAY gives a cover of ten lakh rupees per family per year." },
  { id: 10, what: "bare www link", brief: pmjay, text: "Check your family's cover at www.pmjay-check.com or call 14555." },
  { id: 11, what: "bare domain link", brief: pmjay, text: "Check whether the family is covered at pmjaycard.in before going to hospital." },
  { id: 12, what: "plural clinical word", brief: records, text: "Keep test results in a folder and note any symptoms." },
  { id: 13, what: "drug name and dose", brief: records, text: "Keep test results in a folder, with a note of each tamoxifen dose." },
  { id: 14, what: "common clinical term outside the brief", brief: records, text: "Keep test results in a folder, and keep the family away from tobacco." },
  { id: 15, what: "sentence off the brief", brief: records, text: "Keep test results in a folder. Mangoes are in season in Bihar this month." },
  { id: 16, what: "group of three", brief: records, text: "Keep test results, treatment plans and bills in a folder." },
  { id: 17, what: "closing slogan", brief: records, text: "Keep test results and treatment plans in a folder. Small steps make all the difference." },
  { id: 18, what: "sign-off about Suchi", brief: records, text: "Keep test results and treatment plans in a folder. Suchi can help you with this." },
  { id: 19, what: "question opener", brief: records, text: "Lost the test results again? Keep them in a folder." },
  { id: 20, what: "exclamation", brief: records, text: "Keep test results and treatment plans in a folder!" },
  { id: 21, what: "sales talk", brief: records, text: "Our holistic approach keeps test results and treatment plans in one seamless folder." },
  { id: 22, what: "war language", brief: records, text: "Every fighter should keep test results and treatment plans in a folder." },
  { id: 23, what: "hashtag on X", brief: records, platform: "x", text: "Keep test results and treatment plans in a folder. #CancerCare" },
  { id: 24, what: "stacked parallel sentences", brief: records, text: "Keep the test results. Keep the treatment plans. Keep the medical bills." },
  { id: 25, what: "dash and semicolon", brief: records, text: "Keep test results in a folder — and bills; dated." },
  { id: 26, what: "claim in the brief's own words that the source does not make", brief: records, text: "Keep test results and treatment plans in a folder, or the hospital may refuse the next visit." },
  { id: 27, what: "fact changed in the brief's own words", brief: pmjay, text: "PM-JAY covers hospital care for every family in India, at any hospital." },
];

/** The drafts the gate cannot stop. The owner's reading is the check. */
export const STILL_PASS = [26, 27];

function run(c: Case) {
  const p = c.platform ?? "facebook";
  return gateDraft(p, `${c.text}\n${webChatLink(p)}`, c.brief);
}

describe("bad drafts", () => {
  for (const c of BAD_DRAFTS) {
    const expectBlocked = !STILL_PASS.includes(c.id);
    it(`${c.id}. ${c.what}: ${expectBlocked ? "blocked" : "still passes, a known limit"}`, () => {
      const r = run(c);
      expect(r.passed).toBe(!expectBlocked);
    });
  }

  it("scores a draft unrelated to its brief below the gate", () => {
    const r = gateDraft("facebook", `Mangoes are in season in Bihar this month, and the markets are busy.\n${webChatLink("facebook")}`, records);
    expect(r.score.total).toBeLessThan(EDITORIAL_GATE);
  });

  it("scores the sales-talk and off-brief drafts below the gate on score alone", () => {
    for (const id of [15, 21]) {
      const c = BAD_DRAFTS.find((x) => x.id === id)!;
      expect(run(c).score.total).toBeLessThan(EDITORIAL_GATE);
    }
  });
});
