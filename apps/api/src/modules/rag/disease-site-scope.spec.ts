import { askedDiseaseSites, scopeChunksToAskedSites, chunkDiseaseSites } from "./disease-site-scope";

/**
 * Issue #170 — "a reply must not silently substitute a different disease site
 * than the one asked about". When the user's own message names a site, evidence
 * from documents about a DIFFERENT site is not allowed to answer it. The safe
 * failure is fewer (or zero) chunks, which the evidence gate turns into an
 * abstention — never a lung answer to a mouth question.
 *
 * Titles below mirror the shape of real KB document titles (see kb/manifest.json);
 * questions are synthetic.
 */
const chunk = (id: string, title: string) => ({
  chunkId: id,
  docId: id.split("::")[0],
  content: "synthetic chunk text",
  document: { title, sourceType: null, source: null, citation: null, isTrustedSource: true },
});

const LUNG_PREVENTION = chunk("lung_prevention::3", "Lung Cancer Prevention (PDQ®) - NCI");
const NSCLC_TREATMENT = chunk("nsclc_treatment::9", "Non-Small Cell Lung Cancer Treatment (PDQ®) - NCI");
const BLADDER_RISK = chunk("bladder_risk::2", "Bladder Cancer Causes & Risk Factors");
const ORAL_PREVENTION = chunk(
  "oral_prevention::4",
  "Oral Cavity, Oropharynx, Hypopharynx, & Larynx Cancer Prevention (PDQ®) - NCI"
);
const ORAL_LOCAL = chunk("oral_local::1", "Oral Cancer: Signs, Diagnosis, and Treatment Basics");
const MOUTH_ULCER = chunk("mouth_ulcer::1", "Persistent Mouth Ulcer: When to Worry");
const TOBACCO_GENERIC = chunk("tobacco::5", "Tobacco and Cancer");

describe("askedDiseaseSites (#170)", () => {
  it("the Hindi mouth-cancer question asks about the oral site", () => {
    expect(askedDiseaseSites("तंबाकू छोड़ने के बाद मुँह के कैंसर का जोखिम कितना रहता है?")).toEqual(["oral"]);
  });

  it("an English question naming the site", () => {
    expect(askedDiseaseSites("Does my oral cancer risk drop after I quit tobacco?")).toEqual(["oral"]);
  });

  it("a question naming two sites asks about both", () => {
    expect(askedDiseaseSites("difference between oral cancer and lung cancer")).toEqual(
      expect.arrayContaining(["oral", "lung"])
    );
  });

  it("a question naming no site asks about none", () => {
    expect(askedDiseaseSites("क्या कैंसर के मरीज़ को टीका लगवाना चाहिए?")).toEqual([]);
    expect(askedDiseaseSites("Is chewing tobacco a cancer risk?")).toEqual([]);
  });

  it("a question that looks BEYOND the named site is not scoped to it", () => {
    expect(askedDiseaseSites("Does smoking cause other cancers besides lung cancer?")).toEqual([]);
    expect(askedDiseaseSites("apart from lung cancer, which cancers does smoking cause?")).toEqual([]);
    expect(askedDiseaseSites("क्या फेफड़ों के कैंसर के अलावा दूसरे कैंसर भी होते हैं?")).toEqual([]);
  });
});

describe("chunkDiseaseSites", () => {
  it("reads the site a document is about from its title", () => {
    expect(chunkDiseaseSites(LUNG_PREVENTION)).toEqual(["lung"]);
    expect(chunkDiseaseSites(BLADDER_RISK)).toEqual(["bladder"]);
    expect(chunkDiseaseSites(ORAL_LOCAL)).toEqual(["oral"]);
  });

  it("a title with no named cancer site is site-agnostic", () => {
    expect(chunkDiseaseSites(MOUTH_ULCER)).toEqual([]);
    expect(chunkDiseaseSites(TOBACCO_GENERIC)).toEqual([]);
    expect(chunkDiseaseSites({ document: { title: "" } } as any)).toEqual([]);
  });
});

describe("scopeChunksToAskedSites (#170)", () => {
  it("drops lung and bladder evidence from an oral-cancer question; keeps oral, head-and-neck and site-agnostic evidence", () => {
    const { kept, dropped } = scopeChunksToAskedSites(
      [LUNG_PREVENTION, NSCLC_TREATMENT, ORAL_PREVENTION, BLADDER_RISK, MOUTH_ULCER, TOBACCO_GENERIC, ORAL_LOCAL],
      ["oral"]
    );
    expect(kept.map((c) => c.chunkId)).toEqual([
      "oral_prevention::4",
      "mouth_ulcer::1",
      "tobacco::5",
      "oral_local::1",
    ]);
    expect(dropped.map((c) => c.chunkId)).toEqual(["lung_prevention::3", "nsclc_treatment::9", "bladder_risk::2"]);
  });

  it("safe failure: when every chunk is about another site, nothing is kept (the gate abstains)", () => {
    const { kept, dropped } = scopeChunksToAskedSites([LUNG_PREVENTION, NSCLC_TREATMENT], ["oral"]);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(2);
  });

  it("no asked site → no scoping at all", () => {
    const all = [LUNG_PREVENTION, ORAL_PREVENTION, BLADDER_RISK];
    const { kept, dropped } = scopeChunksToAskedSites(all, []);
    expect(kept).toEqual(all);
    expect(dropped).toEqual([]);
  });

  it("a lung question keeps lung evidence and drops the oral document", () => {
    const { kept } = scopeChunksToAskedSites([LUNG_PREVENTION, ORAL_PREVENTION, TOBACCO_GENERIC], ["lung"]);
    expect(kept.map((c) => c.chunkId)).toEqual(["lung_prevention::3", "tobacco::5"]);
  });

  it("a document that covers the asked site among others is kept", () => {
    const multi = chunk("multi::1", "Lung Cancer and Oral Cancer: Shared Risk Factors");
    expect(scopeChunksToAskedSites([multi], ["oral"]).kept).toEqual([multi]);
  });
});
