/**
 * Social Post Service (content-pipeline entry point)
 *
 * When an article is approved in the content pipeline, ContentApproveService
 * calls generateAndQueue(). Article posts are clinical content, so they now
 * go through the social module's clinical lane: a post is prepared only when
 * the article's front matter says it has been reviewed by a clinician, and
 * otherwise the article waits in a list the daily social tick re-checks.
 *
 * Everything else that used to live here moved to apps/api/src/modules/social/:
 * generation with the voice gate, the signed single-use approval page, the
 * idempotent publisher and the record of what was posted. The old one-click
 * GET approve links are retired (see AdminController) and publish nothing.
 */
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import { SocialService } from "../social/social.service";

const GCS_BUCKET  = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";

const CONTENT_TYPE_TO_PATH: Record<string, string> = {
  treatment:   "tests-treatment/treatments",
  test:        "tests-treatment/diagnosis-tests",
  side_effect: "tests-treatment/side-effects",
  cancer_type: "cancer-types",
  symptom:     "symptoms",
  journey:     "living-with-cancer",
  find_care:   "find-care",
  meta:        "resources",
  resource:    "resources",
  navigation:  "resources",
};

export function articlePath(slug: string, contentType: string): string {
  return `/${CONTENT_TYPE_TO_PATH[contentType] ?? "resources"}/${slug}/`;
}

@Injectable()
export class SocialPostService {
  private readonly logger = new Logger(SocialPostService.name);

  constructor(private readonly social: SocialService) {}

  /** Called fire-and-forget after an article is approved. */
  async generateAndQueue(slug: string, _title: string, contentType: string): Promise<{ status: string; reason?: string }> {
    const result = await this.social.queueFromArticle(slug, articlePath(slug, contentType));
    this.logger.log(`Social post for article "${slug}": ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
    return result;
  }

  /** POST /admin/social/generate. Looks the slug up in content-queue.json, then goes through the clinical lane. */
  async generateFromSlug(slug: string): Promise<{ id: string; title: string; status: string; reason?: string }> {
    if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not configured");
    const [buf] = await new Storage({ projectId: GCS_PROJECT })
      .bucket(GCS_BUCKET).file("content-queue.json").download() as [Buffer];
    const queue = JSON.parse(buf.toString("utf-8")) as { articles: { slug: string; title: string; contentType: string }[] };
    const entry = (queue.articles ?? []).find((e) => e.slug === slug);
    if (!entry) throw new NotFoundException(`Slug "${slug}" not found in content-queue`);
    const r = await this.generateAndQueue(entry.slug, entry.title, entry.contentType);
    return { id: slug, title: entry.title, ...r };
  }
}
