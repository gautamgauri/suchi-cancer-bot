#!/usr/bin/env node
/**
 * CI status helper for the Tier1 eval workflow (.github/workflows/eval-tier1.yml).
 *
 * Separates three independently reported outcomes so the GitHub status is
 * unambiguous (see issue #47):
 *   1. evaluation outcome        -> drives the CI conclusion (check subcommand)
 *   2. report/artifact outcome   -> shown in the job summary, warning on failure
 *   3. notification outcome      -> shown in the job summary; failure is a
 *                                   "degraded operation" warning, never a CI failure
 *
 * Evaluation outcome has four states (issue #110 added the last):
 *   passed            every executed case passed on rendered checks
 *   failed            ≥1 case failed on rendered checks — a TRUE quality failure
 *   infra_error       no usable report (harness crash, report missing)
 *   judge_unavailable the LLM judge rendered no verdict for more than
 *                     MAX_UNSCORED_RATIO of cases (429 / 5xx / auth / timeout
 *                     after bounded retries). Infrastructure, not quality:
 *                     those cases are UNSCORED, never counted as failed.
 *                     Unscored cases within the tolerance do not fail CI but
 *                     are listed and emit a warning annotation.
 *
 * Plain Node (no deps) so it is unit-testable with `node --test` and does not
 * interact with the TypeScript build. Never prints secrets or recipient
 * addresses; callers must not pass them in.
 *
 * Subcommands:
 *   result        --report <tier1-report.json> --eval-outcome <success|failure|...>
 *                 --output <eval-result.json> [--max-unscored-ratio <0..1>]
 *                 Writes the machine-readable eval-result.json and emits
 *                 GITHUB_OUTPUT lines (eval_status, should_notify, email_subject).
 *                 The ratio defaults to $EVAL_MAX_UNSCORED_RATIO, then 0.1.
 *   summary       --result <eval-result.json> --artifact-outcome <outcome>
 *                 Prints the job-summary markdown (pipe to $GITHUB_STEP_SUMMARY).
 *   email         --report <tier1-report.json> --out-dir <dir>
 *                 Writes email-subject.txt and email-body.md.
 *   notify-status --send-outcome <success|failure|skipped> --should-notify <true|false>
 *                 Prints the notification section for the job summary.
 *   check         --result <eval-result.json>
 *                 Exits 0 only if evaluation passed; exits 1 with a distinct
 *                 ::error:: for eval failure vs infrastructure error.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const EVAL_STATUS = {
  PASSED: 'passed',
  FAILED: 'failed',
  INFRA_ERROR: 'infra_error',
  JUDGE_UNAVAILABLE: 'judge_unavailable',
};

/** Share of cases allowed to be unscored before the run is declared judge_unavailable. */
const DEFAULT_MAX_UNSCORED_RATIO = 0.1;

function resolveMaxUnscoredRatio(explicit, env = process.env) {
  const candidates = [explicit, env.EVAL_MAX_UNSCORED_RATIO];
  for (const c of candidates) {
    if (c === undefined || c === null || c === '') continue;
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return DEFAULT_MAX_UNSCORED_RATIO;
}

/**
 * Judge facts pulled from a report; tolerant of pre-#110 reports.
 *
 * Two distinct numbers, deliberately not merged:
 *   unscored / unscoredCaseIds  the OUTCOME bucket — cases that are neither
 *                               passed nor failed. Never counted as failures.
 *   judgeUnscoredCases          the AVAILABILITY axis — every case the judge
 *                               left with >=1 missing verdict, including cases
 *                               that also failed on checks that DID render.
 *                               This is what the CI tolerance thresholds, so a
 *                               judge outage is still called an outage even
 *                               when the affected cases failed for other
 *                               reasons too.
 */
function judgeFacts(report) {
  const s = (report && report.summary) || {};
  const results = report && Array.isArray(report.results) ? report.results : [];
  const hasUnscoredCheck = (r) =>
    Array.isArray(r.llmJudgeResults) &&
    r.llmJudgeResults.some((c) => c.unscored === true || c.skipped === true);
  // Outcome bucket: trust the explicit flag; fall back to the heuristic only
  // for reports written before #110 (which carry neither flag).
  const hasExplicitFlag = results.some((r) => typeof r.unscored === 'boolean');
  const isUnscoredOutcome = (r) =>
    hasExplicitFlag ? r.unscored === true : !r.passed && hasUnscoredCheck(r);
  const unscoredCaseIds = results.filter(isUnscoredOutcome).map((r) => r.testCaseId);
  const unscored = typeof s.unscored === 'number' ? s.unscored : unscoredCaseIds.length;
  const total = typeof s.total === 'number' ? s.total : results.length;
  const j = s.judge || {};
  const judgeUnscoredCaseIds = Array.isArray(j.unscoredCaseIds)
    ? j.unscoredCaseIds
    : results.filter(hasUnscoredCheck).map((r) => r.testCaseId);
  const judgeUnscoredCases =
    typeof j.unscoredCases === 'number' ? j.unscoredCases : judgeUnscoredCaseIds.length;
  return {
    total,
    unscored,
    unscoredCaseIds,
    judgeUnscoredCases: Math.max(judgeUnscoredCases, unscored),
    judgeUnscoredCaseIds,
    reasons: j.reasons || {},
    status: j.status || (judgeUnscoredCases > 0 || unscored > 0 ? 'degraded' : 'active'),
  };
}

/**
 * Derive the evaluation status from the eval step outcome and the report.
 * - No report                                   -> infra_error
 * - Unscored cases above the tolerance          -> judge_unavailable (issue #110)
 * - Report with failures on rendered checks     -> failed (true evaluation failure)
 * - Clean report but eval process exited non-zero -> infra_error
 * - Clean report, clean exit                    -> passed (unscored ≤ tolerance is a warning)
 *
 * judge_unavailable outranks failed on purpose: when the judge scored too few
 * cases the run is not a trustworthy quality signal, so the red must say so
 * rather than pointing at whatever subset happened to fail.
 */
function deriveEvalStatus(evalStepOutcome, report, opts = {}) {
  if (!report || !report.summary) return EVAL_STATUS.INFRA_ERROR;
  const maxUnscoredRatio = resolveMaxUnscoredRatio(opts.maxUnscoredRatio, opts.env || process.env);
  const { total, judgeUnscoredCases } = judgeFacts(report);
  if (judgeUnscoredCases > 0 && total > 0 && judgeUnscoredCases / total > maxUnscoredRatio) {
    return EVAL_STATUS.JUDGE_UNAVAILABLE;
  }
  if ((report.summary.failed || 0) > 0) return EVAL_STATUS.FAILED;
  if (evalStepOutcome !== 'success') return EVAL_STATUS.INFRA_ERROR;
  return EVAL_STATUS.PASSED;
}

/** Build the machine-readable eval-result.json payload. */
function buildEvalResult({ report, evalStepOutcome, env = process.env, now = new Date(), maxUnscoredRatio }) {
  const ratio = resolveMaxUnscoredRatio(maxUnscoredRatio, env);
  const status = deriveEvalStatus(evalStepOutcome, report, { maxUnscoredRatio: ratio, env });
  const s = (report && report.summary) || {};
  const q = s.retrievalQuality || null;
  const judge = judgeFacts(report);
  const unscoredSet = new Set(judge.unscoredCaseIds);
  // Unscored cases are NOT failures: exclude them from failedCaseIds (issue #110).
  const failedCaseIds = report && Array.isArray(report.results)
    ? report.results
        .filter((r) => !r.passed && !r.unscored && !unscoredSet.has(r.testCaseId))
        .map((r) => r.testCaseId)
    : [];

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    run: {
      repository: env.GITHUB_REPOSITORY || null,
      runId: env.GITHUB_RUN_ID || null,
      runNumber: env.GITHUB_RUN_NUMBER || null,
      sha: env.GITHUB_SHA || null,
      ref: env.GITHUB_REF_NAME || null,
      workflow: env.GITHUB_WORKFLOW || null,
    },
    evaluation: {
      status,
      evalStepOutcome: evalStepOutcome || null,
      reportFound: Boolean(report),
      total: s.total ?? null,
      passed: s.passed ?? null,
      failed: s.failed ?? null,
      skipped: s.skipped ?? null,
      unscored: report ? judge.unscored : null,
      averageScore: s.averageScore ?? null,
      retrievalQuality: q,
      failedCaseIds,
      unscoredCaseIds: judge.unscoredCaseIds,
      judge: {
        status: report ? judge.status : null,
        maxUnscoredRatio: ratio,
        // Cases the judge could not fully score (superset of `unscored`):
        // this is the number the tolerance is applied to.
        unscoredCases: report ? judge.judgeUnscoredCases : null,
        reasons: judge.reasons,
      },
    },
  };
}

function pct(x) {
  return typeof x === 'number' ? `${(x * 100).toFixed(1)}%` : 'n/a';
}

function statusBadge(status) {
  switch (status) {
    case EVAL_STATUS.PASSED:
      return '✅ passed';
    case EVAL_STATUS.FAILED:
      return '❌ failed (evaluation failure)';
    case EVAL_STATUS.JUDGE_UNAVAILABLE:
      return '⚠️ judge unavailable (LLM judge could not score the run — infrastructure, not quality)';
    default:
      return '⚠️ infrastructure error (no usable eval result)';
  }
}

function formatReasons(reasons) {
  const entries = Object.entries(reasons || {});
  return entries.length > 0 ? entries.map(([k, v]) => `${k}=${v}`).join(', ') : 'n/a';
}

/** Job-summary markdown: eval result, quality metrics, artifact status. */
function buildSummaryMarkdown(result, artifactOutcome) {
  const e = result.evaluation;
  const q = e.retrievalQuality || {};
  const artifactBadge =
    artifactOutcome === 'success'
      ? '✅ uploaded'
      : artifactOutcome === 'skipped'
        ? '⏭️ skipped'
        : `⚠️ upload ${artifactOutcome || 'unknown'} (reporting issue, not an eval failure)`;

  const lines = [
    '## Tier1 Retrieval Quality — Status',
    '',
    '| Component | Status |',
    '|-----------|--------|',
    `| Evaluation | ${statusBadge(e.status)} |`,
    `| Report artifact | ${artifactBadge} |`,
    '',
  ];

  if (e.reportFound) {
    lines.push(
      '### Quality Metrics',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total cases | ${e.total} |`,
      `| Passed | ${e.passed} |`,
      `| Failed | ${e.failed} |`,
      `| Unscored (judge unavailable) | ${e.unscored ?? 0} |`,
      `| Average score | ${pct(e.averageScore)} |`,
      `| Top-3 trusted source presence | ${pct(q.top3TrustedPresenceRate)} |`,
      `| Citation coverage | ${pct(q.citationCoverageRate)} |`,
      `| Abstention rate | ${pct(q.abstentionRate)} |`,
      ''
    );
    if (e.failedCaseIds.length > 0) {
      lines.push(`**Failed cases:** ${e.failedCaseIds.join(', ')}`, '');
    }
    const unscoredIds = e.unscoredCaseIds || [];
    const j = e.judge || {};
    const judgeUnscored = j.unscoredCases || e.unscored || 0;
    if (judgeUnscored > 0 || unscoredIds.length > 0) {
      if (unscoredIds.length > 0) {
        lines.push(
          `**Unscored cases (judge rendered no verdict — not quality failures):** ${unscoredIds.join(', ')}`,
          ''
        );
      }
      lines.push(
        `Judge status: \`${j.status || 'unknown'}\` · ${judgeUnscored}/${e.total} cases not fully scored · ` +
          `reasons: ${formatReasons(j.reasons)} · tolerance: ${pct(j.maxUnscoredRatio)} of cases`,
        ''
      );
    }
  } else {
    lines.push('⚠️ No report file was produced by the eval run.', '');
  }
  return lines.join('\n');
}

/**
 * Notification section for the job summary. A delivery failure is reported as
 * a degraded operation — it must never change the evaluation status.
 */
function buildNotificationSummary(sendOutcome, shouldNotify) {
  let line;
  if (shouldNotify !== 'true') {
    line = '**Notification:** ⏭️ skipped (no notification required for this result)';
  } else if (sendOutcome === 'success') {
    line = '**Notification:** ✅ email sent';
  } else if (sendOutcome === 'skipped') {
    line = '**Notification:** ⏭️ skipped';
  } else {
    line =
      '**Notification:** ⚠️ degraded: notification failed (email delivery error — ' +
      'evaluation status is NOT affected)';
  }
  return `${line}\n`;
}

/** Email subject/body generation (recipient is never handled here). */
function buildEmailReport(report, env = process.env) {
  const s = report.summary;
  const q = s.retrievalQuality || {};
  const judge = judgeFacts(report);
  const unscoredSet = new Set(judge.unscoredCaseIds);
  const isUnscored = (r) => r.unscored === true || unscoredSet.has(r.testCaseId);
  const failed = report.results.filter((r) => !r.passed && !isUnscored(r)).slice(0, 5);
  const unscoredCases = report.results.filter((r) => !r.passed && isUnscored(r));

  let body = '# Suchi Daily Eval Report\n\n';
  body += '## Summary\n';
  body += '| Metric | Value |\n|--------|-------|\n';
  body += `| Total Tests | ${s.total} |\n`;
  body += `| Passed | ${s.passed} (${((s.passed / s.total) * 100).toFixed(1)}%) |\n`;
  body += `| Failed | ${s.failed} |\n`;
  if (judge.unscored > 0) {
    body += `| Unscored (judge unavailable) | ${judge.unscored} |\n`;
  }
  body += `| Average Score | ${(s.averageScore * 100).toFixed(1)}% |\n`;
  body += `| Trusted Source Rate | ${((q.top3TrustedPresenceRate || 0) * 100).toFixed(1)}% |\n`;
  body += `| Citation Coverage | ${((q.citationCoverageRate || 0) * 100).toFixed(1)}% |\n\n`;

  if (failed.length > 0) {
    body += '## Failed Cases (Top 5)\n\n';
    failed.forEach((r, i) => {
      body += `### ${i + 1}. ${r.testCaseId} (Score: ${(r.score * 100).toFixed(1)}%)\n`;
      const detFail = (r.deterministicResults || []).filter((c) => !c.passed);
      if (detFail.length > 0) {
        body += `**Deterministic:** ${detFail.map((c) => c.checkId).join(', ')}\n`;
      }
      const llmFail = (r.llmJudgeResults || []).filter(
        (c) => !c.passed && !c.skipped && !c.unscored
      );
      if (llmFail.length > 0) {
        body += `**LLM Judge:** ${llmFail
          .map((c) => c.checkId + (c.count !== null && c.count !== undefined ? ` (${c.count})` : ''))
          .join(', ')}\n`;
      }
      body += '\n';
    });
    if (s.failed > 5) {
      body += `_...and ${s.failed - 5} more failures. See full report in GitHub Actions._\n`;
    }
  } else if (judge.unscored === 0) {
    body += '## All tests passed! ✅\n';
  } else {
    body += '## No quality failures on scored cases\n';
  }

  if (unscoredCases.length > 0) {
    body += '\n## Unscored Cases (LLM judge unavailable — NOT quality failures)\n\n';
    body += `Judge status: ${judge.status}. Reasons: ${formatReasons(judge.reasons)}\n\n`;
    unscoredCases.slice(0, 10).forEach((r) => {
      body += `- ${r.testCaseId}${r.unscoredReason ? ` — ${r.unscoredReason}` : ''}\n`;
    });
    if (unscoredCases.length > 10) {
      body += `- _...and ${unscoredCases.length - 10} more unscored cases._\n`;
    }
  }

  body += '\n---\n';
  body += `View full report: https://github.com/${env.GITHUB_REPOSITORY || ''}/actions/runs/${env.GITHUB_RUN_ID || ''}\n`;

  const avg = `${(s.averageScore * 100).toFixed(0)}% avg`;
  let subject;
  if (s.failed > 0 && judge.unscored > 0) {
    subject = `Suchi Eval: ${s.failed} failures, ${judge.unscored} unscored (judge unavailable) (${avg})`;
  } else if (s.failed > 0) {
    subject = `Suchi Eval: ${s.failed} failures (${avg})`;
  } else if (judge.unscored > 0) {
    subject = `Suchi Eval: judge unavailable — ${judge.unscored}/${s.total} unscored, 0 failures`;
  } else {
    subject = `Suchi Eval: All ${s.total} tests passed ✅`;
  }

  return { subject, body, shouldSend: s.failed > 0 || judge.unscored > 0 };
}

/** Exit code + annotations for the final CI gate. */
function evaluateCheck(result) {
  if (!result || !result.evaluation) {
    return {
      exitCode: 1,
      message: '::error title=Eval infrastructure error::eval-result.json is missing or malformed.',
    };
  }
  const e = result.evaluation;
  const unscored = e.unscored || 0;
  // Availability axis (>= the outcome bucket) — what the tolerance gates on.
  const judgeUnscored = (e.judge && e.judge.unscoredCases) || unscored;
  const reasons = formatReasons(e.judge && e.judge.reasons);
  switch (e.status) {
    case EVAL_STATUS.PASSED: {
      let message = `Evaluation passed (${e.passed}/${e.total} cases).`;
      if (judgeUnscored > 0) {
        message +=
          `\n::warning title=Judge partially unavailable::${judgeUnscored} of ${e.total} cases were not fully scored ` +
          `(${reasons}) — within tolerance, so CI passes; those cases are unscored, not passed.`;
      }
      return { exitCode: 0, message };
    }
    case EVAL_STATUS.FAILED: {
      let message = `::error title=Evaluation failed::${e.failed} of ${e.total} eval cases failed. This is a true evaluation failure (not a notification or reporting issue).`;
      if (judgeUnscored > 0) {
        message += `\n::warning title=Judge partially unavailable::${judgeUnscored} case(s) were left unscored by the judge (${reasons}); unscored cases are not counted as failures.`;
      }
      return { exitCode: 1, message };
    }
    case EVAL_STATUS.JUDGE_UNAVAILABLE:
      return {
        exitCode: 1,
        message:
          `::error title=Judge unavailable::${judgeUnscored} of ${e.total} eval cases could not be scored because the LLM judge ` +
          `was unavailable (${reasons}). This is an infrastructure failure, not a quality failure` +
          `${(e.failed || 0) > 0 ? `; ${e.failed} case(s) did fail on checks that were scored` : ''}.`,
      };
    default:
      return {
        exitCode: 1,
        message:
          '::error title=Eval infrastructure error::The eval run did not produce a usable result (harness/report failure, not a quality failure).',
      };
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function appendGithubOutput(lines, env = process.env) {
  if (env.GITHUB_OUTPUT) {
    fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  } else {
    // Local/dry-run mode: show what would be exported.
    lines.forEach((l) => process.stdout.write(`${l}\n`));
  }
}

function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  switch (command) {
    case 'result': {
      const report = readJsonIfExists(args.report);
      const result = buildEvalResult({
        report,
        evalStepOutcome: args['eval-outcome'],
        maxUnscoredRatio: args['max-unscored-ratio'],
      });
      const outFile = args.output || 'reports/eval-result.json';
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
      const shouldNotify = report ? buildEmailReport(report).shouldSend : false;
      const subject = report ? buildEmailReport(report).subject : 'Suchi Eval: no report produced';
      appendGithubOutput([
        `eval_status=${result.evaluation.status}`,
        `should_notify=${shouldNotify}`,
        `email_subject=${subject}`,
      ]);
      process.stdout.write(`eval-result.json written (status: ${result.evaluation.status})\n`);
      return 0;
    }
    case 'summary': {
      const result = readJsonIfExists(args.result) || buildEvalResult({ report: null, evalStepOutcome: 'failure' });
      process.stdout.write(`${buildSummaryMarkdown(result, args['artifact-outcome'])}\n`);
      return 0;
    }
    case 'email': {
      const report = readJsonIfExists(args.report);
      if (!report) {
        process.stderr.write('No report available; skipping email generation.\n');
        return 0;
      }
      const { subject, body } = buildEmailReport(report);
      const outDir = args['out-dir'] || '.';
      fs.writeFileSync(path.join(outDir, 'email-subject.txt'), subject);
      fs.writeFileSync(path.join(outDir, 'email-body.md'), body);
      process.stdout.write('Email subject/body files written.\n');
      return 0;
    }
    case 'notify-status': {
      process.stdout.write(buildNotificationSummary(args['send-outcome'], args['should-notify']));
      return 0;
    }
    case 'check': {
      const result = readJsonIfExists(args.result);
      const { exitCode, message } = evaluateCheck(result);
      process.stdout.write(`${message}\n`);
      return exitCode;
    }
    default:
      process.stderr.write(`Unknown command: ${command || '(none)'}\n`);
      return 2;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  EVAL_STATUS,
  DEFAULT_MAX_UNSCORED_RATIO,
  resolveMaxUnscoredRatio,
  judgeFacts,
  deriveEvalStatus,
  buildEvalResult,
  buildSummaryMarkdown,
  buildNotificationSummary,
  buildEmailReport,
  evaluateCheck,
  main,
};
