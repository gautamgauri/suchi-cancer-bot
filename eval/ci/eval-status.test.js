/**
 * Regression tests for eval/ci/eval-status.js (issue #47).
 *
 * Run with: node --test eval/ci/
 * (or from eval/: npm run test:ci)
 *
 * The key regression: a notification (email) delivery failure must never be
 * reported as an evaluation failure, and a true evaluation failure must fail
 * CI regardless of the notification outcome.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  EVAL_STATUS,
  deriveEvalStatus,
  buildEvalResult,
  buildSummaryMarkdown,
  buildNotificationSummary,
  buildEmailReport,
  evaluateCheck,
} = require('./eval-status');

function makeReport({ failed = 0, total = 21 } = {}) {
  const results = [];
  for (let i = 0; i < total; i += 1) {
    const isFailed = i < failed;
    results.push({
      testCaseId: `tier1-case-${i + 1}`,
      passed: !isFailed,
      score: isFailed ? 0.4 : 1,
      deterministicResults: isFailed ? [{ checkId: 'has_citation', passed: false }] : [],
      llmJudgeResults: [],
      retrievalQuality: { top3TrustedPresence: true, citationCoverage: 1, hasAbstention: false },
    });
  }
  return {
    summary: {
      total,
      passed: total - failed,
      failed,
      skipped: 0,
      averageScore: failed > 0 ? 0.85 : 0.97,
      retrievalQuality: {
        top3TrustedPresenceRate: 1,
        citationCoverageRate: 0.95,
        abstentionRate: 0.05,
      },
    },
    results,
  };
}

// --- deriveEvalStatus: the three distinguishable outcomes --------------------

test('clean report + clean exit => passed', () => {
  assert.equal(deriveEvalStatus('success', makeReport()), EVAL_STATUS.PASSED);
});

test('report with failing cases => failed (true evaluation failure)', () => {
  assert.equal(deriveEvalStatus('success', makeReport({ failed: 3 })), EVAL_STATUS.FAILED);
});

test('missing report => infra_error', () => {
  assert.equal(deriveEvalStatus('success', null), EVAL_STATUS.INFRA_ERROR);
});

test('clean report but eval process crashed => infra_error', () => {
  assert.equal(deriveEvalStatus('failure', makeReport()), EVAL_STATUS.INFRA_ERROR);
});

// --- Regression for run 28731647092: notification failure must not flip eval status

test('REGRESSION: eval passed + email delivery failed => CI still passes', () => {
  // Simulates run 28731647092's failure mode: SMTP auth error (535 BadCredentials)
  // on the send step, while the evaluation itself succeeded.
  const result = buildEvalResult({ report: makeReport(), evalStepOutcome: 'success', env: {} });
  const check = evaluateCheck(result); // notification outcome plays no part in the gate
  assert.equal(check.exitCode, 0);

  // The notification failure is surfaced as a degraded operation in the summary…
  const notifLine = buildNotificationSummary('failure', 'true');
  assert.match(notifLine, /degraded: notification failed/);
  // …and explicitly does not affect the evaluation status.
  assert.match(notifLine, /NOT affected/);
});

test('true evaluation failure fails CI even if notification succeeds', () => {
  const result = buildEvalResult({
    report: makeReport({ failed: 5 }),
    evalStepOutcome: 'success',
    env: {},
  });
  const check = evaluateCheck(result);
  assert.equal(check.exitCode, 1);
  assert.match(check.message, /Evaluation failed/);
  assert.match(check.message, /5 of 21/);
  // Message clarifies this is a quality failure, not plumbing.
  assert.match(check.message, /not a notification or reporting issue/);
});

test('infrastructure error fails CI with a distinct message', () => {
  const result = buildEvalResult({ report: null, evalStepOutcome: 'failure', env: {} });
  const check = evaluateCheck(result);
  assert.equal(check.exitCode, 1);
  assert.match(check.message, /infrastructure error/);
  assert.doesNotMatch(check.message, /Evaluation failed::/);
});

test('missing eval-result.json fails the check gate', () => {
  const check = evaluateCheck(null);
  assert.equal(check.exitCode, 1);
  assert.match(check.message, /missing or malformed/);
});

// --- eval-result.json artifact shape -----------------------------------------

test('buildEvalResult produces machine-readable payload with metrics', () => {
  const env = {
    GITHUB_REPOSITORY: 'gautamgauri/suchi-cancer-bot',
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_NUMBER: '7',
    GITHUB_SHA: 'abc',
    GITHUB_REF_NAME: 'main',
    GITHUB_WORKFLOW: 'Eval Tier1 - Retrieval Quality',
  };
  const result = buildEvalResult({
    report: makeReport({ failed: 2 }),
    evalStepOutcome: 'success',
    env,
    now: new Date('2026-07-05T00:00:00Z'),
  });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.generatedAt, '2026-07-05T00:00:00.000Z');
  assert.equal(result.run.repository, 'gautamgauri/suchi-cancer-bot');
  assert.equal(result.evaluation.status, EVAL_STATUS.FAILED);
  assert.equal(result.evaluation.total, 21);
  assert.equal(result.evaluation.failed, 2);
  assert.deepEqual(result.evaluation.failedCaseIds, ['tier1-case-1', 'tier1-case-2']);
  assert.equal(result.evaluation.retrievalQuality.citationCoverageRate, 0.95);
});

// --- Job summary --------------------------------------------------------------

test('summary shows eval result, metrics, and artifact status', () => {
  const result = buildEvalResult({ report: makeReport(), evalStepOutcome: 'success', env: {} });
  const md = buildSummaryMarkdown(result, 'success');
  assert.match(md, /\| Evaluation \| ✅ passed \|/);
  assert.match(md, /\| Report artifact \| ✅ uploaded \|/);
  assert.match(md, /Top-3 trusted source presence \| 100\.0%/);
  assert.match(md, /Citation coverage \| 95\.0%/);
});

test('summary flags artifact upload failure as reporting issue, not eval failure', () => {
  const result = buildEvalResult({ report: makeReport(), evalStepOutcome: 'success', env: {} });
  const md = buildSummaryMarkdown(result, 'failure');
  assert.match(md, /\| Evaluation \| ✅ passed \|/);
  assert.match(md, /upload failure \(reporting issue, not an eval failure\)/);
});

test('summary handles missing report', () => {
  const result = buildEvalResult({ report: null, evalStepOutcome: 'failure', env: {} });
  const md = buildSummaryMarkdown(result, 'skipped');
  assert.match(md, /infrastructure error/);
  assert.match(md, /No report file was produced/);
});

// --- Notification summary states ----------------------------------------------

test('notification summary: sent / skipped / degraded / not-needed', () => {
  assert.match(buildNotificationSummary('success', 'true'), /✅ email sent/);
  assert.match(buildNotificationSummary('skipped', 'true'), /⏭️ skipped/);
  assert.match(buildNotificationSummary('failure', 'true'), /⚠️ degraded/);
  assert.match(buildNotificationSummary('skipped', 'false'), /no notification required/);
});

// --- Email report (no recipient handling here — redaction by construction) -----

test('email report contains failure details but never recipient/secret fields', () => {
  const { subject, body, shouldSend } = buildEmailReport(makeReport({ failed: 7 }), {
    GITHUB_REPOSITORY: 'gautamgauri/suchi-cancer-bot',
    GITHUB_RUN_ID: '123',
  });
  assert.equal(shouldSend, true);
  assert.match(subject, /7 failures/);
  assert.match(body, /Failed Cases \(Top 5\)/);
  assert.match(body, /and 2 more failures/);
  assert.match(body, /actions\/runs\/123/);
  assert.doesNotMatch(body, /@dikshafoundation\.org/);
  assert.doesNotMatch(subject, /@/);
});

test('email report for all-pass run does not request sending', () => {
  const { subject, shouldSend } = buildEmailReport(makeReport(), {});
  assert.equal(shouldSend, false);
  assert.match(subject, /All 21 tests passed/);
});
