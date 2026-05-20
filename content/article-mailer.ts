/**
 * Suchi Content Pipeline — Article Mailer
 *
 * Sends a review email for a website article draft.
 * Approve link → GET /admin/content/approve/:slug?token=...
 * Reject  link → GET /admin/content/reject/:slug?token=...
 */

import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { ArticleEntry } from "./types";

const API_BASE = "https://suchi-api-514521785197.us-central1.run.app/v1";

const REVIEWERS = [
  "gautamgauri@dikshafoundation.org",
  "divya.vats@dikshafoundation.org",
];

export interface ArticleMailResult {
  emailSent: boolean;
  approvalToken: string;
  emailError?: string;
}

// ---------------------------------------------------------------------------
// Secret resolution (mirrors hospital-mailer pattern)
// ---------------------------------------------------------------------------

let _secret: string | null = null;

async function resolveSecret(): Promise<string> {
  if (_secret) return _secret;
  if (process.env.CONTENT_APPROVAL_SECRET) {
    _secret = process.env.CONTENT_APPROVAL_SECRET;
    return _secret;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
    const client = new SecretManagerServiceClient();
    const project = process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0202543132";
    const [version] = await client.accessSecretVersion({
      name: `projects/${project}/secrets/CONTENT_APPROVAL_SECRET/versions/latest`,
    });
    const payload = version.payload?.data;
    if (payload) {
      _secret = (typeof payload === "string" ? payload : Buffer.from(payload as Uint8Array).toString("utf-8")).trim();
      return _secret!;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[article-mailer] Could not load CONTENT_APPROVAL_SECRET from Secret Manager: ${msg}`);
  }
  _secret = "suchi-content-dev-secret";
  return _secret;
}

export async function buildApprovalToken(slug: string): Promise<string> {
  const secret = await resolveSecret();
  return createHmac("sha256", secret).update(slug).digest("hex");
}

// ---------------------------------------------------------------------------
// SMTP (same pattern as hospital-mailer)
// ---------------------------------------------------------------------------

async function resolveSmtpPass(): Promise<string | null> {
  if (process.env.SMTP_PASS) return process.env.SMTP_PASS;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
    const client = new SecretManagerServiceClient();
    const project = process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0202543132";
    const [version] = await client.accessSecretVersion({
      name: `projects/${project}/secrets/SMTP_PASS/versions/latest`,
    });
    const payload = version.payload?.data;
    if (payload) {
      return (typeof payload === "string" ? payload : Buffer.from(payload as Uint8Array).toString("utf-8")).trim();
    }
  } catch {
    // ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// Markdown → HTML (basic inline renderer for email)
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inlineMarkdown(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function markdownToHtml(md: string): string {
  // Strip YAML frontmatter
  const stripped = md.replace(/^---[\s\S]+?---\n?/, "");

  const lines = stripped.split("\n");
  const html: string[] = [];
  let inList = false;
  let inBlockquote = false;
  let paraLines: string[] = [];

  const flushPara = () => {
    if (paraLines.length) {
      html.push(`<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#333;">${paraLines.map(inlineMarkdown).join(" ")}</p>`);
      paraLines = [];
    }
  };
  const flushList = () => {
    if (inList) { html.push("</ul>"); inList = false; }
  };
  const flushQuote = () => {
    if (inBlockquote) { html.push("</blockquote>"); inBlockquote = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^## /.test(line)) {
      flushPara(); flushList(); flushQuote();
      html.push(`<h2 style="margin:24px 0 8px;font-size:20px;color:#1a73e8;">${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (/^### /.test(line)) {
      flushPara(); flushList(); flushQuote();
      html.push(`<h3 style="margin:18px 0 6px;font-size:17px;color:#333;">${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (/^> /.test(line)) {
      flushPara(); flushList();
      if (!inBlockquote) {
        html.push(`<blockquote style="margin:0 0 12px;padding:12px 16px;background:#fff3cd;border-left:4px solid #e37400;font-size:14px;color:#555;">`);
        inBlockquote = true;
      }
      html.push(`<p style="margin:0;">${inlineMarkdown(line.slice(2))}</p>`);
    } else if (/^[-*] /.test(line)) {
      flushPara(); flushQuote();
      if (!inList) { html.push(`<ul style="margin:0 0 12px;padding-left:22px;">`); inList = true; }
      html.push(`<li style="margin-bottom:4px;font-size:15px;line-height:1.6;color:#333;">${inlineMarkdown(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      flushPara(); flushList(); flushQuote();
      html.push(`<p style="margin:0 0 4px;font-size:15px;color:#333;padding-left:8px;">${inlineMarkdown(line)}</p>`);
    } else if (line.trim() === "") {
      flushPara(); flushList(); flushQuote();
    } else {
      paraLines.push(line);
    }
  }
  flushPara(); flushList(); flushQuote();

  return html.join("\n");
}

// ---------------------------------------------------------------------------
// Email builder
// ---------------------------------------------------------------------------

function buildReviewEmail(entry: ArticleEntry, markdown: string, approveUrl: string, rejectUrl: string): string {
  const bodyHtml = markdownToHtml(markdown);
  const created = new Date(entry.createdAt).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f3f4;font-family:Arial,sans-serif;">
<div style="max-width:720px;margin:0 auto;padding:24px;">

  <div style="background:#fff;border-radius:8px;padding:24px;margin-bottom:16px;">
    <h2 style="margin:0 0 8px;color:#1a73e8;">Suchi Website — Article Review</h2>
    <p style="margin:0 0 4px;color:#555;font-size:14px;">
      <strong>Slug:</strong> ${esc(entry.slug)} &nbsp;|&nbsp;
      <strong>Type:</strong> ${esc(entry.contentType)} &nbsp;|&nbsp;
      <strong>Drafted:</strong> ${created}
    </p>
    <p style="margin:8px 0 0;color:#333;font-size:14px;">
      Please read the article below and click <strong>Approve</strong> to publish it to the website,
      or <strong>Reject</strong> to discard this draft.
    </p>
  </div>

  <div style="background:#fff;border-radius:8px;padding:28px;margin-bottom:16px;">
    <h1 style="margin:0 0 20px;font-size:24px;color:#1a1a1a;">${esc(entry.title)}</h1>
    ${bodyHtml}
  </div>

  <div style="background:#fff;border-radius:8px;padding:24px;text-align:center;">
    <p style="margin:0 0 20px;font-size:15px;color:#333;">Ready to publish this article to the SCCF website?</p>
    <a href="${esc(approveUrl)}"
       style="background:#188038;color:#fff;padding:14px 36px;border-radius:4px;text-decoration:none;font-size:16px;display:inline-block;margin:0 8px;">
      ✓ Approve &amp; Publish
    </a>
    <a href="${esc(rejectUrl)}"
       style="background:#d93025;color:#fff;padding:14px 36px;border-radius:4px;text-decoration:none;font-size:16px;display:inline-block;margin:0 8px;">
      ✗ Reject
    </a>
    <p style="margin:20px 0 0;font-size:12px;color:#888;">
      Approving will queue this article for the next website deploy. Links are valid for 14 days.
    </p>
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export async function sendArticleReviewEmail(
  entry: ArticleEntry,
  markdown: string,
): Promise<ArticleMailResult> {
  const token = await buildApprovalToken(entry.slug);
  const approveUrl = `${API_BASE}/admin/content/approve/${encodeURIComponent(entry.slug)}?token=${token}`;
  const rejectUrl  = `${API_BASE}/admin/content/reject/${encodeURIComponent(entry.slug)}?token=${token}`;

  const subject = `[Suchi Website] Article for review: ${entry.title}`;
  const html = buildReviewEmail(entry, markdown, approveUrl, rejectUrl);

  const smtpPass = await resolveSmtpPass();
  if (!smtpPass) {
    console.log("[article-mailer] SMTP not configured — skipping email send");
    return { emailSent: false, approvalToken: token };
  }

  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpUser = process.env.SMTP_USER || "gautamgauri@dikshafoundation.org";

  const transporter = nodemailer.createTransport({
    host: smtpHost, port: 587, secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    await transporter.sendMail({
      from: `"Suchi Website" <${smtpUser}>`,
      to: REVIEWERS.join(", "),
      subject,
      html,
    });
    return { emailSent: true, approvalToken: token };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[article-mailer] SMTP send failed: ${msg}`);
    return { emailSent: false, approvalToken: token, emailError: msg };
  }
}
