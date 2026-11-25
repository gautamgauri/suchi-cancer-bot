/**
 * The clinical lane: symptoms, treatment, side effects, screening.
 *
 * AGENTS.md section 1, rule 3 puts new clinical content behind SCCF's
 * clinicians. Every site article is `review_status: ai_draft` today, so this
 * lane produces nothing. It switches on per article when that article's
 * front matter says `reviewed`. Nothing else switches it on. `published` only
 * means the article is live on the site (FR-CONTENT-012), and every live
 * article is an `ai_draft`, so it does not count.
 * The publisher checks the same rule again before any request is sent.
 */
import matter from "gray-matter";
import { ContentBrief, SourceFact } from "../social.types";
import { SITE_URL } from "../links";

/**
 * Statuses that mean a clinician has reviewed the article. Mirrors
 * REVIEWED_STATUSES in apps/landing/src/lib/review-status.mjs, which decides
 * whether the site may show a review label. clinical-lane.spec.ts fails if
 * the two lists differ.
 */
export const REVIEWED_STATUSES: ReadonlySet<string> = new Set(["reviewed"]);

export interface ClinicalCheck {
  allowed: boolean;
  brief?: ContentBrief;
  reason?: string;
  reviewStatus?: string;
}

export function isReviewed(status: unknown): boolean {
  return typeof status === "string" && REVIEWED_STATUSES.has(status.trim().toLowerCase());
}

/**
 * Build a clinical brief from an article's markdown, or refuse.
 * The facts are the article's own sentences, linked to its page.
 */
export function clinicalBriefFromArticle(slug: string, markdown: string, articlePath: string, fetchedOn = new Date().toISOString().slice(0, 10)): ClinicalCheck {
  let data: Record<string, unknown>;
  let content: string;
  try {
    const parsed = matter(markdown);
    data = parsed.data as Record<string, unknown>;
    content = parsed.content;
  } catch (err) {
    return { allowed: false, reason: `front matter could not be read: ${(err as Error).message}` };
  }
  const status = typeof data.review_status === "string" ? data.review_status : undefined;
  if (!isReviewed(status)) {
    return { allowed: false, reason: `article "${slug}" is ${status ?? "missing a review_status"}. Clinical posts wait until a clinician has reviewed it.`, reviewStatus: status };
  }
  const url = `${SITE_URL}${articlePath}`;
  const sentences = content
    .replace(/^#+.*$/gm, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 30 && s.length < 300)
    .slice(0, 40);
  const facts: SourceFact[] = sentences.map((text) => ({ text, url, fetchedOn }));
  if (facts.length === 0) return { allowed: false, reason: `article "${slug}" has no usable text` };
  return {
    allowed: true,
    brief: {
      topicId: `article-${slug}`,
      lane: "clinical",
      title: typeof data.title === "string" ? data.title : slug,
      angle: "Point people to this reviewed article. Use only the article's own sentences. Add no advice.",
      facts,
      sitePath: articlePath,
      nextStep: "site",
      article: { slug, reviewStatus: status! },
    },
  };
}

/** The final check before anything clinical is offered or sent. */
export function assertLaneAllowed(brief: Pick<ContentBrief, "lane" | "article">): void {
  if (brief.lane !== "clinical") return;
  if (!brief.article || !isReviewed(brief.article.reviewStatus)) {
    throw new Error("Clinical lane is blocked: the source article is not marked reviewed");
  }
}
