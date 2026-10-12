import * as fs from "fs";
import * as path from "path";
import {
  asksAboutPregnancyNotNursing,
  stripLactationSections,
  scopeEvidenceToPregnancyScenario,
} from "./scenario-section-filter";

/**
 * Issue #126 — residual defect after #131/#132/#133/#143: retrieval now ranks the
 * right document first, but the pregnancy answer still carries a lactation bullet
 * ("breastfeeding is stopped … breast milk … nursing baby") in 3/3 runs, for a
 * woman who is PREGNANT, not nursing. The source is one chunk (::35) that holds
 * `### Lactation` followed by `### Fetal Consequences of Maternal Breast Cancer`.
 * The KB text is correct; only the applicability is wrong. So the fix is an
 * evidence-side filter: for a pregnancy question that does not ask about
 * breastfeeding, the lactation section is removed from the evidence before
 * composition. No text is written or reworded — sections are only kept or cut.
 *
 * The fixture is the verbatim NCI PDQ excerpt (public domain) already used by the
 * #129 reference-chunk tests. Questions are synthetic.
 */
const FIXTURE = path.resolve(__dirname, "__fixtures__/pdq-pregnancy-breast-treatment.excerpt.md");
const fixtureText = fs.readFileSync(FIXTURE, "utf8");
function section(name: string): string {
  const marker = `<!-- FIXTURE:${name} -->\n`;
  const start = fixtureText.indexOf(marker);
  if (start < 0) throw new Error(`fixture section ${name} missing`);
  const body = fixtureText.slice(start + marker.length);
  const end = body.indexOf("<!-- FIXTURE:");
  return (end < 0 ? body : body.slice(0, end)).trimEnd();
}
const specialConsiderations = section("special-considerations"); // chunk ::35
const chemotherapyProse = section("chemotherapy-prose"); // chunk ::18

const LACTATION_TERMS = /lactation|breast\s*milk|breast-?feed|nursing/i;

const chunk = (chunkId: string, content: string, title = "Breast Cancer Treatment During Pregnancy (PDQ®)") => ({
  chunkId,
  docId: chunkId.split("::")[0],
  content,
  similarity: 0.7,
  document: { title, sourceType: null, source: null, citation: null, isTrustedSource: true },
});

describe("asksAboutPregnancyNotNursing (#126)", () => {
  it.each([
    "my sister is pregnant and on chemo — will the medicine affect the baby?",
    "meri bhabhi pregnant hai, kya chemo se bachche ko nuksaan hoga?",
    "wo garbhvati hai, cancer ki dawai safe hai kya",
    "मेरी बहन गर्भवती है, कीमो से बच्चे को नुकसान होगा?",
    "is radiation safe during pregnancy?",
    "chemotherapy in the second trimester — risks to the fetus?",
  ])("pregnancy question: %s", (q) => {
    expect(asksAboutPregnancyNotNursing(q)).toBe(true);
  });

  it.each([
    "kya chemotherapy ke dauraan breastfeeding karna safe hai?",
    "can I breastfeed while on chemo?",
    "क्या कीमो के दौरान स्तनपान करा सकते हैं?",
    "I was pregnant last year, now I am nursing — is chemo safe for breast milk?",
    "what is the treatment for breast cancer?",
    "",
  ])("not a pregnancy-only question: %s", (q) => {
    expect(asksAboutPregnancyNotNursing(q)).toBe(false);
  });
});

describe("stripLactationSections (#126)", () => {
  it("removes the ### Lactation section from chunk ::35 and keeps the fetal section verbatim", () => {
    expect(specialConsiderations).toMatch(/### Lactation/); // fixture guard
    const { content, removedSections } = stripLactationSections(specialConsiderations);
    expect(removedSections).toEqual(["Lactation"]);
    expect(content).not.toMatch(LACTATION_TERMS);
    expect(content).toContain("### Fetal Consequences of Maternal Breast Cancer");
    expect(content).toContain(
      "No damaging effects on the fetus from maternal breast cancer have been\ndemonstrated,"
    );
    expect(content).toContain("## Special Considerations for Pregnancy and Breast Cancer");
  });

  it("leaves a chunk with no lactation section byte-identical", () => {
    const { content, removedSections } = stripLactationSections(chemotherapyProse);
    expect(removedSections).toEqual([]);
    expect(content).toBe(chemotherapyProse);
  });

  it("also removes deeper sub-headings nested inside the lactation section, and stops at the next sibling", () => {
    const text =
      "## Special Considerations\n\n### Breastfeeding\n\nSynthetic lactation sentence one.\n\n#### Drugs in breast milk\n\nSynthetic sentence two.\n\n### Fetal Outcomes\n\nSynthetic fetal sentence.\n";
    const { content } = stripLactationSections(text);
    expect(content).not.toMatch(/Breastfeeding|breast milk|lactation sentence|sentence two/);
    expect(content).toContain("### Fetal Outcomes\n\nSynthetic fetal sentence.");
  });
});

describe("scopeEvidenceToPregnancyScenario (#126)", () => {
  const PREGNANCY_Q = "meri bhabhi pregnant hai, kya chemo se bachche ko nuksaan hoga?";
  const BREASTFEEDING_Q = "kya chemotherapy ke dauraan breastfeeding karna safe hai?";

  it("pregnancy question: the lactation section never reaches composition; the fetal and chemotherapy prose do", () => {
    const chunks = [chunk("preg::18", chemotherapyProse), chunk("preg::35", specialConsiderations)];
    const { chunks: out, trimmedChunkIds, droppedChunkIds } = scopeEvidenceToPregnancyScenario(chunks, PREGNANCY_Q);
    expect(out.map((c) => c.chunkId)).toEqual(["preg::18", "preg::35"]);
    expect(trimmedChunkIds).toEqual(["preg::35"]);
    expect(droppedChunkIds).toEqual([]);
    for (const c of out) {
      expect(c.content).not.toMatch(LACTATION_TERMS);
    }
    expect(out[1].content).toMatch(/Fetal Consequences/);
    // the input objects are not mutated
    expect(chunks[1].content).toMatch(/### Lactation/);
  });

  it("pregnancy question: a chunk that is ONLY lactation content is dropped entirely", () => {
    const lactationOnly = chunk(
      "local::2",
      "### Lactation\n\nSynthetic text about breast milk and a nursing baby during chemotherapy.\n"
    );
    const { chunks: out, droppedChunkIds } = scopeEvidenceToPregnancyScenario(
      [chunk("preg::18", chemotherapyProse), lactationOnly],
      PREGNANCY_Q
    );
    expect(out.map((c) => c.chunkId)).toEqual(["preg::18"]);
    expect(droppedChunkIds).toEqual(["local::2"]);
  });

  it("pregnancy question: a headingless chunk from a breastfeeding document is dropped", () => {
    const bf = chunk(
      "bf::1",
      "Many anticancer drugs can pass into breast milk, so nursing is usually paused during treatment. (synthetic)",
      "Breastfeeding During Cancer Treatment"
    );
    const { chunks: out } = scopeEvidenceToPregnancyScenario([chunk("preg::18", chemotherapyProse), bf], PREGNANCY_Q);
    expect(out.map((c) => c.chunkId)).toEqual(["preg::18"]);
  });

  it("control (probe D): a genuine breastfeeding question keeps the lactation section untouched", () => {
    const chunks = [chunk("preg::35", specialConsiderations)];
    const { chunks: out, trimmedChunkIds } = scopeEvidenceToPregnancyScenario(chunks, BREASTFEEDING_Q);
    expect(trimmedChunkIds).toEqual([]);
    expect(out[0].content).toBe(specialConsiderations);
  });

  it("a question that is not about pregnancy is untouched", () => {
    const chunks = [chunk("preg::35", specialConsiderations)];
    const { chunks: out } = scopeEvidenceToPregnancyScenario(chunks, "what is stage 2 breast cancer?");
    expect(out).toEqual(chunks);
  });
});
