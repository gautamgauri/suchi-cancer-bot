/**
 * Public URL of a landing-site article, built the same way the site builds
 * its routes. Keep this map in step with CONTENT_TYPE_TO_URL in
 * apps/landing/src/layouts/ArticlePageLayout.astro.
 *
 * Packs used to hard-code `/cancer-type/<slug>/`, a path that has never
 * existed on the site (the hub is `/cancer-types/`), so every social post
 * linked to a 404.
 */
export const SITE_ORIGIN = "https://suchitracancercare.org";

const CONTENT_TYPE_TO_PATH: Record<string, string> = {
  cancer_type: "cancer-types",
  symptom: "symptoms",
  treatment: "tests-treatment/treatments",
  test: "tests-treatment/diagnosis-tests",
  side_effect: "tests-treatment/side-effects",
  journey: "living-with-cancer",
  find_care: "find-care",
  meta: "resources",
  resource: "resources",
  navigation: "resources",
};

export function articleUrl(contentType: string, slug: string): string {
  const segment = CONTENT_TYPE_TO_PATH[contentType] ?? "resources";
  return `${SITE_ORIGIN}/${segment}/${slug}/`;
}
