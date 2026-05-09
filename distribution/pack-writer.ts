/**
 * Phase 4 — Pack Writer
 *
 * Saves a GeneratedPack (with embedded SafetyReport) to disk and sends a
 * review email to both Suchi distribution reviewers.
 *
 * Email Mode A (no Buffer credentials): HTML email with approve/request-changes
 * buttons plus a Buffer setup prompt.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { GeneratedPack, ChannelName } from "./generator";
import { SafetyReport } from "./safety-checker";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WriteResult {
  packPath: string;   // absolute path to saved JSON
  emailSent: boolean;
  emailError?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPROVE_BASE =
  "https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/distribution/approve";

const REVIEWERS = [
  "gautamgauri@dikshafoundation.org",
  "divya.vats@dikshafoundation.org",
];

const CHANNEL_ORDER: ChannelName[] = [
  "linkedin",
  "twitter",
  "instagram",
  "whatsapp",
  "youtube_short",
];

const CHANNEL_DISPLAY_NAMES: Record<ChannelName, string> = {
  linkedin: "LinkedIn Post",
  twitter: "Twitter / X Thread",
  instagram: "Instagram Carousel Captions",
  whatsapp: "WhatsApp Message",
  youtube_short: "YouTube Short Script",
};

// ---------------------------------------------------------------------------
// HMAC token
// ---------------------------------------------------------------------------

function buildApprovalToken(packId: string): string {
  const secret =
    process.env.DISTRIBUTION_APPROVAL_SECRET || "suchi-dist-dev-secret";
  return createHmac("sha256", secret).update(packId).digest("hex");
}

// ---------------------------------------------------------------------------
// HTML email builder
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildChannelSection(
  channelName: ChannelName,
  pack: GeneratedPack,
  safetyReport: SafetyReport,
): string {
  const displayName = CHANNEL_DISPLAY_NAMES[channelName];
  const channelResult = pack.channels[channelName];
  const safetyResult = safetyReport.channels[channelName];

  // Channel failed generation — skip entirely
  if (!channelResult || channelResult.status === "failed") {
    return `
  <hr>
  <h3 style="color:#d93025;">⚠ ${escapeHtml(displayName)} — Generation failed</h3>
  <div style="background:#fff3f2; padding:12px; border-radius:4px; color:#d93025;">
    ${escapeHtml(channelResult?.error ?? "Unknown error")}
  </div>`;
  }

  // Channel failed safety check — show violations instead of content
  if (safetyResult && !safetyResult.passed) {
    const violationLines = safetyResult.violations
      .map((v) => `<div>• Rule ${v.rule}: ${escapeHtml(v.description)}</div>`)
      .join("\n    ");
    return `
  <hr>
  <h3 style="color:#d93025;">⚠ ${escapeHtml(displayName)} — Safety check failed</h3>
  <div style="background:#fff3f2; padding:12px; border-radius:4px; color:#d93025;">
    ${violationLines}
  </div>`;
  }

  // Channel passed — show content
  return `
  <hr>
  <h3 style="color:#1a73e8;">${escapeHtml(displayName)}</h3>
  <div style="background:#f8f8f8; padding:16px; border-radius:4px; white-space:pre-wrap; font-size:14px;">
${escapeHtml(channelResult.content)}
  </div>`;
}

function buildHtmlEmail(
  pack: GeneratedPack,
  safetyReport: SafetyReport,
  approvalToken: string,
): string {
  const approveUrl = `${APPROVE_BASE}/${encodeURIComponent(pack.articleSlug)}?token=${approvalToken}`;

  const channelSections = CHANNEL_ORDER.map((ch) =>
    buildChannelSection(ch, pack, safetyReport),
  ).join("\n");

  const generatedAtFormatted = new Date(pack.generatedAt).toLocaleDateString(
    "en-IN",
    { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" },
  );

  const requestChangesSubject = encodeURIComponent(`Changes: ${pack.articleTitle}`);
  const requestChangesBody = encodeURIComponent(`Pack ID: ${pack.articleSlug}`);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">

  <h2 style="color: #333;">Review: ${escapeHtml(pack.articleTitle)}</h2>
  <p style="color: #666;">Article: <a href="${escapeHtml(pack.articleUrl)}">${escapeHtml(pack.articleUrl)}</a></p>
  <p style="color: #666;">Generated: ${generatedAtFormatted}</p>

  ${channelSections}

  <hr>
  <div style="text-align:center; margin:32px 0;">
    <a href="${escapeHtml(approveUrl)}"
       style="background:#1a73e8; color:#fff; padding:14px 32px; border-radius:4px; text-decoration:none; font-size:16px; margin-right:16px;">
      ✓ Approve — I’ll post manually
    </a>
    <a href="mailto:gautamgauri@dikshafoundation.org?subject=${requestChangesSubject}&amp;body=${requestChangesBody}"
       style="background:#f1f3f4; color:#333; padding:14px 32px; border-radius:4px; text-decoration:none; font-size:16px;">
      Request Changes
    </a>
  </div>

  <div style="background:#e8f0fe; padding:16px; border-radius:4px; margin-top:24px;">
    <p style="margin:0 0 8px; font-weight:bold;">⚡ Automate your posting</p>
    <p style="margin:0 0 12px; color:#555;">Right now, approved posts are emailed to you for manual copy-paste. Connect Buffer to schedule posts automatically on approval.</p>
    <a href="https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/distribution/setup"
       style="background:#1a73e8; color:#fff; padding:10px 20px; border-radius:4px; text-decoration:none;">
      Connect Buffer →
    </a>
    <p style="margin:8px 0 0; font-size:12px; color:#888;">Setup takes 2 minutes. This prompt disappears once Buffer is connected.</p>
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// SMTP helper — env first, Secret Manager fallback
// ---------------------------------------------------------------------------

async function resolveSmtpPass(): Promise<string | null> {
  // 1. Env var
  if (process.env.SMTP_PASS) {
    return process.env.SMTP_PASS;
  }

  // 2. Secret Manager (optional dependency — wrapped in try/catch)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
    const client = new SecretManagerServiceClient();
    const project =
      process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0202543132";
    const [version] = await client.accessSecretVersion({
      name: `projects/${project}/secrets/SMTP_PASS/versions/latest`,
    });
    const payload = version.payload?.data;
    if (payload) {
      return (
        typeof payload === "string"
          ? payload
          : Buffer.from(payload as Uint8Array).toString("utf-8")
      ).trim();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pack-writer] Could not load SMTP_PASS from Secret Manager: ${msg}`);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Save the distribution pack JSON to disk and send a review email.
 *
 * @param pack          - GeneratedPack produced by generator.ts
 * @param safetyReport  - SafetyReport produced by safety-checker.ts
 * @param packsDir      - Absolute path to the directory where JSON files are saved
 */
export async function writePack(
  pack: GeneratedPack,
  safetyReport: SafetyReport,
  packsDir: string,
): Promise<WriteResult> {
  // ── Step 1: Generate approval token and build enriched pack JSON ──────────

  const approvalToken = buildApprovalToken(pack.articleSlug);
  const tokenExpiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const dateSuffix = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const packFileName = `${pack.articleSlug}-${dateSuffix}.json`;

  await fs.mkdir(packsDir, { recursive: true });
  const packPath = path.join(packsDir, packFileName);

  const enrichedPack = {
    ...pack,
    safetyReport,
    reviewStatus: "email_sent" as const,
    approvalToken,
    tokenExpiresAt,
  };

  await fs.writeFile(packPath, JSON.stringify(enrichedPack, null, 2), "utf-8");

  // ── Step 2: Build HTML email ──────────────────────────────────────────────

  const htmlBody = buildHtmlEmail(pack, safetyReport, approvalToken);
  const subject = `[Suchi Review] ${pack.articleTitle} — Distribution Pack Ready`;

  // ── Step 3: Resolve SMTP credentials and send ────────────────────────────

  const smtpPass = await resolveSmtpPass();

  if (!smtpPass) {
    console.log(
      "[pack-writer] SMTP not configured — skipping email send",
    );
    return { packPath, emailSent: false };
  }

  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpUser =
    process.env.SMTP_USER || "gautamgauri@dikshafoundation.org";

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    await transporter.sendMail({
      from: `"Suchi Distribution" <${smtpUser}>`,
      to: REVIEWERS.join(", "),
      subject,
      html: htmlBody,
    });
    return { packPath, emailSent: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pack-writer] SMTP send failed: ${msg}`);
    return { packPath, emailSent: false, emailError: msg };
  }
}
