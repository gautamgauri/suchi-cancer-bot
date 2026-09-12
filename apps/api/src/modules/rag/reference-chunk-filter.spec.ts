import * as fs from "fs";
import * as path from "path";
import {
  analyzeReferenceDominance,
  dropReferenceChunks,
  isReferenceDominantChunk,
} from "./reference-chunk-filter";

/**
 * Fixtures are cut from the REAL knowledge-base document behind issue #126
 * (NCI PDQ "Breast Cancer Treatment During Pregnancy"), at the same ~1400-char
 * size the ingest chunker produces, so the verdicts here are the verdicts
 * production retrieval will make on this document.
 */
const DOC = path.resolve(
  __dirname,
  "../../../../../kb/en/02_nci_core/pdq/types-breast-hp-pregnancy-breast-treatment-pdq.md"
);
const lines = fs.readFileSync(DOC, "utf8").split("\n");
const slice = (from: number, to: number) => lines.slice(from - 1, to).join("\n");

/** `###### References` heading + the first entries (chunk that starts a block). */
const referencesBlockWithHeading = slice(97, 110).slice(0, 1400);
/** Cut mid-entry, no heading — what chunks ::25 / ::26 in production look like. */
const referencesBlockMidway = slice(99, 110).slice(300, 1700);
/** `### Chemotherapy` prose with inline `[[6](#cit/section_3.6)]` markers — the answer to #126. */
const chemotherapyProse = slice(189, 215);
/** `## Special Considerations` → Lactation + Fetal Consequences (chunk ::35). */
const specialConsiderations = slice(317, 335);

describe("reference-chunk filter (issue #129)", () => {
  it("fixtures are the shapes described", () => {
    expect(referencesBlockWithHeading).toMatch(/^###### References/);
    expect(referencesBlockMidway).not.toMatch(/References/);
    expect((referencesBlockMidway.match(/PUBMED Abstract/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(chemotherapyProse).toMatch(/^### Chemotherapy/);
    expect(chemotherapyProse).toMatch(/\[\[6\]\(#cit\/section_3\.6\)/); // inline markers present
    expect(specialConsiderations).toMatch(/### Lactation/);
  });

  describe("reference blocks are dominant", () => {
    it("a block that starts with the References heading", () => {
      const a = analyzeReferenceDominance(referencesBlockWithHeading);
      expect(a.referenceDominant).toBe(true);
      expect(a.hasReferencesHeading).toBe(true);
      expect(a.pubmedLinks).toBeGreaterThanOrEqual(2);
      expect(a.proseRatio).toBeLessThan(0.5);
    });

    it("a block cut midway through an entry, with no heading (production chunks ::25 / ::26)", () => {
      const a = analyzeReferenceDominance(referencesBlockMidway);
      expect(a.referenceDominant).toBe(true);
      expect(a.rule).toBe("pubmed-density");
    });

    it("a short tail of a block: heading, two entries, links truncated by the chunk boundary", () => {
      const truncated =
        "###### References\n\n" +
        "1. Hoover HC: Breast cancer during pregnancy and lactation. Surg Clin North Am 70 (5): 1151-63, 1990. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2218825&dopt=Abstract \"http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=2218825\")\n" +
        "2. Gwyn K, Theriault R: Breast cancer during pregnancy. Oncology (Huntingt) 15 (1): 39-46, 2001. [[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/ent";
      const a = analyzeReferenceDominance(truncated);
      expect(a.referenceDominant).toBe(true);
      expect(["pubmed-density", "references-block"]).toContain(a.rule);
    });
  });

  describe("prose is kept, even with citation markup", () => {
    it("the chemotherapy-during-pregnancy section — the correct answer for #126", () => {
      const a = analyzeReferenceDominance(chemotherapyProse);
      expect(a.referenceDominant).toBe(false);
      expect(a.pubmedLinks).toBe(0);
      expect(a.proseRatio).toBeGreaterThan(0.8);
    });

    it("the Lactation + Fetal Consequences section", () => {
      expect(isReferenceDominantChunk(specialConsiderations)).toBe(false);
    });

    it("a paragraph that ends with a single PubMed link", () => {
      const prose =
        "Data suggest that it is safe to administer certain chemotherapeutic drugs after the first trimester, " +
        "with most pregnancies resulting in live births with low rates of morbidity in the newborns. " +
        "Anthracycline-based chemotherapy appears to be safe to administer during the second and/or third " +
        "trimester on the basis of limited prospective data. Safety data on the use of taxanes during pregnancy " +
        "are limited, and endocrine therapy is generally deferred until after delivery.\n\n" +
        "1. Hahn KM, Johnson PH, Gordon N, et al.: Treatment of pregnant breast cancer patients. Cancer 107 (6): 1219-26, 2006. " +
        "[[PUBMED Abstract]](http://www.ncbi.nlm.nih.gov/entrez/query.fcgi?cmd=Retrieve&db=PubMed&list_uids=16894524&dopt=Abstract)";
      expect(isReferenceDominantChunk(prose)).toBe(false);
    });

    it("an ordinary numbered checklist is not mistaken for reference entries", () => {
      const checklist =
        "Before your chemo session:\n1. Eat a light meal 2-3 hours before.\n2. Stay well hydrated.\n" +
        "3. Bring your medications list and latest blood reports.\n4. Arrange for someone to drive you home.\n" +
        "5. Wear comfortable, loose clothing with easy arm access.";
      const a = analyzeReferenceDominance(checklist);
      expect(a.referenceDominant).toBe(false);
      expect(a.numberedReferenceEntries).toBe(0);
    });

    it("Hindi / Hinglish prose", () => {
      expect(
        isReferenceDominantChunk(
          "सर्वाइकल कैंसर की जांच के लिए HPV test किया जाता है। यह जांच 30 saal ke baad karani chahiye। " +
            "Pap smear har 3 saal me karwana chahiye."
        )
      ).toBe(false);
    });

    it("an empty chunk is kept (nothing to judge)", () => {
      expect(isReferenceDominantChunk("")).toBe(false);
    });
  });

  describe("REGRESSION #126 — ranking", () => {
    it("the substantive chemotherapy chunk out-ranks the reference blocks once they are dropped", () => {
      // The production top-6 for the pregnancy question, in order, with real scores.
      const candidates = [
        { chunkId: "pregnancy::26", content: referencesBlockMidway, similarity: 0.75 },
        { chunkId: "pregnancy::25", content: referencesBlockWithHeading, similarity: 0.729 },
        { chunkId: "pregnancy::18", content: chemotherapyProse, similarity: 0.723 },
        { chunkId: "pregnancy::35", content: specialConsiderations, similarity: 0.7229 },
      ];
      const { kept, dropped } = dropReferenceChunks(candidates);
      expect(dropped.map((c) => c.chunkId)).toEqual(["pregnancy::26", "pregnancy::25"]);
      expect(kept[0].chunkId).toBe("pregnancy::18");
      expect(kept.map((c) => c.chunkId)).toEqual(["pregnancy::18", "pregnancy::35"]);
    });

    it("preserves order and keeps everything when nothing is a reference block", () => {
      const candidates = [
        { chunkId: "a", content: chemotherapyProse },
        { chunkId: "b", content: specialConsiderations },
      ];
      const { kept, dropped } = dropReferenceChunks(candidates);
      expect(dropped).toHaveLength(0);
      expect(kept.map((c) => c.chunkId)).toEqual(["a", "b"]);
    });
  });

  describe("KB-wide sanity on real PDQ documents", () => {
    // Section bodies (no References block) must never be flagged; References blocks
    // chunked at 1400 chars must be (≥ 98%). Sampled across the PDQ corpus so a
    // regex tweak cannot silently start eating prose.
    const pdqDir = path.resolve(__dirname, "../../../../../kb/en/02_nci_core/pdq");
    const files = fs.existsSync(pdqDir)
      ? fs.readdirSync(pdqDir).filter((f) => f.endsWith(".md")).sort().filter((_, i) => i % 12 === 0)
      : [];

    it("flags zero prose chunks and every reference block across sampled documents", () => {
      let proseChunks = 0;
      let proseFlagged = 0;
      let refChunks = 0;
      let refKept = 0;
      for (const f of files) {
        const text = fs.readFileSync(path.join(pdqDir, f), "utf8");
        const sections = text.split(/^###### References\s*$/m);
        // Odd/even split: sections[0] is prose; each following part starts with a
        // references block that runs until the next heading.
        for (let i = 0; i < sections.length; i++) {
          const part = sections[i];
          if (i === 0) {
            for (let k = 0; k + 700 <= part.length; k += 1400) {
              const chunk = part.slice(k, k + 1400);
              if (chunk.trim().length < 300) continue;
              proseChunks++;
              if (isReferenceDominantChunk(chunk)) proseFlagged++;
            }
          } else {
            const nextHeading = part.search(/^#{1,5}\s/m);
            const refs = nextHeading > 0 ? part.slice(0, nextHeading) : part;
            const rest = nextHeading > 0 ? part.slice(nextHeading) : "";
            if ((refs.match(/PUBMED Abstract/g) ?? []).length >= 3 && refs.length >= 1400) {
              const chunk = refs.slice(200, 1600); // mid-block, no heading
              refChunks++;
              if (!isReferenceDominantChunk(chunk)) refKept++;
            }
            for (let k = 0; k + 700 <= rest.length; k += 1400) {
              const chunk = rest.slice(k, k + 1400);
              if (chunk.trim().length < 300 || /###### References/.test(chunk)) continue;
              proseChunks++;
              if (isReferenceDominantChunk(chunk)) proseFlagged++;
            }
          }
        }
      }
      expect(files.length).toBeGreaterThan(5);
      expect(proseChunks).toBeGreaterThan(50);
      expect(refChunks).toBeGreaterThan(5);
      // The conservative side is absolute: prose is never dropped.
      expect(proseFlagged).toBe(0);
      // The recall side tolerates a sliver: a reference block that cites reports by
      // bare PDF/URL (no PubMed) may be kept; that is noise, not lost evidence.
      expect(refKept / refChunks).toBeLessThanOrEqual(0.02);
    });
  });
});
