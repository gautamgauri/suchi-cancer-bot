/**
 * Social Distribution Service
 *
 * Called after an article is approved. Uses Gemini to generate platform-specific
 * copy, then emails each variant to Zapier Email Parser inboxes, which post to
 * Facebook, X, Instagram, and LinkedIn automatically.
 *
 * If Zapier addresses are not configured, falls back to a single review email
 * to the admin so they can copy-paste or forward manually.
 *
 * Setup: create one Zapier Email Parser zap per platform, paste the parser
 * email addresses into Secret Manager as SOCIAL_ZAPIER_{FACEBOOK,X,INSTAGRAM,LINKEDIN}.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import matter from "gray-matter";
import { LlmService } from "../llm/llm.service";
import { EmailService } from "../email/email.service";

const GCS_BUCKET  = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const SITE_URL    = process.env.SUCHI_SITE_URL ?? "https://suchicancercare.org";

const CONTENT_TYPE_TO_PATH: Record<string, string> = {
  treatment:    "tests-treatment/treatments",
  test:         "tests-treatment/diagnosis-tests",
  side_effect:  "tests-treatment/side-effects",
  cancer_type:  "cancer-types",
  symptom:      "symptoms",
  journey:      "living-with-cancer",
  find_care:    "find-care",
  meta:         "resources",
  resource:     "resources",
  navigation:   "resources",
};

interface SocialCopy {
  facebook: string;
  x: string;
  instagram: string;
  linkedin: string;
}

interface PlatformResult {
  success: boolean;
  method: "zapier" | "review_email" | "skipped";
  error?: string;
}

export interface SocialDistributionResult {
  facebook:  PlatformResult;
  x:         PlatformResult;
  instagram: PlatformResult;
  linkedin:  PlatformResult;
}

@Injectable()
export class SocialDistributionService {
  private readonly logger = new Logger(SocialDistributionService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly email: EmailService,
  ) {}

  async distributeArticle(
    slug: string,
    title: string,
    contentType: string,
  ): Promise<SocialDistributionResult> {
    const articleUrl = `${SITE_URL}/${CONTENT_TYPE_TO_PATH[contentType] ?? "resources"}/${slug}`;

    // Load summary from draft in GCS
    const summary = await this.loadSummary(slug);

    // Generate copy variants
    let copy: SocialCopy;
    try {
      copy = await this.generateCopy(title, summary, articleUrl);
    } catch (err) {
      this.logger.error("Failed to generate social copy", err);
      const fail: PlatformResult = { success: false, method: "skipped", error: String(err) };
      return { facebook: fail, x: fail, instagram: fail, linkedin: fail };
    }

    // Zapier addresses (optional — if not set, fall back to review email)
    const zapierAddrs = {
      facebook:  process.env.SOCIAL_ZAPIER_FACEBOOK,
      x:         process.env.SOCIAL_ZAPIER_X,
      instagram: process.env.SOCIAL_ZAPIER_INSTAGRAM,
      linkedin:  process.env.SOCIAL_ZAPIER_LINKEDIN,
    };

    const anyZapierConfigured = Object.values(zapierAddrs).some(Boolean);

    if (anyZapierConfigured) {
      return this.sendToZapier(title, copy, zapierAddrs);
    }

    // Fall back: single review email to admin
    return this.sendReviewEmail(title, articleUrl, copy);
  }

  // ---------------------------------------------------------------------------
  // Gemini copy generation
  // ---------------------------------------------------------------------------

  private async generateCopy(title: string, summary: string, url: string): Promise<SocialCopy> {
    const prompt = `Generate social media copy for a new cancer information article by Suchi, an Indian cancer information service.

Article title: "${title}"
Summary: "${summary}"
URL: ${url}

Return ONLY a valid JSON object — no markdown fences, no explanation:
{
  "facebook": "2-3 warm sentences for cancer patients and caregivers in India. End with the URL. Max 400 chars.",
  "x": "1 concise sentence under 220 chars. Then the URL on the next line. Total must fit in 280 chars.",
  "instagram": "2-3 sentences + 6-8 hashtags. End with the URL. Must include #CancerCare #CancerInIndia. Max 500 chars.",
  "linkedin": "2-3 professional sentences about why this information matters for patients and health workers in India. End with the URL. Max 500 chars."
}

Tone: Compassionate, factual, empowering. No fear-mongering. Pan-India audience.`;

    const raw = await this.llm.generate(
      "You are a social media writer for an Indian cancer information NGO. Output only the requested JSON.",
      "",
      prompt,
    );
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    return JSON.parse(cleaned) as SocialCopy;
  }

  // ---------------------------------------------------------------------------
  // Zapier path: one email per platform → auto-post
  // ---------------------------------------------------------------------------

  private async sendToZapier(
    title: string,
    copy: SocialCopy,
    addrs: Record<string, string | undefined>,
  ): Promise<SocialDistributionResult> {
    const platforms = [
      { key: "facebook" as const,  addr: addrs.facebook,  copy: copy.facebook  },
      { key: "x" as const,         addr: addrs.x,         copy: copy.x         },
      { key: "instagram" as const, addr: addrs.instagram, copy: copy.instagram },
      { key: "linkedin" as const,  addr: addrs.linkedin,  copy: copy.linkedin  },
    ];

    const results: SocialDistributionResult = {
      facebook:  { success: false, method: "skipped" },
      x:         { success: false, method: "skipped" },
      instagram: { success: false, method: "skipped" },
      linkedin:  { success: false, method: "skipped" },
    };

    await Promise.all(platforms.map(async (p) => {
      if (!p.addr) {
        results[p.key] = { success: false, method: "skipped" };
        return;
      }
      const ok = await this.email.sendEmail({
        to: p.addr,
        subject: `[SUCHI] ${title}`,
        text: p.copy,
      });
      results[p.key] = { success: ok, method: "zapier", error: ok ? undefined : "email send failed" };
      this.logger.log(`Zapier email (${p.key}): ${ok ? "sent" : "failed"}`);
    }));

    return results;
  }

  // ---------------------------------------------------------------------------
  // Fallback path: review email to admin
  // ---------------------------------------------------------------------------

  private async sendReviewEmail(
    title: string,
    url: string,
    copy: SocialCopy,
  ): Promise<SocialDistributionResult> {
    const reviewer = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:680px;margin:auto;padding:20px">
<h2>Social Posts Ready — ${escHtml(title)}</h2>
<p style="color:#555">Article approved and published. Copy the post text below and share on your platforms, or
configure <code>SOCIAL_ZAPIER_*</code> env vars to automate this step.</p>
<p><strong>Article URL:</strong> <a href="${escHtml(url)}">${escHtml(url)}</a></p>

${buildPlatformBlock("Facebook", copy.facebook)}
${buildPlatformBlock("X / Twitter", copy.x)}
${buildPlatformBlock("Instagram", copy.instagram)}
${buildPlatformBlock("LinkedIn", copy.linkedin)}

<hr style="margin-top:32px">
<p style="color:#999;font-size:12px">Suchi Content Pipeline · To automate posting, set SOCIAL_ZAPIER_FACEBOOK / _X / _INSTAGRAM / _LINKEDIN in Secret Manager to your Zapier Email Parser addresses.</p>
</body></html>`;

    const ok = await this.email.sendEmail({
      to: reviewer,
      subject: `Social Posts Ready: "${title}"`,
      html,
    });

    const result: PlatformResult = { success: ok, method: "review_email" };
    this.logger.log(`Social review email sent to ${reviewer}: ${ok}`);
    return { facebook: result, x: result, instagram: result, linkedin: result };
  }

  // ---------------------------------------------------------------------------
  // GCS helpers
  // ---------------------------------------------------------------------------

  private async loadSummary(slug: string): Promise<string> {
    if (!GCS_BUCKET) return "";
    try {
      const storage = new Storage({ projectId: GCS_PROJECT });
      const [buf] = await storage.bucket(GCS_BUCKET).file(`content-drafts/${slug}.md`).download() as [Buffer];
      const { data } = matter(buf.toString("utf-8"));
      return (data.summary as string | undefined) ?? "";
    } catch {
      this.logger.warn(`Could not load summary for ${slug} from GCS`);
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildPlatformBlock(label: string, text: string): string {
  return `<h3 style="margin-top:24px">${label}</h3>
<div style="background:#f9f9f9;padding:14px 16px;border-left:4px solid #1a73e8;font-size:14px;white-space:pre-wrap;font-family:monospace">${escHtml(text)}</div>`;
}
