/**
 * Content Research Service
 *
 * Runs as a daily scheduled task (POST /admin/article-research, SchedulerOidcGuard).
 * Picks the next undrafted topic from content-topics.json, retrieves relevant KB
 * chunks via RAG, drafts a full article with Gemini, saves to GCS, and emails
 * Gautam + Divya for review.
 *
 * Article topics are defined in apps/api/data/content-topics.json (bundled with
 * the Docker image). Topics already in the content queue are skipped.
 */

import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHmac } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { LlmService } from "../llm/llm.service";
import { EmailService } from "../email/email.service";
import { RagService } from "../rag/rag.service";

// ---------------------------------------------------------------------------
// GCS helpers
// ---------------------------------------------------------------------------

const GCS_BUCKET  = process.env.QUEUE_GCS_BUCKET;
const GCS_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";

function getStorage(): Storage {
  return new Storage({ projectId: GCS_PROJECT });
}

async function gcsRead(object: string): Promise<string> {
  if (!GCS_BUCKET) throw new Error("QUEUE_GCS_BUCKET not configured");
  const [buf] = await getStorage().bucket(GCS_BUCKET).file(object).download() as [Buffer];
  return buf.toString("utf-8");
}

async function gcsWrite(object: string, content: string, contentType = "application/json"): Promise<void> {
  if (!GCS_BUCKET) return;
  await getStorage().bucket(GCS_BUCKET).file(object).save(content, { contentType });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArticleTopic {
  slug: string;
  title: string;
  contentType: string;
  ragQueries: string[];
  relatedPages: string[];
}

interface ArticleEntry {
  slug: string;
  title: string;
  contentType: string;
  status: string;
  createdAt: string;
  approvalToken?: string;
  emailSentAt?: string;
}

interface ContentQueue { articles: ArticleEntry[] }

// ---------------------------------------------------------------------------
// Article prompt
// ---------------------------------------------------------------------------

function buildArticlePrompt(topic: ArticleTopic, chunks: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const relatedList = topic.relatedPages.map((r) => `  - ${r}`).join("\n");

  return `You are a medical writer for Suchi, an Indian cancer information service. Write a patient-facing website article grounded ONLY in the reference material below.

ARTICLE TO WRITE: "${topic.title}"
Content type: ${topic.contentType}

CLINICAL CONTENT GUIDELINES:
- Ground all clinical claims in the REFERENCE MATERIAL (NCI public database). Do not invent details.
- Language: Plain English. No jargon without explanation. Compassionate and factual.
- Length: 800–1400 words. Use H2 headings and short paragraphs.
- End with a "Questions to ask your doctor" section (5–8 numbered questions).

INDIA CONTEXT — follow these rules carefully:
- Readers come from all over India — not just Bihar or East India. Write for a pan-India audience.
- Do NOT name specific hospitals (e.g., Mahavir Cancer Sansthan, IGIMS, AIIMS Patna). Hospital availability varies enormously by location.
- Instead, describe the *type* of facility to look for: "a government cancer hospital", "an NCG-affiliated hospital", "a hospital with a radiation oncology department".
- For cost and financial support, give general guidance only:
  - Note that government hospitals are significantly cheaper than private hospitals.
  - Mention that Ayushman Bharat PM-JAY may cover treatment for eligible families — but direct the reader to check their eligibility and their hospital's empanelment status, not to assume coverage.
  - Do not state specific costs in rupees — prices vary widely by hospital, city, and regimen.
- Avoid phrases like "in Bihar", "in Patna", "in East India" unless the article is specifically about a regional resource.

OUTPUT FORMAT — return ONLY the complete markdown file below (no explanation, no fences):

---
schema_version: "1.0"
page_id: ${topic.slug}
title: "${topic.title}"
summary: >
  [2-sentence summary of what this page covers]
content_type: ${topic.contentType}
locale: en
geo_relevance: ["IN-pan"]
audience: ["patient", "caregiver"]
last_reviewed: ${today}
review_status: ai_draft
version_id: "v1.0.0-${today}-content-draft-001"
provenance:
  generator_model: gemini-via-suchi-api
  generator_run_id: "auto-${today}"
  pipeline_version: "0.2"
  primary_source: NCI (National Cancer Institute) public database
  source_chunks:
    - doc_id: [replace with actual NCI doc_id from reference material]
      chunk_id: [replace with chunk identifier]
      source: NCI
related_pages:
${relatedList}
tags:
  cancer_types: []
  situations: ["newly-diagnosed", "treatment-choices"]
  topics: ["${topic.contentType}", "${topic.slug}"]
featured: false
---

> **Important:** This page is for general information only. Always follow your doctor's and care team's guidance.

[Article content here — pan-India audience, no specific hospital names, general cost guidance only.]

---

REFERENCE MATERIAL (NCI public database — primary source for all clinical claims):
${chunks}`;
}

// ---------------------------------------------------------------------------
// Email builder
// ---------------------------------------------------------------------------

const APPROVE_BASE = "https://suchi-api-514521785197.us-central1.run.app/v1/admin/content/approve";
const REJECT_BASE  = "https://suchi-api-514521785197.us-central1.run.app/v1/admin/content/reject";

function buildApprovalToken(slug: string): string {
  const secret = process.env.CONTENT_APPROVAL_SECRET ?? "suchi-content-dev-secret";
  return createHmac("sha256", secret).update(slug).digest("hex");
}

function buildReviewEmail(entry: ArticleEntry, token: string, articleMarkdown: string, reviewerName: string): string {
  const encodedSlug = encodeURIComponent(entry.slug);
  const encodedName = encodeURIComponent(reviewerName);
  const approveUrl = `${APPROVE_BASE}/${encodedSlug}?token=${token}&approver=${encodedName}`;
  const rejectUrl  = `${REJECT_BASE}/${encodedSlug}?token=${token}&approver=${encodedName}`;

  // Show just the first 600 chars of the article body (after frontmatter) as preview
  const bodyStart = articleMarkdown.indexOf("\n---\n", 4);
  const preview = bodyStart > 0
    ? articleMarkdown.slice(bodyStart + 5, bodyStart + 605).replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";

  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:700px;margin:auto;padding:20px">
<h2>Content Review — New Article Draft</h2>
<p><strong>Title:</strong> ${entry.title}<br>
<strong>Type:</strong> ${entry.contentType}<br>
<strong>Slug:</strong> <code>${entry.slug}</code></p>

<h3>Article Preview</h3>
<div style="background:#f9f9f9;padding:16px;border-left:4px solid #1a73e8;font-size:14px;white-space:pre-wrap;font-family:monospace">${preview}…</div>

<p style="margin-top:24px">
  <a href="${approveUrl}" style="background:#188038;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;margin-right:12px">
    ✓ Approve &amp; Publish
  </a>
  <a href="${rejectUrl}" style="background:#d93025;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none">
    ✗ Reject
  </a>
</p>
<p style="color:#666;font-size:12px">Suchi Content Pipeline · Generated from Suchi KB via Gemini</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ArticleResearchResult {
  status: "no_pending" | "drafted" | "error";
  slug?: string;
  title?: string;
  kbChunksUsed?: number;
  emailSent?: boolean;
  message?: string;
}

@Injectable()
export class ContentResearchService {
  private readonly logger = new Logger(ContentResearchService.name);

  // Resolved once at first use
  private topicsPath = path.resolve(__dirname, "../../../data/content-topics.json");

  constructor(
    private readonly llm: LlmService,
    private readonly email: EmailService,
    private readonly rag: RagService,
  ) {}

  async runResearch(): Promise<ArticleResearchResult> {
    // 1. Load topic list
    let topics: ArticleTopic[];
    try {
      const raw = await fs.readFile(this.topicsPath, "utf-8");
      topics = JSON.parse(raw) as ArticleTopic[];
    } catch (err) {
      this.logger.error("Failed to read content-topics.json", err);
      return { status: "error", message: `Could not load topics: ${String(err)}` };
    }

    // 2. Load content queue to find what's already drafted
    let queue: ContentQueue = { articles: [] };
    try {
      const raw = await gcsRead("content-queue.json");
      queue = JSON.parse(raw) as ContentQueue;
    } catch {
      this.logger.warn("content-queue.json not found in GCS — treating as empty");
    }

    const draftedSlugs = new Set(queue.articles.map((a) => a.slug));
    const topic = topics.find((t) => !draftedSlugs.has(t.slug));

    if (!topic) {
      this.logger.log("All topics already drafted — nothing to do");
      return { status: "no_pending" };
    }

    this.logger.log(`Drafting article: ${topic.slug} — "${topic.title}"`);

    // 3. RAG retrieval — run all queries, deduplicate chunks by id
    const chunkMap = new Map<string, string>();
    for (const query of topic.ragQueries) {
      try {
        const chunks = await this.rag.retrieveWithMetadata(query, 5);
        for (const chunk of chunks) {
          if (!chunkMap.has(chunk.chunkId)) {
            chunkMap.set(chunk.chunkId, `[Source: ${chunk.docId}]\n${chunk.content}`);
          }
        }
      } catch (err) {
        this.logger.warn(`RAG query failed for "${query}": ${String(err)}`);
      }
    }

    const chunksText = [...chunkMap.values()].join("\n\n---\n\n");
    this.logger.log(`Retrieved ${chunkMap.size} unique KB chunks for ${topic.slug}`);

    if (chunkMap.size === 0) {
      this.logger.warn(`No KB chunks found for ${topic.slug} — proceeding with general knowledge`);
    }

    // 4. Draft article with Gemini
    let markdown: string;
    try {
      markdown = await this.llm.generate(
        "You are a medical writer for an Indian cancer information service. Output only the requested markdown file.",
        chunksText,
        buildArticlePrompt(topic, chunksText),
      );
    } catch (err) {
      this.logger.error("LLM call failed", err);
      return { status: "error", slug: topic.slug, message: `LLM failed: ${String(err)}` };
    }

    // Strip any accidental code fences
    const cleanedMarkdown = markdown.replace(/^```(?:markdown|md)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();

    // 5. Save draft to GCS
    try {
      await gcsWrite(`content-drafts/${topic.slug}.md`, cleanedMarkdown, "text/markdown");
      this.logger.log(`Draft saved to GCS: content-drafts/${topic.slug}.md`);
    } catch (err) {
      this.logger.error("Failed to save draft to GCS", err);
      return { status: "error", slug: topic.slug, message: `GCS draft write failed: ${String(err)}` };
    }

    // 6. Build token and add to content queue
    const token = buildApprovalToken(topic.slug);
    const entry: ArticleEntry = {
      slug: topic.slug,
      title: topic.title,
      contentType: topic.contentType,
      status: "sent_for_review",
      createdAt: new Date().toISOString(),
      approvalToken: token,
      emailSentAt: new Date().toISOString(),
    };
    queue.articles.push(entry);

    try {
      await gcsWrite("content-queue.json", JSON.stringify(queue, null, 2) + "\n");
      this.logger.log(`content-queue.json updated — ${topic.slug} added`);
    } catch (err) {
      this.logger.error("Failed to update content-queue.json", err);
      return { status: "error", slug: topic.slug, message: `GCS queue write failed: ${String(err)}` };
    }

    // 7. Send review email — one per reviewer so each link carries the reviewer's name
    const reviewers: Array<{ email: string; name: string }> = [
      { email: process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org", name: "Gautam" },
      { email: "divya.vats@dikshafoundation.org", name: "Divya" },
      { email: "nisha.kumari@dikshafoundation.org", name: "Nisha" },
    ];
    let emailSent = false;
    for (const reviewer of reviewers) {
      const sent = await this.email.sendEmail({
        to: reviewer.email,
        subject: `Content Review: "${topic.title}"`,
        html: buildReviewEmail(entry, token, cleanedMarkdown, reviewer.name),
      });
      if (sent) emailSent = true;
    }

    this.logger.log(`Article "${topic.slug}" drafted — ${chunkMap.size} KB chunks, email: ${emailSent}`);

    return {
      status: "drafted",
      slug: topic.slug,
      title: topic.title,
      kbChunksUsed: chunkMap.size,
      emailSent,
    };
  }

  /**
   * FR-CONTENT-010: Notify the team when approved articles are waiting to be published.
   * Full automation (git push + suchi-web deploy) is deferred until Cloud Build git
   * push permissions are configured (OD-001). This method is the interim solution.
   */
  async notifyApprovedArticles(): Promise<{ notified: boolean; count: number; slugs: string[] }> {
    let raw: string;
    try {
      raw = await gcsRead("content-queue.json");
    } catch {
      return { notified: false, count: 0, slugs: [] };
    }

    const queue = JSON.parse(raw) as { articles: ArticleEntry[] };
    const approved = (queue.articles ?? []).filter((a) => a.status === "approved");

    if (approved.length === 0) {
      this.logger.log("notify-publish: no approved articles pending");
      return { notified: false, count: 0, slugs: [] };
    }

    const slugList = approved.map((a) => `<li><strong>${a.slug}</strong> — ${a.title}</li>`).join("\n");
    const to = process.env.DAILY_REPORT_EMAIL ?? "gautamgauri@dikshafoundation.org";

    await this.email.sendEmail({
      to,
      subject: `ACTION REQUIRED: ${approved.length} approved article(s) pending publish`,
      html: `<p>${approved.length} article(s) have been approved and are ready to publish to the website:</p>
<ul>${slugList}</ul>
<p>To publish:</p>
<ol>
  <li>Run <code>npx ts-node content/cli.ts publish</code> from the repo root</li>
  <li>Commit and push the changes to main</li>
  <li>Cloud Build will deploy suchi-web automatically</li>
</ol>
<p style="color:#999;font-size:12px;">Suchi Content Pipeline — automated publish reminder (FR-CONTENT-010)</p>`,
    });

    this.logger.log(`notify-publish: sent email for ${approved.length} approved article(s): ${approved.map((a) => a.slug).join(", ")}`);
    return { notified: true, count: approved.length, slugs: approved.map((a) => a.slug) };
  }
}
