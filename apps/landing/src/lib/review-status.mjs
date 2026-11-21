/**
 * Which articles may show a review label and date.
 *
 * `last_reviewed` in the frontmatter is a date the pipeline writes for every
 * article, including AI drafts. On its own it records no clinical sign-off.
 * A review label ("Reviewed", "Last reviewed") may only appear when
 * `review_status` records a completed review.
 *
 * Allowed values are in src/content/config.ts: ai_draft, reviewed, published,
 * flagged. Only `reviewed` records a completed review. `published` means the
 * article is live on the site (docs/REQUIREMENTS.md FR-CONTENT-012), and every
 * article on the site today is live as an `ai_draft`, so `published` does not
 * count. Add a value here only if it records a completed clinical review.
 *
 * scripts/verify-build.mjs imports this list and fails the build when a review
 * label appears beside any article whose status is not on it.
 */
export const REVIEWED_STATUSES = ['reviewed'];

/** Attribute that every rendered review label carries, set to the article's page_id. */
export const REVIEW_LABEL_ATTR = 'data-review-page-id';

/** True when the article's frontmatter records a completed review. */
export function isReviewed(data) {
  return REVIEWED_STATUSES.includes(data?.review_status);
}
