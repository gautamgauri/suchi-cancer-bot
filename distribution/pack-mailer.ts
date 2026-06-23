import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { QueueEntry } from "./queue-manager";
import { GeneratedPack, ChannelName } from "./generator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPROVE_BASE =
  "https://suchi-api-lxiveognla-uc.a.run.app/v1/distribution/approve";
const REJECT_BASE =
  "https://suchi-api-lxiveognla-uc.a.run.app/v1/distribution/reject";

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
// Public types
// ---------------------------------------------------------------------------

export interface PackMailResult {
  emailSent: boolean;
  approvalToken: string;
  emailError?: string;
}

// ---------------------------------------------------------------------------
// HMAC token — signed with slug so each pack has a unique token
// ---------------------------------------------------------------------------

function buildApprovalToken(slug: string): string {
  const secret =
    process.env.DISTRIBUTION_APPROVAL_SECRET || "suchi-dist-dev-secret";
  return createHmac("sha256", secret).update(slug).digest("hex");
}

// ---------------------------------------------------------------------------
// HTML helpers
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
): string {
  const displayName = CHANNEL_DISPLAY_NAMES[channelName];
  const channelResult = pack.channels[channelName];

  if (!channelResult || channelResult.status === "failed") {
    return `
  <div style="border:1px solid #f5c6cb; border-radius:6px; padding:16px; margin:12px 0; background:#fff3f2;">
    <h3 style="margin:0 0 8px; color:#d93025;">${escapeHtml(displayName)} — Generation failed</h3>
    <p style="margin:0; font-size:13px; color:#d93025;">${escapeHtml(channelResult?.error ?? "Unknown error")}</p>
  </div>`;
  }

  // Show a truncated preview (first 400 chars) to keep the email scannable
  const preview = channelResult.content.substring(0, 400);
  const truncated = channelResult.content.length > 400;

  return `
  <div style="border:1px solid #dadce0; border-radius:6px; padding:16px; margin:12px 0; background:#fff;">
    <h3 style="margin:0 0 8px; color:#1a73e8;">${escapeHtml(displayName)}</h3>
    <div style="background:#f8f9fa; padding:12px; border-radius:4px; white-space:pre-wrap; font-size:13px; font-family:monospace;">${escapeHtml(preview)}${truncated ? "\n[…truncated for email]" : ""}</div>
  </div>`;
}

function buildHtmlEmail(
  entry: QueueEntry,
  pack: GeneratedPack,
  approvalToken: string,
): string {
  const approveUrl = `${APPROVE_BASE}/${encodeURIComponent(entry.slug)}?token=${approvalToken}`;
  const rejectUrl = `${REJECT_BASE}/${encodeURIComponent(entry.slug)}?token=${approvalToken}`;

  const channelSections = CHANNEL_ORDER.map((ch) =>
    buildChannelSection(ch, pack),
  ).join("\n");

  const generatedAtFormatted = new Date(pack.generatedAt).toLocaleDateString(
    "en-IN",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; background:#f1f3f4; padding:24px;">

  <div style="background:#fff; border-radius:8px; padding:24px; margin-bottom:16px;">
    <h2 style="margin:0 0 8px; color:#1a73e8;">Suchi Distribution — Content Pack Review</h2>
    <p style="margin:0 0 4px; color:#555;">
      <strong>Article:</strong> ${escapeHtml(entry.title)}
    </p>
    <p style="margin:0 0 4px; color:#555;">
      <strong>Slug:</strong> ${escapeHtml(entry.slug)}
      &nbsp;|&nbsp;
      <strong>Generated:</strong> ${generatedAtFormatted}
    </p>
    ${entry.url ? `<p style="margin:0; color:#555;"><strong>Source:</strong> <a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a></p>` : ""}
  </div>

  ${channelSections}

  <div style="background:#fff; border-radius:8px; padding:24px; margin-top:16px; text-align:center;">
    <p style="margin:0 0 20px; font-size:15px; color:#333;">
      Review the content above, then take an action:
    </p>
    <a href="${escapeHtml(approveUrl)}"
       style="background:#188038; color:#fff; padding:14px 32px; border-radius:4px; text-decoration:none; font-size:16px; margin-right:16px; display:inline-block;">
      Approve &amp; Post
    </a>
    <a href="${escapeHtml(rejectUrl)}"
       style="background:#d93025; color:#fff; padding:14px 32px; border-radius:4px; text-decoration:none; font-size:16px; display:inline-block;">
      Reject
    </a>
    <p style="margin:20px 0 0; font-size:12px; color:#888;">
      Approving will immediately post to LinkedIn, Twitter, and Instagram via the API.<br>
      Rejecting marks the pack for revision.
    </p>
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// SMTP helper — env first, Secret Manager fallback
// ---------------------------------------------------------------------------

async function resolveSmtpPass(): Promise<string | null> {
  if (process.env.SMTP_PASS) {
    return process.env.SMTP_PASS;
  }

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
    console.warn(
      `[pack-mailer] Could not load SMTP_PASS from Secret Manager: ${msg}`,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function sendPackEmail(
  entry: QueueEntry,
  pack: GeneratedPack,
): Promise<PackMailResult> {
  const approvalToken = buildApprovalToken(entry.slug);
  const htmlBody = buildHtmlEmail(entry, pack, approvalToken);
  const subject = `[Suchi Review] ${entry.title} — Distribution Pack Ready`;

  const smtpPass = await resolveSmtpPass();

  if (!smtpPass) {
    console.log("[pack-mailer] SMTP not configured — skipping email send");
    return { emailSent: false, approvalToken };
  }

  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpUser =
    process.env.SMTP_USER || "gautamgauri@dikshafoundation.org";

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
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
    return { emailSent: true, approvalToken };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pack-mailer] SMTP send failed: ${msg}`);
    return { emailSent: false, approvalToken, emailError: msg };
  }
}
