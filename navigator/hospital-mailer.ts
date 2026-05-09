/**
 * Suchi Navigator — Hospital Mailer
 *
 * Sends a review email for a batch of up to 5 candidate hospitals.
 * SMTP pattern identical to distribution/pack-writer.ts.
 * HMAC approval tokens signed with NAVIGATOR_APPROVAL_SECRET env var.
 */

import { createHmac } from "node:crypto";
import nodemailer from "nodemailer";
import { ResearchTarget, HospitalDraft } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPROVE_BASE =
  "https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/navigator/approve";

const REVIEWERS = [
  "gautamgauri@dikshafoundation.org",
  "divya.vats@dikshafoundation.org",
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MailResult {
  emailSent: boolean;
  approvalToken: string;
  emailError?: string;
}

// ---------------------------------------------------------------------------
// HMAC token
// ---------------------------------------------------------------------------

function buildApprovalToken(batchId: string): string {
  const secret =
    process.env.NAVIGATOR_APPROVAL_SECRET || "suchi-nav-dev-secret";
  return createHmac("sha256", secret).update(batchId).digest("hex");
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

function confidenceBadge(confidence: HospitalDraft["confidence"]): string {
  const colours: Record<HospitalDraft["confidence"], string> = {
    high: "#188038",
    medium: "#e37400",
    low: "#d93025",
  };
  const colour = colours[confidence];
  return `<span style="background:${colour}; color:#fff; padding:2px 8px; border-radius:3px; font-size:12px; font-weight:bold;">${confidence.toUpperCase()}</span>`;
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function buildHospitalCard(h: HospitalDraft, index: number): string {
  const deptList = h.departments.length
    ? h.departments.map((d) => escapeHtml(d.replace(/_/g, " "))).join(", ")
    : "—";

  const doctorList = h.key_doctors.length
    ? h.key_doctors
        .map((d) => `<li>${escapeHtml(d.name)} — <em>${escapeHtml(d.role)}</em></li>`)
        .join("\n")
    : "<li>None listed</li>";

  const sourceList = h.sources.length
    ? h.sources.map((s) => `<li><a href="${escapeHtml(s)}">${escapeHtml(s)}</a></li>`).join("\n")
    : "<li>No sources listed</li>";

  const navNotes = h.navigation_notes.length
    ? h.navigation_notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("\n")
    : "<li>—</li>";

  const accredList = h.accreditation.length
    ? h.accreditation.map((a) => escapeHtml(a)).join(", ")
    : "None";

  return `
  <div style="border:1px solid #dadce0; border-radius:8px; padding:20px; margin:20px 0; background:#fff;">
    <h3 style="margin:0 0 4px; color:#1a73e8;">${index}. ${escapeHtml(h.name)}</h3>
    <p style="margin:0 0 12px; color:#555; font-size:13px;">
      ${escapeHtml(h.short_name)} &nbsp;|&nbsp; ${escapeHtml(h.city)}, ${escapeHtml(h.state)}
      &nbsp;|&nbsp; Tier: <strong>${h.tier ?? "—"}</strong>
      &nbsp;|&nbsp; Confidence: ${confidenceBadge(h.confidence)}
    </p>

    <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:12px;">
      <tr>
        <td style="padding:4px 8px; width:40%; color:#555;">Type</td>
        <td style="padding:4px 8px; font-weight:bold;">${escapeHtml(h.type)}</td>
      </tr>
      <tr style="background:#f8f9fa;">
        <td style="padding:4px 8px; color:#555;">Accreditation</td>
        <td style="padding:4px 8px; font-weight:bold;">${accredList}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px; color:#555;">NCG Member</td>
        <td style="padding:4px 8px; font-weight:bold;">${yesNo(h.ncg_member)}</td>
      </tr>
      <tr style="background:#f8f9fa;">
        <td style="padding:4px 8px; color:#555;">PMJAY Empanelled</td>
        <td style="padding:4px 8px; font-weight:bold;">${yesNo(h.pmjay_empanelled)}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px; color:#555;">Cost Tier</td>
        <td style="padding:4px 8px; font-weight:bold;">${escapeHtml(h.cost_tier ?? "—")}</td>
      </tr>
      <tr style="background:#f8f9fa;">
        <td style="padding:4px 8px; color:#555;">Departments</td>
        <td style="padding:4px 8px;">${deptList}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px; color:#555;">Score</td>
        <td style="padding:4px 8px; font-weight:bold;">${h.score !== null ? h.score + " / 10" : "—"}</td>
      </tr>
      <tr style="background:#f8f9fa;">
        <td style="padding:4px 8px; color:#555;">Phone</td>
        <td style="padding:4px 8px;">${escapeHtml(h.contact.phone ?? "—")}</td>
      </tr>
      <tr>
        <td style="padding:4px 8px; color:#555;">Address</td>
        <td style="padding:4px 8px;">${escapeHtml(h.contact.address ?? "—")}</td>
      </tr>
      ${h.contact.website ? `
      <tr style="background:#f8f9fa;">
        <td style="padding:4px 8px; color:#555;">Website</td>
        <td style="padding:4px 8px;"><a href="${escapeHtml(h.contact.website)}">${escapeHtml(h.contact.website)}</a></td>
      </tr>` : ""}
    </table>

    <p style="margin:0 0 4px; font-weight:bold; font-size:13px;">Notes</p>
    <p style="margin:0 0 12px; font-size:13px; color:#333;">${escapeHtml(h.notes)}</p>

    <p style="margin:0 0 4px; font-weight:bold; font-size:13px;">Navigation Notes</p>
    <ul style="margin:0 0 12px; padding-left:20px; font-size:13px; color:#333;">
      ${navNotes}
    </ul>

    <p style="margin:0 0 4px; font-weight:bold; font-size:13px;">Key Doctors</p>
    <ul style="margin:0 0 12px; padding-left:20px; font-size:13px; color:#333;">
      ${doctorList}
    </ul>

    <p style="margin:0 0 4px; font-weight:bold; font-size:13px;">Sources</p>
    <ul style="margin:0 0 0; padding-left:20px; font-size:12px; color:#555;">
      ${sourceList}
    </ul>
  </div>`;
}

function buildHtmlEmail(
  batch: ResearchTarget,
  approvalToken: string,
): string {
  const approveUrl = `${APPROVE_BASE}/${encodeURIComponent(batch.id)}?token=${approvalToken}`;
  const requestChangesSubject = encodeURIComponent(`Changes: ${batch.id}`);

  const hospitalCards = batch.hospitals
    .slice(0, 5)
    .map((h, i) => buildHospitalCard(h, i + 1))
    .join("\n");

  const hospitalCount = Math.min(batch.hospitals.length, 5);
  const createdFormatted = new Date(batch.createdAt).toLocaleDateString(
    "en-IN",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div style="font-family: Arial, sans-serif; max-width: 720px; margin: 0 auto; background:#f1f3f4; padding:24px;">

  <div style="background:#fff; border-radius:8px; padding:24px; margin-bottom:16px;">
    <h2 style="margin:0 0 8px; color:#1a73e8;">Suchi Navigator — Hospital Review</h2>
    <p style="margin:0 0 4px; color:#555;">
      <strong>Batch:</strong> ${escapeHtml(batch.id)}
      &nbsp;|&nbsp;
      <strong>Region:</strong> ${escapeHtml(batch.region)}
    </p>
    <p style="margin:0; color:#555;">
      <strong>Hospitals for review:</strong> ${hospitalCount}
      &nbsp;|&nbsp;
      <strong>Created:</strong> ${createdFormatted}
    </p>
  </div>

  ${hospitalCards}

  <div style="background:#fff; border-radius:8px; padding:24px; margin-top:16px; text-align:center;">
    <p style="margin:0 0 20px; font-size:15px; color:#333;">
      Review the ${hospitalCount} hospital${hospitalCount !== 1 ? "s" : ""} above, then take an action:
    </p>
    <a href="${escapeHtml(approveUrl)}"
       style="background:#188038; color:#fff; padding:14px 32px; border-radius:4px; text-decoration:none; font-size:16px; margin-right:16px; display:inline-block;">
      Approve All — Add to Directory
    </a>
    <a href="mailto:gautamgauri@dikshafoundation.org?subject=${requestChangesSubject}"
       style="background:#f1f3f4; color:#333; padding:14px 32px; border-radius:4px; text-decoration:none; font-size:16px; display:inline-block; margin-top:8px;">
      Request Changes
    </a>
    <p style="margin:20px 0 0; font-size:12px; color:#888;">
      Approving will mark this batch approved. The API endpoint will then add these hospitals to the directory.<br>
      This approval link is valid for 7 days.
    </p>
  </div>

</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// SMTP helper — env first, Secret Manager fallback (same as pack-writer.ts)
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
    console.warn(
      `[hospital-mailer] Could not load SMTP_PASS from Secret Manager: ${msg}`,
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Send a review email for a research batch (up to 5 hospitals).
 * Returns the approval token regardless of whether the email was sent,
 * so the caller can persist it to queue.json.
 */
export async function sendBatchEmail(
  batch: ResearchTarget,
): Promise<MailResult> {
  const approvalToken = buildApprovalToken(batch.id);
  const htmlBody = buildHtmlEmail(batch, approvalToken);

  const hospitalCount = Math.min(batch.hospitals.length, 5);
  const subject = `[Suchi Navigator] Hospital Review Batch: ${batch.region} — ${hospitalCount} hospital${hospitalCount !== 1 ? "s" : ""} for approval`;

  // Resolve SMTP credentials
  const smtpPass = await resolveSmtpPass();

  if (!smtpPass) {
    console.log(
      "[hospital-mailer] SMTP not configured — skipping email send",
    );
    return { emailSent: false, approvalToken };
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
      from: `"Suchi Navigator" <${smtpUser}>`,
      to: REVIEWERS.join(", "),
      subject,
      html: htmlBody,
    });
    return { emailSent: true, approvalToken };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hospital-mailer] SMTP send failed: ${msg}`);
    return { emailSent: false, approvalToken, emailError: msg };
  }
}
