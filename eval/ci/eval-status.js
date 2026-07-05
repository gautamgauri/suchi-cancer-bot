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
 * Plain Node (no deps) so it is unit-testable with `node --test` and does not
 * interact with the TypeScript build. Never prints secrets or recipient
 * addresses; callers must not pass them in.
 *
 * Subcommands:
 *   result        --report <tier1-report.json> --eval-outcome <success|failure|...>
 *                 --output <eval-result.json>
 *                 Writes the machine-readable eval-result.json and emits
 *                 GITHUB_OUTPUT lines (eval_status, should_notify, email_subject).
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
};

/**
 * Derive the evaluation status from the eval step outcome and the report.
 * - No report            -> infra_error (the harness never produced results)
 * - Report with failures -> failed (true evaluation failure)
 * - Clean report but the eval process exited non-zero -> infra_error
 * - Clean report, clean exit -> passed
 */
function deriveEvalStatus(evalStepOutcome, report) {
  if (!report || !report.summary) return EVAL_STATUS.INFRA_ERROR;
  if ((report.summary.failed || 0) > 0) return EVAL_STATUS.FAILED;
  if (evalStepOutcome !== 'success') return EVAL_STATUS.INFRA_ERROR;
  return EVAL_STATUS.PASSED;
}

/** Build the machine-readable eval-result.json payload. */
function buildEvalResult({ report, evalStepOutcome, env = process.env, now = new Date() }) {
  const status = deriveEvalStatus(evalStepOutcome, report);
  const s = (report && report.summary) || {};
  const q = s.retrievalQuality || null;
  const failedCaseIds = report && Array.isArray(report.results)
    ? report.results.filter((r) => !r.passed).map((r) => r.testCaseId)
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
      averageScore: s.averageScore ?? null,
      retrievalQuality: q,
      failedCaseIds,
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
    default:
      return '⚠️ infrastructure error (no usable eval result)';
  }
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
      `| Average score | ${pct(e.averageScore)} |`,
      `| Top-3 trusted source presence | ${pct(q.top3TrustedPresenceRate)} |`,
      `| Citation coverage | ${pct(q.citationCoverageRate)} |`,
      `| Abstention rate | ${pct(q.abstentionRate)} |`,
      ''
    );
    if (e.failedCaseIds.length > 0) {
      lines.push(`**Failed cases:** ${e.failedCaseIds.join(', ')}`, '');
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
  const failed = report.results.filter((r) => !r.passed).slice(0, 5);

  let body = '# Suchi Daily Eval Report\n\n';
  body += '## Summary\n';
  body += '| Metric | Value |\n|--------|-------|\n';
  body += `| Total Tests | ${s.total} |\n`;
  body += `| Passed | ${s.passed} (${((s.passed / s.total) * 100).toFixed(1)}%) |\n`;
  body += `| Failed | ${s.failed} |\n`;
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
      const llmFail = (r.llmJudgeResults || []).filter((c) => !c.passed && !c.skipped);
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
  } else {
    body += '## All tests passed! ✅\n';
  }

  body += '\n---\n';
  body += `View full report: https://github.com/${env.GITHUB_REPOSITORY || ''}/actions/runs/${env.GITHUB_RUN_ID || ''}\n`;

  const subject =
    s.failed > 0
      ? `Suchi Eval: ${s.failed} failures (${(s.averageScore * 100).toFixed(0)}% avg)`
      : `Suchi Eval: All ${s.total} tests passed ✅`;

  return { subject, body, shouldSend: s.failed > 0 };
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
  switch (e.status) {
    case EVAL_STATUS.PASSED:
      return { exitCode: 0, message: `Evaluation passed (${e.passed}/${e.total} cases).` };
    case EVAL_STATUS.FAILED:
      return {
        exitCode: 1,
        message: `::error title=Evaluation failed::${e.failed} of ${e.total} eval cases failed. This is a true evaluation failure (not a notification or reporting issue).`,
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
      const result = buildEvalResult({ report, evalStepOutcome: args['eval-outcome'] });
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
  deriveEvalStatus,
  buildEvalResult,
  buildSummaryMarkdown,
  buildNotificationSummary,
  buildEmailReport,
  evaluateCheck,
  main,
};
