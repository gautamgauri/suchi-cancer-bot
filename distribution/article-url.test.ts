import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { articleUrl } from "./article-url";

test("cancer type articles use the live /cancer-types/ hub", () => {
  assert.equal(
    articleUrl("cancer_type", "breast-cancer"),
    "https://suchitracancercare.org/cancer-types/breast-cancer/",
  );
});

test("never builds the old /cancer-type/ path that 404s", () => {
  for (const type of ["cancer_type", "symptom", "find_care", "treatment", "unknown"]) {
    assert.ok(!articleUrl(type, "x").includes("/cancer-type/"), type);
  }
});

test("other content types follow the landing site's routes", () => {
  assert.equal(articleUrl("symptom", "persistent-cough"), "https://suchitracancercare.org/symptoms/persistent-cough/");
  assert.equal(articleUrl("find_care", "pmjay-cancer-coverage"), "https://suchitracancercare.org/find-care/pmjay-cancer-coverage/");
  assert.equal(articleUrl("treatment", "chemotherapy"), "https://suchitracancercare.org/tests-treatment/treatments/chemotherapy/");
  assert.equal(articleUrl("unknown", "x"), "https://suchitracancercare.org/resources/x/");
});

test("map matches the landing site's own route map", () => {
  const layout = fs.readFileSync(
    path.resolve(__dirname, "../apps/landing/src/layouts/ArticlePageLayout.astro"),
    "utf-8",
  );
  const block = layout.match(/CONTENT_TYPE_TO_URL[^{]*\{([\s\S]*?)\};/);
  assert.ok(block, "CONTENT_TYPE_TO_URL not found in ArticlePageLayout.astro");
  const pairs = [...block[1].matchAll(/(\w+):\s*'([^']+)'/g)];
  assert.ok(pairs.length >= 5);
  for (const [, type, segment] of pairs) {
    assert.equal(articleUrl(type, "s"), `https://suchitracancercare.org/${segment}/s/`, type);
  }
});
