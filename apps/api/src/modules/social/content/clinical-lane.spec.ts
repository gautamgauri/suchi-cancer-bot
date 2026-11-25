import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { assertLaneAllowed, clinicalBriefFromArticle, isReviewed } from "./clinical-lane";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");
const md = (status?: string) => `---
title: "Test"
${status ? `review_status: ${status}` : ""}
---
# Heading

This sentence is long enough to count as one fact from the article itself.
`;

describe("clinical lane", () => {
  it.each(["reviewed", "published"])("opens for %s", (s) => {
    expect(isReviewed(s)).toBe(true);
    const r = clinicalBriefFromArticle("t", md(s), "/symptoms/t/");
    expect(r.allowed).toBe(true);
    expect(r.brief!.lane).toBe("clinical");
    expect(r.brief!.facts[0].url).toBe("https://suchitracancercare.org/symptoms/t/");
  });

  it.each(["ai_draft", "flagged", undefined])("stays shut for %s", (s) => {
    const r = clinicalBriefFromArticle("t", md(s), "/symptoms/t/");
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/clinician|missing/);
  });

  it("stays shut for every site article today, all marked ai_draft", () => {
    const dir = join(REPO_ROOT, "apps/landing/src/content/articles");
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = clinicalBriefFromArticle(f.replace(/\.md$/, ""), readFileSync(join(dir, f), "utf8"), `/x/${f}/`);
      expect(r.allowed).toBe(false);
    }
  });

  it("the final check refuses an unreviewed clinical brief and lets the safe lanes through", () => {
    expect(() => assertLaneAllowed({ lane: "clinical" })).toThrow(/blocked/);
    expect(() => assertLaneAllowed({ lane: "clinical", article: { slug: "a", reviewStatus: "ai_draft" } })).toThrow(/blocked/);
    expect(() => assertLaneAllowed({ lane: "clinical", article: { slug: "a", reviewStatus: "reviewed" } })).not.toThrow();
    expect(() => assertLaneAllowed({ lane: "practical" })).not.toThrow();
    expect(() => assertLaneAllowed({ lane: "onco_talks" })).not.toThrow();
  });
});
