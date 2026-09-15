/**
 * The public site domain must match the domain the landing site is actually
 * served from.
 *
 * `SUCHI_SITE_URL` shipped as `https://suchicancercare.org` — missing the "tra"
 * — in both cloudbuild files, the env default, and the social publisher's
 * fallback, while the landing site has always been served from
 * `suchitracancercare.org`. Nothing failed loudly: the value is only ever
 * interpolated into an outgoing link, so every social post the pipeline
 * published carried a URL that does not resolve.
 *
 * `apps/landing/public/CNAME` is the authority — it is what GitHub Pages serves
 * the site from — so this test reads it rather than hard-coding a second copy
 * of the domain that could drift in its turn.
 */

import { readFileSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function landingDomain(): string {
  return readFileSync(join(REPO_ROOT, "apps/landing/public/CNAME"), "utf8").trim();
}

describe("SUCHI_SITE_URL vs the landing site's real domain", () => {
  it("the env default points at the domain the landing site is served from", () => {
    const envValidation = readFileSync(
      join(REPO_ROOT, "apps/api/src/config/env.validation.ts"),
      "utf8"
    );
    const match = envValidation.match(/SUCHI_SITE_URL:\s*z[^\n]*?default\("([^"]+)"\)/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe(`https://${landingDomain()}`);
  });

  it("the social publisher's fallback points at the same domain", () => {
    const svc = readFileSync(
      join(REPO_ROOT, "apps/api/src/modules/admin/social-post.service.ts"),
      "utf8"
    );
    const match = svc.match(/SUCHI_SITE_URL\s*\?\?\s*"([^"]+)"/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe(`https://${landingDomain()}`);
  });

  it.each(["cloudbuild.yaml", "cloudbuild.gated.yaml"])(
    "%s deploys SUCHI_SITE_URL as that same domain",
    (file) => {
      const yaml = readFileSync(join(REPO_ROOT, file), "utf8");
      const match = yaml.match(/SUCHI_SITE_URL=([^,'\s]+)/);

      expect(match).not.toBeNull();
      expect(match![1]).toBe(`https://${landingDomain()}`);
    }
  );

  it("no source file still carries the old misspelled domain", () => {
    const files = [
      "apps/api/src/config/env.validation.ts",
      "apps/api/src/modules/admin/social-post.service.ts",
      "cloudbuild.yaml",
      "cloudbuild.gated.yaml",
    ];

    for (const f of files) {
      const text = readFileSync(join(REPO_ROOT, f), "utf8");
      // The misspelling, not merely a substring of the correct domain.
      expect(text).not.toMatch(/(?<!suchitra)(?<!tra)\bsuchicancercare\.org/);
    }
  });
});
