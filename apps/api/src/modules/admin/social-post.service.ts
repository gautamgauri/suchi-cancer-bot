/**
 * Social Post Service
 *
 * Part of the unified Suchi publishing pipeline. After a webpage article is
 * approved, this service generates platform-specific social copy with Gemini,
 * runs a lightweight safety gate, then emails the reviewer for approval —
 * same single-click-in-email pattern used by article and hospital approvals.
 *
 * On approval, publishes directly to Facebook, Instagram, and LinkedIn via
 * their native APIs. Platforms not configured (missing env vars) are skipped.
 *
 * Approval email URL: GET /v1/admin/social/approve/:id?token=xxx
 * Platform-selective:  GET /v1/admin/social/approve/:id?token=xxx&platforms=facebook
 * Rejection URL:       GET /v1/admin/social/reject/:id?token=xxx
 *
 * GCS queue: social-queue.json (same bucket as content-queue.json)
 */

import { Injectable, Logger, NotFoundException, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import matter from "gray-matter";
import { LlmService } from "../llm/llm.service";
import { EmailService } from "../email/email.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Hard-block safety patterns (FR-SOCIAL-013)
// Posts matching any of these cannot be approved.
// ---------------------------------------------------------------------------

const HARD_BLOCK_PATTERNS: RegExp[] = [
  /diagno|you (may|might|could) have|indicates cancer/i,
  /cure|guaranteed?|will (definitely|certainly) (work|help|treat)/i,
  /stop (your|the|chemo|treatment|radiation)|don'?t take|instead of (chemo|radiation|surgery)/i,
  /\d+%\s*(survival|die|death|fatal)/i,
  /₹\s*\d|rs\.?\s*\d{3,}|inr\s*\d/i,
];

const GCS_BUCKET   = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT  = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const SITE_URL     = process.env.SUCHI_SITE_URL ?? "https://suchicancercare.org";
const API_BASE     = "https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/social";

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "facebook" | "instagram" | "linkedin";
const ALL_PLATFORMS: Platform[] = ["facebook", "instagram", "linkedin"];

interface SocialCopy {
  facebook:  string;
  instagram: string;
  linkedin:  string;
}

interface PlatformResult {
  success: boolean;
  postId?: string;
  error?: string;
}

interface SocialPostDraft {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  articleUrl: string;
  copy: SocialCopy;
  status: "sent_for_approval" | "approved" | "rejected" | "published" | "failed";
  approvalToken: string;
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  publishedAt?: string;
  approvedPlatforms?: Platform[];
  publishResults?: Record<Platform, PlatformResult>;
  safetyWarnings?: string[];
  safetyBlocked?: boolean;
}

interface SocialQueue { posts: SocialPostDraft[] }

export interface ApproveResult {
  title: string;
  published: Platform[];
  failed: Platform[];
  approvedBy?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SocialPostService {
  private readonly logger = new Logger(SocialPostService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly email: EmailService,
  ) {}

  /**
   * Called fire-and-forget after article approval.
   * Generates copy → safety gate → saves draft → sends approval email.
   */
  async generateAndQueue(slug: string, title: string, contentType: string): Promise<void> {
    const articleUrl = `${SITE_URL}/${CONTENT_TYPE_TO_PATH[contentType] ?? "resources"}/${slug}`;
    const summary = await this.loadSummary(slug);

    let copy: SocialCopy;
    try {
      copy = await this.generateCopy(title, summary, articleUrl);
    } catch (err) {
      this.logger.error(`Social copy generation failed for ${slug}`, err);
      return;
    }

    const warnings = await this.runSafetyGate(Object.values(copy).join(" "));
    const safetyBlocked = HARD_BLOCK_PATTERNS.some(re => warnings.some(w => re.test(w)));
    const id = randomUUID();

    const draft: SocialPostDraft = {
      id,
      slug,
      title,
      contentType,
      articleUrl,
      copy,
      status: "sent_for_approval",
      approvalToken: this.buildToken(id),
      createdAt: new Date().toISOString(),
      safetyWarnings: warnings,
      safetyBlocked,
    };

    const queue = await this.loadQueue();
    queue.posts.push(draft);
    await this.saveQueue(queue);

    await this.sendApprovalEmail(draft);
    this.logger.log(`Social post draft queued for "${slug}" id=${id} warnings=${warnings.length}`);
  }

  /**
   * Called by GET /admin/social/approve/:id?token=xxx[&platforms=facebook][&approver=Name]
   * Publishes to the requested platforms (defaults to all).
   */
  async approvePost(id: string, token: string, platformsParam?: string, approver?: string): Promise<ApproveResult> {
    this.verifyToken(id, token);
    const queue = await this.loadQueue();
    const draft = queue.posts.find((p) => p.id === id);
    if (!draft) throw new NotFoundException(`Social post ${id} not found`);

    if (draft.status === "published" || draft.status === "rejected") {
      this.logger.warn(`Social post ${id} already ${draft.status} (by ${draft.approvedBy ?? draft.rejectedBy ?? "unknown"}) — ignoring duplicate click from ${approver ?? "unknown"}`);
      return { title: draft.title, published: draft.approvedPlatforms ?? [], failed: [], approvedBy: draft.approvedBy };
    }

    if (draft.safetyBlocked) {
      throw new ForbiddenException(
        `Post "${draft.title}" contains hard-block safety violations and cannot be approved. Review the safety warnings and regenerate.`,
      );
    }

    const targets = this.resolvePlatforms(platformsParam);

    const results: Record<Platform, PlatformResult> = {
      facebook:  { success: false, error: "not_requested" },
      instagram: { success: false, error: "not_requested" },
      linkedin:  { success: false, error: "not_requested" },
    };

    await Promise.all(targets.map(async (p) => {
      if (p === "facebook")  results.facebook  = await this.postFacebook(draft.copy.facebook);
      if (p === "instagram") results.instagram = await this.postInstagram(draft.copy.instagram);
      if (p === "linkedin")  results.linkedin  = await this.postLinkedIn(draft.copy.linkedin, draft.articleUrl);
    }));

    const published = targets.filter((p) => results[p].success);
    const failed    = targets.filter((p) => !results[p].success);

    draft.status = "published";
    draft.approvedAt        = new Date().toISOString();
    draft.approvedBy        = approver ?? "unknown";
    draft.publishedAt       = new Date().toISOString();
    draft.approvedPlatforms = targets;
    draft.publishResults    = results;
    await this.saveQueue(queue);

    this.logger.log(`Social post ${id} ("${draft.title}") approved by ${draft.approvedBy}`);

    // Confirmation email (fire-and-forget)
    this.sendConfirmationEmail(draft.title, draft.articleUrl, results, published, failed, draft.approvedBy).catch(() => undefined);

    return { title: draft.title, published, failed, approvedBy: draft.approvedBy };
  }

  /** Called by GET /admin/social/reject/:id?token=xxx[&approver=Name] */
  async rejectPost(id: string, token: string, approver?: string): Promise<{ title: string }> {
    this.verifyToken(id, token);
    const queue = await this.loadQueue();
    const draft = queue.posts.find((p) => p.id === id);
    if (!draft) throw new NotFoundException(`Social post ${id} not found`);

    if (draft.status === "published" || draft.status === "rejected") {
      this.logger.warn(`Social post ${id} already ${draft.status} — ignoring duplicate reject from ${approver ?? "unknown"}`);
      return { title: draft.title };
    }

    draft.status = "rejected";
    draft.rejectedAt = new Date().toISOString();
    draft.rejectedBy = approver ?? "unknown";
    await this.saveQueue(queue);
    this.logger.log(`Social post ${id} ("${draft.title}") rejected by ${draft.rejectedBy}`);
    return { title: draft.title };
  }

  // ---------------------------------------------------------------------------
  // Copy generation
  // ---------------------------------------------------------------------------

  private async generateCopy(title: string, summary: string, url: string): Promise<SocialCopy> {
    const prompt = `Generate social media copy for a new cancer information article published by Suchi, an Indian cancer information NGO.

Article title: "${title}"
Summary: "${summary}"
URL: ${url}

Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "facebook": "2-3 warm sentences for cancer patients and caregivers in India. Compassionate, not clinical. End with the URL. 280-380 chars.",
  "instagram": "2-3 sentences. Then 6-8 relevant hashtags on a new line. End with the URL. Must include #CancerCare #CancerInIndia. Under 480 chars.",
  "linkedin": "2-3 professional sentences explaining why this information matters for patients, families, and health workers across India. End with the URL. 300-420 chars."
}

Tone: Compassionate, empowering, factual. Pan-India audience. Never state survival rates or definitive medical outcomes.`;

    const raw = await this.llm.generateRaw(
      "You are a social media writer for an Indian cancer NGO. Output only the requested JSON.",
      prompt,
    );
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    return JSON.parse(cleaned) as SocialCopy;
  }

  // ---------------------------------------------------------------------------
  // Safety gate (runs before approval email, non-blocking if it errors)
  // ---------------------------------------------------------------------------

  private async runSafetyGate(combinedCopy: string): Promise<string[]> {
    try {
      const resp = await this.llm.generateRaw(
        "You are a medical content safety reviewer for a public health NGO.",
        `Review this social media copy for potentially harmful medical content.

Flag if it: states definitive survival rates, claims a treatment will cure cancer, advises starting/stopping treatment, makes diagnostic statements, or quotes specific rupee costs.

Copy: "${combinedCopy}"

Respond with exactly one of:
SAFE
REVIEW: {one-sentence description of the specific concern}`,
      );
      const trimmed = resp.trim();
      if (trimmed.startsWith("REVIEW:")) return [trimmed.slice(7).trim()];
    } catch {
      // Non-blocking — a safety check failure doesn't prevent approval
    }
    return [];
  }

  // ---------------------------------------------------------------------------
  // Social API calls
  // ---------------------------------------------------------------------------

  private async postFacebook(text: string): Promise<PlatformResult> {
    const pageId = process.env.META_PAGE_ID;
    const token  = process.env.META_PAGE_ACCESS_TOKEN;
    if (!pageId || !token) return { success: false, error: "not_configured" };

    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, access_token: token }),
    });
    const data = await res.json() as { id?: string; error?: { message: string } };
    if (!res.ok || data.error) {
      const err = data.error?.message ?? `HTTP ${res.status}`;
      this.logger.error(`Facebook post failed: ${err}`);
      return { success: false, error: err };
    }
    this.logger.log(`Facebook posted: ${data.id}`);
    return { success: true, postId: data.id };
  }

  private async postInstagram(caption: string): Promise<PlatformResult> {
    const igUserId = process.env.META_IG_USER_ID;
    const token    = process.env.META_PAGE_ACCESS_TOKEN;
    const cardUrl  = process.env.SUCHI_SOCIAL_CARD_URL;
    if (!igUserId || !token || !cardUrl) return { success: false, error: "not_configured" };

    // Step 1: create media container
    const createRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: cardUrl, caption, access_token: token }),
    });
    const createData = await createRes.json() as { id?: string; error?: { message: string } };
    if (!createRes.ok || createData.error || !createData.id) {
      const err = createData.error?.message ?? `HTTP ${createRes.status}`;
      this.logger.error(`Instagram container creation failed: ${err}`);
      return { success: false, error: err };
    }

    // Step 2: publish
    const publishRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: token }),
    });
    const publishData = await publishRes.json() as { id?: string; error?: { message: string } };
    if (!publishRes.ok || publishData.error) {
      const err = publishData.error?.message ?? `HTTP ${publishRes.status}`;
      this.logger.error(`Instagram publish failed: ${err}`);
      return { success: false, error: err };
    }
    this.logger.log(`Instagram posted: ${publishData.id}`);
    return { success: true, postId: publishData.id };
  }

  /**
   * LinkedIn UGC Posts API.
   * Requires:
   *   LINKEDIN_ACCESS_TOKEN — OAuth 2.0 bearer token (60-day expiry; rotate monthly)
   *   LINKEDIN_AUTHOR_URN   — "urn:li:organization:12345" for a company page
   *                            or "urn:li:person:xxxxx" for a personal profile
   */
  private async postLinkedIn(text: string, articleUrl: string): Promise<PlatformResult> {
    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
    const authorUrn   = process.env.LINKEDIN_AUTHOR_URN;
    if (!accessToken || !authorUrn) return { success: false, error: "not_configured" };

    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "ARTICLE",
          media: [{ status: "READY", originalUrl: articleUrl }],
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`LinkedIn post failed ${res.status}: ${errText.slice(0, 200)}`);
      return { success: false, error: `HTTP ${res.status}` };
    }
    const postId = res.headers.get("x-restli-id") ?? undefined;
    this.logger.log(`LinkedIn posted: ${postId}`);
    return { success: true, postId };
  }

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------

  private async sendApprovalEmail(draft: SocialPostDraft): Promise<void> {
    const { id, title, copy, approvalToken, safetyWarnings = [], articleUrl } = draft;

    const recipients = [
      { name: "Gautam", email: process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org" },
      { name: "Divya",  email: "divya.vats@dikshafoundation.org" },
      { name: "Nisha",  email: "nisha.kumari@dikshafoundation.org" },
    ];

    // Determine which platforms are configured (FR-SOCIAL-006)
    const fbConfigured = !!(process.env.META_PAGE_ID && process.env.META_PAGE_ACCESS_TOKEN);
    const igConfigured = !!process.env.META_IG_USER_ID;
    const liConfigured = !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_AUTHOR_URN);

    // Safety banner — red hard-block if safetyBlocked, yellow advisory otherwise
    let safetyBanner: string;
    if (draft.safetyBlocked) {
      safetyBanner = `<div style="background:#fee2e2;border:1px solid #dc2626;padding:10px;margin:10px 0;border-radius:4px;">
  <strong style="color:#dc2626;">&#9940; HARD BLOCK — This post cannot be approved.</strong><br>
  Safety review flagged hard-block violations: ${escHtml(safetyWarnings.join("; ") ?? "unknown")}
</div>`;
    } else if (safetyWarnings.length > 0) {
      safetyBanner = `<div style="background:#fff3cd;border-left:4px solid #e37400;padding:12px 16px;margin-bottom:20px;font-size:13px;">
           <strong>Safety review flagged:</strong> ${escHtml(safetyWarnings.join("; "))}
           <br>Review the copy carefully before approving.
         </div>`;
    } else {
      safetyBanner = "";
    }

    await Promise.all(recipients.map(({ name, email }) => {
      const a = encodeURIComponent(name);
      const approveAll = `${API_BASE}/approve/${id}?token=${approvalToken}&approver=${a}`;
      const approveFB  = `${API_BASE}/approve/${id}?token=${approvalToken}&platforms=facebook&approver=${a}`;
      const approveIG  = `${API_BASE}/approve/${id}?token=${approvalToken}&platforms=instagram&approver=${a}`;
      const approveLI  = `${API_BASE}/approve/${id}?token=${approvalToken}&platforms=linkedin&approver=${a}`;
      const rejectUrl  = `${API_BASE}/reject/${id}?token=${approvalToken}&approver=${a}`;
      const cc = recipients.filter((r) => r.email !== email).map((r) => r.email).join(", ");

      // Count configured platforms for "Approve all" button label
      const configuredCount = [fbConfigured, igConfigured, liConfigured].filter(Boolean).length;

      // Platform-specific approve buttons — omit entirely for unconfigured platforms (FR-SOCIAL-006)
      const fbBtn = fbConfigured ? `<a href="${approveFB}"  style="${btnStyle("#1877f2")}">Facebook only</a>` : "";
      const igBtn = igConfigured ? `<a href="${approveIG}"  style="${btnStyle("#c13584")}">Instagram only</a>` : "";
      const liBtn = liConfigured ? `<a href="${approveLI}"  style="${btnStyle("#0077b5")}">LinkedIn only</a>` : "";

      // Approve buttons section — omit entirely when hard-blocked
      const approveSection = draft.safetyBlocked
        ? ""
        : `<div style="margin-top:28px;line-height:2.2">
  ${configuredCount > 1 ? `<a href="${approveAll}" style="${btnStyle("#188038")}">Approve all (${configuredCount} platforms)</a>` : ""}
  ${fbBtn}
  ${igBtn}
  ${liBtn}
</div>`;

      // Copy preview blocks — only show configured platforms (FR-SOCIAL-006)
      const fbBlock = fbConfigured ? buildPostBlock("Facebook", copy.facebook) : "";
      const igBlock = igConfigured ? buildPostBlock("Instagram", copy.instagram, "Image: branded card configured via SUCHI_SOCIAL_CARD_URL") : "";
      const liBlock = liConfigured ? buildPostBlock("LinkedIn", copy.linkedin) : "";

      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:680px;margin:auto;padding:20px">
<h2 style="margin-bottom:4px">APPROVAL REQUIRED: Social post</h2>
<p style="color:#555;margin-top:4px">${escHtml(title)} — <a href="${escHtml(articleUrl)}">${escHtml(articleUrl)}</a></p>
${safetyBanner}

${fbBlock}
${igBlock}
${liBlock}

${approveSection}
<div style="margin-top:10px">
  <a href="${rejectUrl}" style="${btnStyle("#d93025")}">Reject — do not post</a>
</div>

<p style="color:#999;font-size:11px;margin-top:32px">
  Suchi Content Pipeline &middot; Social posts publish immediately on click.
  Only platforms with credentials configured are shown above.
</p>
</body></html>`;

      return this.email.sendEmail({
        to: email,
        cc,
        subject: `APPROVAL REQUIRED: Social post — "${title}"`,
        html,
      });
    }));
  }

  private async sendConfirmationEmail(
    title: string,
    articleUrl: string,
    results: Record<Platform, PlatformResult>,
    published: Platform[],
    failed: Platform[],
    approvedBy?: string,
  ): Promise<void> {
    const to = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";
    const cc = "divya.vats@dikshafoundation.org, nisha.kumari@dikshafoundation.org";
    const lines = ALL_PLATFORMS.map((p) => {
      const r = results[p];
      if (r.error === "not_requested") return `${p}: skipped`;
      return r.success ? `${p}: published (${r.postId ?? "ok"})` : `${p}: FAILED — ${r.error}`;
    });
    const approverLine = approvedBy ? `Approved by: ${approvedBy}\n` : "";
    await this.email.sendEmail({
      to,
      cc,
      subject: failed.length === 0
        ? `Social posts published: "${title}"`
        : `Social posts partially published: "${title}"`,
      text: `Article: ${articleUrl}\n\n${approverLine}Published: ${published.join(", ") || "none"}\nFailed: ${failed.join(", ") || "none"}\n\n${lines.join("\n")}`,
    });
  }

  /**
   * Manual trigger: looks up slug in content-queue.json, then calls generateAndQueue.
   * Used by POST /admin/social/generate for testing and manual re-generation.
   */
  async generateFromSlug(slug: string): Promise<{ id: string; title: string }> {
    if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not configured");
    const [buf] = await new Storage({ projectId: GCS_PROJECT })
      .bucket(GCS_BUCKET).file("content-queue.json").download() as [Buffer];
    const queue = JSON.parse(buf.toString("utf-8")) as { articles: { slug: string; title: string; contentType: string }[] };
    const entry = (queue.articles ?? []).find((e) => e.slug === slug);
    if (!entry) throw new NotFoundException(`Slug "${slug}" not found in content-queue`);
    await this.generateAndQueue(entry.slug, entry.title, entry.contentType);
    return { id: slug, title: entry.title };
  }

  // ---------------------------------------------------------------------------
  // GCS helpers
  // ---------------------------------------------------------------------------

  private async loadQueue(): Promise<SocialQueue> {
    if (!GCS_BUCKET) return { posts: [] };
    try {
      const [buf] = await new Storage({ projectId: GCS_PROJECT })
        .bucket(GCS_BUCKET).file("social-queue.json").download() as [Buffer];
      return JSON.parse(buf.toString("utf-8")) as SocialQueue;
    } catch {
      return { posts: [] };
    }
  }

  private async saveQueue(queue: SocialQueue): Promise<void> {
    if (!GCS_BUCKET) return;
    await new Storage({ projectId: GCS_PROJECT })
      .bucket(GCS_BUCKET).file("social-queue.json")
      .save(JSON.stringify(queue, null, 2) + "\n", { contentType: "application/json" });
  }

  private async loadSummary(slug: string): Promise<string> {
    if (!GCS_BUCKET) return "";
    try {
      const [buf] = await new Storage({ projectId: GCS_PROJECT })
        .bucket(GCS_BUCKET).file(`content-drafts/${slug}.md`).download() as [Buffer];
      const { data } = matter(buf.toString("utf-8"));
      return (data.summary as string | undefined) ?? "";
    } catch {
      return "";
    }
  }

  // ---------------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------------

  private buildToken(id: string): string {
    const secret = process.env.SOCIAL_APPROVAL_SECRET
      ?? process.env.CONTENT_APPROVAL_SECRET
      ?? "suchi-social-dev-secret";
    return createHmac("sha256", secret).update(id).digest("hex");
  }

  private verifyToken(id: string, token: string): void {
    const expected = this.buildToken(id);
    const a = Buffer.from(token.padEnd(64, "0").slice(0, 64), "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Invalid approval token");
    }
  }

  private resolvePlatforms(param?: string): Platform[] {
    if (!param) return [...ALL_PLATFORMS];
    return param.split(",")
      .map((s) => s.trim().toLowerCase() as Platform)
      .filter((p) => ALL_PLATFORMS.includes(p));
  }
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function btnStyle(bg: string): string {
  return `background:${bg};color:#fff;padding:10px 18px;border-radius:4px;text-decoration:none;margin-right:8px;font-size:14px`;
}

function buildPostBlock(label: string, text: string, note?: string): string {
  const noteHtml = note ? `<p style="font-size:11px;color:#888;margin:4px 0 0">${escHtml(note)}</p>` : "";
  return `<h3 style="margin-top:28px;margin-bottom:6px">${label}</h3>
<div style="background:#f9f9f9;padding:14px 16px;border-left:4px solid #1a73e8;font-size:13px;white-space:pre-wrap;font-family:monospace">${escHtml(text)}</div>${noteHtml}`;
}
