/**
 * DraftExpiryService — FR-AUDIT-007
 *
 * Checks content and social queues for stale drafts:
 *   Article  sent_for_review > 48h  → reminder email (once)
 *   Article  sent_for_review > 30d  → archive
 *   Social   sent_for_approval > 3d → reminder email (once)
 *   Social   sent_for_approval > 7d → expire (status → rejected, reason = expired)
 *
 * Called by POST /v1/admin/housekeeping/run-expiry (SchedulerOidcGuard).
 */

import { Injectable, Logger } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import { EmailService } from "../email/email.service";

const GCS_BUCKET   = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT  = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
const CONTENT_OBJ  = "content-queue.json";
const SOCIAL_OBJ   = "social-queue.json";

const ARTICLE_REMINDER_H  = 48;   // send reminder after 48 hours
const ARTICLE_EXPIRE_D    = 30;   // archive after 30 days
const SOCIAL_REMINDER_D   = 3;    // send reminder after 3 days
const SOCIAL_EXPIRE_D     = 7;    // expire after 7 days

// ---------------------------------------------------------------------------
// Inline types (avoid cross-module imports for queue shapes)
// ---------------------------------------------------------------------------

interface ArticleEntry {
  slug: string;
  title: string;
  status: string;
  emailSentAt?: string;
  approvalToken?: string;
  reminderSentAt?: string;
  archivedAt?: string;
  archivedReason?: string;
}

interface ContentQueue { articles: ArticleEntry[] }

interface SocialPostDraft {
  id: string;
  title: string;
  slug?: string;
  status: string;
  createdAt: string;
  reminderSentAt?: string;
  expiredAt?: string;
}

interface SocialQueue { posts: SocialPostDraft[] }

// ---------------------------------------------------------------------------
// GCS helpers
// ---------------------------------------------------------------------------

function storage() {
  return new Storage({ projectId: GCS_PROJECT });
}

async function gcsRead(obj: string): Promise<string> {
  const [buf] = await storage().bucket(GCS_BUCKET!).file(obj).download() as [Buffer];
  return buf.toString("utf-8");
}

async function gcsWrite(obj: string, content: string): Promise<void> {
  await storage().bucket(GCS_BUCKET!).file(obj).save(
    content,
    { contentType: "application/json" },
  );
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ExpiryRunResult {
  articles: {
    reminded: string[];
    archived: string[];
    skipped: number;
  };
  social: {
    reminded: string[];
    expired: string[];
    skipped: number;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DraftExpiryService {
  private readonly logger = new Logger(DraftExpiryService.name);

  constructor(private readonly email: EmailService) {}

  async runExpiry(now = new Date()): Promise<ExpiryRunResult> {
    if (!GCS_BUCKET) {
      this.logger.warn("QUEUE_GCS_BUCKET not set — draft expiry skipped (local mode)");
      return { articles: { reminded: [], archived: [], skipped: 0 }, social: { reminded: [], expired: [], skipped: 0 } };
    }

    const [articleResult, socialResult] = await Promise.all([
      this.processContentQueue(now),
      this.processSocialQueue(now),
    ]);

    return { articles: articleResult, social: socialResult };
  }

  // ---------------------------------------------------------------------------
  // Content queue
  // ---------------------------------------------------------------------------

  private async processContentQueue(now: Date) {
    const reminded: string[] = [];
    const archived: string[] = [];
    let skipped = 0;

    let raw: string;
    try {
      raw = await gcsRead(CONTENT_OBJ);
    } catch (err: any) {
      this.logger.warn(`Could not read content queue: ${err.message}`);
      return { reminded, archived, skipped };
    }

    const queue = JSON.parse(raw) as ContentQueue;
    let dirty = false;

    for (const article of queue.articles) {
      if (article.status !== "sent_for_review") { skipped++; continue; }

      const sentAt = new Date(article.emailSentAt ?? article.reminderSentAt ?? "");
      if (isNaN(sentAt.getTime())) { skipped++; continue; }

      const ageHours = (now.getTime() - sentAt.getTime()) / (1000 * 60 * 60);

      if (ageHours >= ARTICLE_EXPIRE_D * 24) {
        article.status = "archived";
        article.archivedAt = now.toISOString();
        article.archivedReason = `No response after ${ARTICLE_EXPIRE_D} days`;
        archived.push(article.slug);
        dirty = true;
        await this.sendArticleExpiredEmail(article);
        this.logger.log(`Article "${article.slug}" archived — no response after ${ARTICLE_EXPIRE_D} days`);

      } else if (ageHours >= ARTICLE_REMINDER_H && !article.reminderSentAt) {
        article.reminderSentAt = now.toISOString();
        reminded.push(article.slug);
        dirty = true;
        await this.sendArticleReminderEmail(article);
        this.logger.log(`Article "${article.slug}" reminder sent — ${Math.round(ageHours)}h since review email`);

      } else {
        skipped++;
      }
    }

    if (dirty) {
      await gcsWrite(CONTENT_OBJ, JSON.stringify(queue, null, 2) + "\n");
    }

    return { reminded, archived, skipped };
  }

  // ---------------------------------------------------------------------------
  // Social queue
  // ---------------------------------------------------------------------------

  private async processSocialQueue(now: Date) {
    const reminded: string[] = [];
    const expired: string[] = [];
    let skipped = 0;

    let raw: string;
    try {
      raw = await gcsRead(SOCIAL_OBJ);
    } catch (err: any) {
      this.logger.warn(`Could not read social queue: ${err.message}`);
      return { reminded, expired, skipped };
    }

    const queue = JSON.parse(raw) as SocialQueue;
    let dirty = false;

    for (const post of queue.posts) {
      if (post.status !== "sent_for_approval") { skipped++; continue; }

      const createdAt = new Date(post.createdAt);
      if (isNaN(createdAt.getTime())) { skipped++; continue; }

      const ageDays = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

      if (ageDays >= SOCIAL_EXPIRE_D) {
        post.status = "rejected";
        post.expiredAt = now.toISOString();
        expired.push(post.id);
        dirty = true;
        await this.sendSocialExpiredEmail(post);
        this.logger.log(`Social post "${post.id}" (${post.title}) expired after ${SOCIAL_EXPIRE_D} days`);

      } else if (ageDays >= SOCIAL_REMINDER_D && !post.reminderSentAt) {
        post.reminderSentAt = now.toISOString();
        reminded.push(post.id);
        dirty = true;
        await this.sendSocialReminderEmail(post);
        this.logger.log(`Social post "${post.id}" (${post.title}) reminder sent — ${ageDays.toFixed(1)} days old`);

      } else {
        skipped++;
      }
    }

    if (dirty) {
      await gcsWrite(SOCIAL_OBJ, JSON.stringify(queue, null, 2) + "\n");
    }

    return { reminded, expired, skipped };
  }

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------

  private async sendArticleReminderEmail(article: ArticleEntry): Promise<void> {
    const to = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";
    await this.email.sendEmail({
      to,
      cc: "divya.vats@dikshafoundation.org, nisha.kumari@dikshafoundation.org",
      subject: `REMINDER: Article "${article.title}" awaiting review`,
      html: `<p>This article has been waiting for review for over ${ARTICLE_REMINDER_H} hours and has not yet been approved or rejected.</p>
<p><strong>Slug:</strong> ${article.slug}<br><strong>Title:</strong> ${article.title}</p>
<p>Please action it within the next ${ARTICLE_EXPIRE_D - 2} days before it is automatically archived.</p>
<p style="color:#999;font-size:12px;">Suchi Content Pipeline — automated reminder</p>`,
    });
  }

  private async sendArticleExpiredEmail(article: ArticleEntry): Promise<void> {
    const to = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";
    await this.email.sendEmail({
      to,
      subject: `ARCHIVED: Article "${article.title}" expired without review`,
      html: `<p>No response was received within ${ARTICLE_EXPIRE_D} days. The article has been automatically archived.</p>
<p><strong>Slug:</strong> ${article.slug}<br><strong>Title:</strong> ${article.title}</p>
<p>To recover this article, regenerate it via the admin panel or run the research pipeline again.</p>
<p style="color:#999;font-size:12px;">Suchi Content Pipeline — automated expiry</p>`,
    });
  }

  private async sendSocialReminderEmail(post: SocialPostDraft): Promise<void> {
    const to = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";
    await this.email.sendEmail({
      to,
      cc: "divya.vats@dikshafoundation.org, nisha.kumari@dikshafoundation.org",
      subject: `REMINDER: Social post "${post.title}" awaiting approval`,
      html: `<p>This social post has been waiting for approval for over ${SOCIAL_REMINDER_D} days.</p>
<p><strong>Title:</strong> ${post.title}</p>
<p>If not approved within ${SOCIAL_EXPIRE_D - SOCIAL_REMINDER_D} more days it will be automatically expired.</p>
<p style="color:#999;font-size:12px;">Suchi Distribution Pipeline — automated reminder</p>`,
    });
  }

  private async sendSocialExpiredEmail(post: SocialPostDraft): Promise<void> {
    const to = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";
    await this.email.sendEmail({
      to,
      subject: `EXPIRED: Social post "${post.title}" removed after ${SOCIAL_EXPIRE_D} days`,
      html: `<p>No approval was received within ${SOCIAL_EXPIRE_D} days. The post has been automatically rejected.</p>
<p><strong>Title:</strong> ${post.title}</p>
<p>If this content is still relevant, regenerate it from the article via the distribution pipeline.</p>
<p style="color:#999;font-size:12px;">Suchi Distribution Pipeline — automated expiry</p>`,
    });
  }
}
