/**
 * Autoresearch v1 — Run Summary Emailer
 *
 * After a nightly autoresearch run, packages the experiment logs + score
 * deltas into an HTML email and sends it to the recipient. SMTP credentials
 * are pulled from env or GCP Secret Manager (mirrors transcript-emailer).
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import nodemailer from "nodemailer";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import type { ExperimentLog, ScoreSnapshot } from "./types";

interface SummaryInput {
  experiments: ExperimentLog[];
  baselineScores: ScoreSnapshot;
  finalScores: ScoreSnapshot;
  recipientEmail: string;
  durationMs: number;
  /** Optional run label (e.g., "nightly", "manual") for the subject line. */
  runLabel?: string;
}

export async function emailAutoresearchSummary(input: SummaryInput): Promise<boolean> {
  const { experiments, baselineScores, finalScores, recipientEmail, durationMs, runLabel } = input;

  const accepted = experiments.filter((e) => e.decision === "accepted");
  const rejected = experiments.filter((e) => e.decision === "rejected");
  const skipped = experiments.filter((e) => e.decision === "skipped");

  const passDelta = (finalScores.passRate - baselineScores.passRate) * 100;
  const overallDelta = (finalScores.overall - baselineScores.overall) * 100;
  const sign = (n: number) => (n >= 0 ? "+" : "");

  const label = runLabel ? `${runLabel} ` : "";
  const subject =
    `Suchi Autoresearch ${label}— ${accepted.length} accepted / ${rejected.length} rejected / ${skipped.length} skipped — ` +
    `pass ${(baselineScores.passRate * 100).toFixed(0)}% → ${(finalScores.passRate * 100).toFixed(0)}% (${sign(passDelta)}${passDelta.toFixed(1)}pp)`;

  const html = buildHtml({
    experiments, baselineScores, finalScores, durationMs,
    accepted: accepted.length, rejected: rejected.length, skipped: skipped.length,
    passDelta, overallDelta,
  });
  const text = buildPlainText({
    experiments, baselineScores, finalScores, durationMs,
    passDelta, overallDelta,
  });

  // Always save the HTML locally for inspection.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const htmlPath = path.resolve(process.cwd(), "reports", `autoresearch-summary-${stamp}.html`);
  await fs.mkdir(path.dirname(htmlPath), { recursive: true });
  await fs.writeFile(htmlPath, html, "utf-8");
  console.log(`\nAutoresearch summary HTML: ${htmlPath}`);

  // SMTP — env vars first, then Secret Manager fallback (same pattern as transcript-emailer).
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpUser = process.env.SMTP_USER || "gautamgauri@dikshafoundation.org";
  let smtpPass = process.env.SMTP_PASS;

  if (!smtpPass) {
    try {
      const client = new SecretManagerServiceClient();
      const project = process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0202543132";
      const [version] = await client.accessSecretVersion({
        name: `projects/${project}/secrets/SMTP_PASS/versions/latest`,
      });
      const payload = version.payload?.data;
      if (payload) {
        smtpPass = (typeof payload === "string" ? payload : Buffer.from(payload).toString("utf-8")).trim();
      }
    } catch (err: any) {
      console.warn(`Could not load SMTP_PASS from Secret Manager: ${err.message}`);
    }
  }

  if (!smtpPass) {
    console.log("SMTP not configured — skipping email send. HTML saved locally.");
    return false;
  }

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port,
    secure: port === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || `Suchi Autoresearch <${smtpUser}>`,
      to: recipientEmail,
      subject,
      text,
      html,
    });
    console.log(`Autoresearch summary emailed: ${info.messageId} → ${recipientEmail}`);
    return true;
  } catch (err: any) {
    console.error(`SMTP send failed: ${err.message} — HTML report still saved locally.`);
    return false;
  }
}

// ── Renderers ─────────────────────────────────────────────────────────────

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function deltaCell(before: number, after: number, suffix = "%"): string {
  const delta = after - before;
  const color = delta > 0 ? "#0a7d2e" : delta < 0 ? "#a4181f" : "#666";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
  return `<td style="padding:6px;border:1px solid #ddd"><span style="color:${color}">${arrow} ${(after).toFixed(1)}${suffix}</span> <span style="color:#888">(was ${(before).toFixed(1)}${suffix})</span></td>`;
}

function buildHtml(d: {
  experiments: ExperimentLog[];
  baselineScores: ScoreSnapshot;
  finalScores: ScoreSnapshot;
  durationMs: number;
  accepted: number;
  rejected: number;
  skipped: number;
  passDelta: number;
  overallDelta: number;
}): string {
  const rows = d.experiments.map((e) => {
    const agentLabel = e.agent
      ? { prompt: "Prompt", kb: "KB", config: "Config" }[e.agent]
      : "—";
    const bucketTag = e.failureCluster.clusterTag ? ` [${escape(e.failureCluster.clusterTag)}]` : "";
    const decisionColor = { accepted: "#0a7d2e", rejected: "#a4181f", skipped: "#888" }[e.decision];
    const after = e.afterScores;
    const delta = after ? ((after.passRate - e.beforeScores.passRate) * 100).toFixed(1) : "—";
    const sign = after && after.passRate >= e.beforeScores.passRate ? "+" : "";
    // Surface the skip/reject reason inline in the Hypothesis cell — without it,
    // every "(none)" hypothesis collapses to the same opaque row in the email.
    const reasonHtml =
      e.decision !== "accepted" && e.reason
        ? `<br><span style="color:#888;font-size:11px;font-style:italic">${escape(e.reason)}</span>`
        : "";
    return `
      <tr>
        <td style="padding:6px;border:1px solid #ddd">${e.iteration}</td>
        <td style="padding:6px;border:1px solid #ddd">${agentLabel}</td>
        <td style="padding:6px;border:1px solid #ddd">${escape(e.failureCluster.failureType)}${bucketTag} <span style="color:#666">[${e.failureCluster.severity}]</span></td>
        <td style="padding:6px;border:1px solid #ddd">${escape(e.hypothesis.label)}${reasonHtml}</td>
        <td style="padding:6px;border:1px solid #ddd"><code>${escape(e.repairableFile || "—")}</code></td>
        <td style="padding:6px;border:1px solid #ddd"><span style="color:${decisionColor};font-weight:bold">${e.decision.toUpperCase()}</span></td>
        <td style="padding:6px;border:1px solid #ddd">${after ? `${sign}${delta}pp` : "—"}</td>
        <td style="padding:6px;border:1px solid #ddd"><code>${escape(e.branch || "—")}</code></td>
      </tr>`;
  }).join("");

  const branchesToReview = d.experiments
    .filter((e) => e.decision === "accepted")
    .map((e) => `  git checkout ${e.branch} &amp;&amp; git diff main...${e.branch}`)
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Suchi Autoresearch Summary</title>
</head>
<body style="font-family:-apple-system,Helvetica,sans-serif;max-width:980px;margin:24px auto;color:#222">
  <h1 style="margin-bottom:4px">Suchi Autoresearch Summary</h1>
  <div style="color:#666;margin-bottom:24px">${new Date().toISOString()} — duration ${fmtDuration(d.durationMs)}</div>

  <h2>Headline</h2>
  <table style="border-collapse:collapse;margin-bottom:24px">
    <tr>
      <td style="padding:6px;border:1px solid #ddd;font-weight:bold;background:#f7f7f7">Pass rate</td>
      ${deltaCell(d.baselineScores.passRate * 100, d.finalScores.passRate * 100, "%")}
    </tr>
    <tr>
      <td style="padding:6px;border:1px solid #ddd;font-weight:bold;background:#f7f7f7">Overall score</td>
      ${deltaCell(d.baselineScores.overall * 100, d.finalScores.overall * 100, "%")}
    </tr>
    <tr>
      <td style="padding:6px;border:1px solid #ddd;font-weight:bold;background:#f7f7f7">P0 failures</td>
      <td style="padding:6px;border:1px solid #ddd">${d.baselineScores.p0Failures} → ${d.finalScores.p0Failures}</td>
    </tr>
    <tr>
      <td style="padding:6px;border:1px solid #ddd;font-weight:bold;background:#f7f7f7">Citation coverage</td>
      ${deltaCell(d.baselineScores.citationCoverageRate * 100, d.finalScores.citationCoverageRate * 100, "%")}
    </tr>
    <tr>
      <td style="padding:6px;border:1px solid #ddd;font-weight:bold;background:#f7f7f7">Iterations</td>
      <td style="padding:6px;border:1px solid #ddd">${d.experiments.length} total — <span style="color:#0a7d2e">${d.accepted} accepted</span>, <span style="color:#a4181f">${d.rejected} rejected</span>, <span style="color:#888">${d.skipped} skipped</span></td>
    </tr>
  </table>

  <h2>Experiments</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#f7f7f7">
        <th style="padding:6px;border:1px solid #ddd;text-align:left">#</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">Agent</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">Cluster</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">Hypothesis</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">File</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">Decision</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">Δ pass</th>
        <th style="padding:6px;border:1px solid #ddd;text-align:left">Branch</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="8" style="padding:6px;border:1px solid #ddd;color:#888">No experiments ran.</td></tr>`}</tbody>
  </table>

  ${
    branchesToReview
      ? `<h2 style="margin-top:32px">Branches awaiting human review</h2>
         <pre style="background:#f7f7f7;padding:12px;border-radius:4px;overflow-x:auto">${branchesToReview}</pre>
         <p style="color:#a4181f;font-weight:bold">Do NOT auto-merge. Review each diff before merging to main.</p>`
      : ""
  }
</body>
</html>`;
}

function buildPlainText(d: {
  experiments: ExperimentLog[];
  baselineScores: ScoreSnapshot;
  finalScores: ScoreSnapshot;
  durationMs: number;
  passDelta: number;
  overallDelta: number;
}): string {
  const lines: string[] = [];
  lines.push("Suchi Autoresearch Summary");
  lines.push(new Date().toISOString());
  lines.push(`Duration: ${fmtDuration(d.durationMs)}`);
  lines.push("");
  const sign = (n: number) => (n >= 0 ? "+" : "");
  lines.push(`Pass rate: ${(d.baselineScores.passRate * 100).toFixed(1)}% -> ${(d.finalScores.passRate * 100).toFixed(1)}% (${sign(d.passDelta)}${d.passDelta.toFixed(1)}pp)`);
  lines.push(`Overall:   ${(d.baselineScores.overall * 100).toFixed(1)}% -> ${(d.finalScores.overall * 100).toFixed(1)}% (${sign(d.overallDelta)}${d.overallDelta.toFixed(1)}pp)`);
  lines.push(`P0 fails:  ${d.baselineScores.p0Failures} -> ${d.finalScores.p0Failures}`);
  lines.push("");
  lines.push("Experiments:");
  for (const e of d.experiments) {
    const tag = e.failureCluster.clusterTag ? ` [${e.failureCluster.clusterTag}]` : "";
    const after = e.afterScores;
    const delta = after ? `${after.passRate >= e.beforeScores.passRate ? "+" : ""}${((after.passRate - e.beforeScores.passRate) * 100).toFixed(1)}pp` : "—";
    lines.push(`  #${e.iteration} ${e.decision.toUpperCase()} | ${e.failureCluster.failureType}${tag} | ${e.hypothesis.label} | ${delta}`);
    if (e.decision !== "accepted" && e.reason) {
      lines.push(`     reason: ${e.reason}`);
    }
  }
  return lines.join("\n");
}
