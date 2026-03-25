import type { QualityLoopState } from "./types";

// ── Notification payloads ────────────────────────────────────────────────────

interface NotifyPayload {
  subject: string;
  htmlBody: string;
  textBody: string;
}

// ── Send notification via API ────────────────────────────────────────────────

export async function sendNotification(
  apiUrl: string,
  payload: NotifyPayload,
): Promise<void> {
  const resp = await fetch(`${apiUrl}/v1/admin/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.warn(`Notification send failed (${resp.status}): ${text}`);
  }
}

// ── Format approval request email ────────────────────────────────────────────

export function formatApprovalEmail(state: QualityLoopState): NotifyPayload {
  const report = state.baselineReport!;
  const plan = state.repairPlan!;
  const aggregate = report.aggregate;

  const graderRows = Object.entries(aggregate.perGrader)
    .map(([name, stats]) => `| ${name} | ${(stats.mean * 100).toFixed(0)}% | ${(stats.passRate * 100).toFixed(0)}% |`)
    .join("\n");

  const failureList = (state.failureClusters ?? [])
    .slice(0, 5)
    .map((c) => `- [${c.severity}] ${c.code} (${c.frequency} cases): ${c.sampleReason}`)
    .join("\n");

  const actionsList = plan.actions
    .map((a) => `${a.priority}. [${a.effortEstimate}] ${a.action}`)
    .join("\n");

  const filesList = plan.estimatedFiles.map((f) => `- ${f}`).join("\n");

  const textBody = `Quality Loop: ${state.loopId}
Approval Required

=== Scorecard ===
Overall score: ${(aggregate.overall * 100).toFixed(0)}%
Pass rate: ${(aggregate.passRate * 100).toFixed(0)}%
Cases: ${aggregate.caseCount}

| Grader | Mean | Pass Rate |
|--------|------|-----------|
${graderRows}

=== Top Failure Clusters ===
${failureList}

=== Repair Plan ===
Scope: ${plan.scope}
Files:
${filesList}

Actions:
${actionsList}

=== Approve/Reject ===
cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --approve
cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --reject --reason "..."
`;

  const htmlBody = `<h2>Quality Loop: ${state.loopId}</h2>
<p><strong>Approval Required</strong></p>

<h3>Scorecard</h3>
<p>Overall: <strong>${(aggregate.overall * 100).toFixed(0)}%</strong> |
Pass rate: <strong>${(aggregate.passRate * 100).toFixed(0)}%</strong> |
Cases: <strong>${aggregate.caseCount}</strong></p>

<h3>Top Failure Clusters</h3>
<ul>${(state.failureClusters ?? []).slice(0, 5).map((c) => `<li>[${c.severity}] ${c.code} (${c.frequency} cases): ${c.sampleReason}</li>`).join("")}</ul>

<h3>Repair Plan</h3>
<p>Scope: ${plan.scope}</p>
<p>Files:</p><ul>${plan.estimatedFiles.map((f) => `<li><code>${f}</code></li>`).join("")}</ul>
<p>Actions:</p><ol>${plan.actions.map((a) => `<li>[${a.effortEstimate}] ${a.action}</li>`).join("")}</ol>

<h3>Approve / Reject</h3>
<pre>cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --approve
cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --reject --reason "..."</pre>
`;

  return {
    subject: `[Suchi Quality Loop] Approval needed: ${state.loopId} — ${plan.targetCluster.code}`,
    htmlBody,
    textBody,
  };
}

// ── Format comparison email ──────────────────────────────────────────────────

export function formatComparisonEmail(state: QualityLoopState): NotifyPayload {
  const comparison = state.comparison!;

  const deltaSign = comparison.delta >= 0 ? "+" : "";
  const deltaStr = `${deltaSign}${(comparison.delta * 100).toFixed(1)}pp`;

  const perGraderRows = comparison.perGrader
    .map((g) => {
      const d = g.delta >= 0 ? "+" : "";
      return `| ${g.grader} | ${(g.baseline * 100).toFixed(0)}% | ${(g.rerun * 100).toFixed(0)}% | ${d}${(g.delta * 100).toFixed(1)}pp |`;
    })
    .join("\n");

  const textBody = `Quality Loop Complete: ${state.loopId}

=== Score Comparison ===
Baseline overall: ${(comparison.baselineOverall * 100).toFixed(0)}%
Re-run overall:   ${(comparison.rerunOverall * 100).toFixed(0)}%
Delta:            ${deltaStr}

| Grader | Baseline | Re-run | Delta |
|--------|----------|--------|-------|
${perGraderRows}

Improvements: ${comparison.improvements.length > 0 ? comparison.improvements.join(", ") : "None"}
Regressions: ${comparison.regressions.length > 0 ? comparison.regressions.join(", ") : "None"}

Fix branch: ${state.fixBranch ?? "N/A"}
Fix commit: ${state.fixCommit ?? "N/A"}
`;

  const htmlBody = `<h2>Quality Loop Complete: ${state.loopId}</h2>
<p>Baseline: <strong>${(comparison.baselineOverall * 100).toFixed(0)}%</strong> ->
Re-run: <strong>${(comparison.rerunOverall * 100).toFixed(0)}%</strong>
(${deltaStr})</p>

<table border="1" cellpadding="4" cellspacing="0">
<tr><th>Grader</th><th>Baseline</th><th>Re-run</th><th>Delta</th></tr>
${comparison.perGrader.map((g) => {
    const d = g.delta >= 0 ? "+" : "";
    return `<tr><td>${g.grader}</td><td>${(g.baseline * 100).toFixed(0)}%</td><td>${(g.rerun * 100).toFixed(0)}%</td><td>${d}${(g.delta * 100).toFixed(1)}pp</td></tr>`;
  }).join("\n")}
</table>

<p>Fix branch: <code>${state.fixBranch ?? "N/A"}</code><br/>
Fix commit: <code>${state.fixCommit ?? "N/A"}</code></p>
`;

  return {
    subject: `[Suchi Quality Loop] Complete: ${state.loopId} — ${deltaStr}`,
    htmlBody,
    textBody,
  };
}
