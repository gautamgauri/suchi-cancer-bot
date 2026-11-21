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

// --- Issue #110: judge transport failures are unscored, not quality failures --

/**
 * Report with `unscored` cases as the runner now writes them: the case is
 * neither passed nor failed, its judge checks carry `unscored: true`, and the
 * summary has a `judge` block on the availability axis.
 */
function makeUnscoredReport({ unscored = 3, failed = 0, total = 21, mixed = 0 } = {}) {
  const base = makeReport({ failed, total });
  const unscoredIds = [];
  const judgeTouchedIds = [];
  for (let i = 0; i < unscored; i += 1) {
    const idx = total - 1 - i; // take from the tail so failures stay at the head
    const r = base.results[idx];
    r.passed = false;
    r.unscored = true;
    r.unscoredReason = 'rate_limited (HTTP 429) x6';
    r.llmJudgeResults = [
      { checkId: 'rag_backed_content', passed: false, skipped: true, unscored: true, unscoredReason: 'rate_limited', error: 'rate_limited (HTTP 429): got status: 429' },
    ];
    unscoredIds.push(r.testCaseId);
    judgeTouchedIds.push(r.testCaseId);
  }
  // `mixed` cases failed on a rendered check AND lost another to the judge:
  // they belong in `failed`, but the judge still could not fully score them.
  for (let i = 0; i < mixed; i += 1) {
    const r = base.results[i];
    r.passed = false;
    r.unscored = false;
    r.llmJudgeResults = [
      { checkId: 'rag_backed_content', passed: false },
      { checkId: 'tone_supportive', passed: false, skipped: true, unscored: true, unscoredReason: 'rate_limited', error: 'rate_limited (HTTP 429): got status: 429' },
    ];
    judgeTouchedIds.push(r.testCaseId);
  }
  base.summary.passed = total - unscored - failed;
  base.summary.failed = failed;
  base.summary.unscored = unscored;
  base.summary.judge = {
    status: unscored + mixed === 0 ? 'active' : 'degraded',
    scoredChecks: mixed,
    unscoredChecks: unscored + mixed,
    unscoredCases: judgeTouchedIds.length,
    unscoredCaseIds: judgeTouchedIds,
    reasons: { 'rate_limited (HTTP 429)': unscored + mixed },
  };
  return base;
}

test('#110: unscored cases within tolerance keep CI green (they are not passes either)', () => {
  // 2 of 21 = 9.5% <= 10% tolerance
  const status = deriveEvalStatus('success', makeUnscoredReport({ unscored: 2 }));
  assert.equal(status, EVAL_STATUS.PASSED);
});

test('#110: unscored cases above tolerance => judge_unavailable, never failed', () => {
  const report = makeUnscoredReport({ unscored: 6 });
  assert.equal(deriveEvalStatus('success', report), EVAL_STATUS.JUDGE_UNAVAILABLE);
  assert.notEqual(deriveEvalStatus('success', report), EVAL_STATUS.FAILED);
});

test('#110: judge_unavailable outranks failed when the judge could not score the run', () => {
  const report = makeUnscoredReport({ unscored: 6, failed: 2 });
  assert.equal(deriveEvalStatus('success', report), EVAL_STATUS.JUDGE_UNAVAILABLE);
});

test('#110: tolerance is configurable via argument and EVAL_MAX_UNSCORED_RATIO', () => {
  const report = makeUnscoredReport({ unscored: 6 }); // 28.6%
  assert.equal(
    deriveEvalStatus('success', report, { maxUnscoredRatio: 0.5 }),
    EVAL_STATUS.PASSED
  );
  assert.equal(
    deriveEvalStatus('success', report, { env: { EVAL_MAX_UNSCORED_RATIO: '0.5' } }),
    EVAL_STATUS.PASSED
  );
  assert.equal(
    deriveEvalStatus('success', report, { maxUnscoredRatio: '0' }),
    EVAL_STATUS.JUDGE_UNAVAILABLE
  );
  // Garbage falls back to the default rather than disabling the gate.
  assert.equal(
    deriveEvalStatus('success', report, { maxUnscoredRatio: 'not-a-number', env: {} }),
    EVAL_STATUS.JUDGE_UNAVAILABLE
  );
});

test('#110: a case that failed on rendered checks is still a failure, even with an unscored sibling', () => {
  // 2 mixed cases (9.5% <= tolerance): the judge left a hole in each, but each
  // failed a check it DID render, so the run is a quality failure, not an outage.
  const report = makeUnscoredReport({ unscored: 0, failed: 2, mixed: 2 });
  assert.equal(deriveEvalStatus('success', report), EVAL_STATUS.FAILED);
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  assert.equal(result.evaluation.failed, 2);
  assert.equal(result.evaluation.unscored, 0);
  assert.equal(result.evaluation.failedCaseIds.length, 2);
  // ...and the availability axis still records that the judge was degraded.
  assert.equal(result.evaluation.judge.unscoredCases, 2);
});

test('#110: judge holes count toward the outage tolerance even on cases that also failed', () => {
  // 3 of 21 = 14.3% > 10%: the judge could not fully score enough of the run
  // for it to be a trustworthy quality signal, so the red says "judge", and the
  // annotation still names the genuine failures it did observe.
  const report = makeUnscoredReport({ unscored: 0, failed: 3, mixed: 3 });
  assert.equal(deriveEvalStatus('success', report), EVAL_STATUS.JUDGE_UNAVAILABLE);
  const check = evaluateCheck(buildEvalResult({ report, evalStepOutcome: 'success', env: {} }));
  assert.match(check.message, /3 case\(s\) did fail on checks that were scored/);
});

test('#110: eval-result.json separates unscored ids from failed ids', () => {
  const report = makeUnscoredReport({ unscored: 3, failed: 2 });
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  const e = result.evaluation;
  assert.equal(e.status, EVAL_STATUS.JUDGE_UNAVAILABLE);
  assert.equal(e.unscored, 3);
  assert.equal(e.unscoredCaseIds.length, 3);
  assert.equal(e.failedCaseIds.length, 2);
  for (const id of e.unscoredCaseIds) {
    assert.ok(!e.failedCaseIds.includes(id), `${id} must not be reported as a failure`);
  }
  assert.equal(e.judge.status, 'degraded');
  assert.equal(e.judge.maxUnscoredRatio, 0.1);
  assert.deepEqual(e.judge.reasons, { 'rate_limited (HTTP 429)': 3 });
});

test('#110: legacy pre-#110 reports (no unscored fields) still derive a status', () => {
  const report = makeReport({ failed: 1 });
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  assert.equal(result.evaluation.status, EVAL_STATUS.FAILED);
  assert.equal(result.evaluation.unscored, 0);
  assert.deepEqual(result.evaluation.unscoredCaseIds, []);
});

test('#110: evaluateCheck fails CI with a judge-unavailable reason, not an eval failure', () => {
  const report = makeUnscoredReport({ unscored: 6, failed: 1 });
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  const check = evaluateCheck(result);
  assert.equal(check.exitCode, 1);
  assert.match(check.message, /::error title=Judge unavailable::/);
  assert.match(check.message, /infrastructure failure, not a quality failure/);
  assert.match(check.message, /rate_limited \(HTTP 429\)=6/);
  assert.doesNotMatch(check.message, /::error title=Evaluation failed::/);
});

test('#110: a true quality failure still fails CI as an evaluation failure', () => {
  const report = makeUnscoredReport({ unscored: 1, failed: 4 });
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  const check = evaluateCheck(result);
  assert.equal(check.exitCode, 1);
  assert.match(check.message, /::error title=Evaluation failed::/);
  // The tolerated unscored case is reported as a warning, never as a failure.
  assert.match(check.message, /::warning title=Judge partially unavailable::/);
});

test('#110: tolerated unscored cases pass CI but emit a warning annotation', () => {
  const report = makeUnscoredReport({ unscored: 2 });
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  const check = evaluateCheck(result);
  assert.equal(check.exitCode, 0);
  assert.match(check.message, /::warning title=Judge partially unavailable::/);
  assert.match(check.message, /unscored, not passed/);
});

test('#110: job summary lists unscored cases and the judge status separately', () => {
  const report = makeUnscoredReport({ unscored: 3, failed: 2 });
  const result = buildEvalResult({ report, evalStepOutcome: 'success', env: {} });
  const md = buildSummaryMarkdown(result, 'success');
  assert.match(md, /judge unavailable/);
  assert.match(md, /\| Unscored \(judge unavailable\) \| 3 \|/);
  assert.match(md, /Unscored cases \(judge rendered no verdict — not quality failures\)/);
  assert.match(md, /Judge status: `degraded`/);
});

test('#110: email report separates unscored cases from failures and still notifies', () => {
  const report = makeUnscoredReport({ unscored: 3, failed: 0 });
  const { subject, body, shouldSend } = buildEmailReport(report, {
    GITHUB_REPOSITORY: 'gautamgauri/suchi-cancer-bot',
    GITHUB_RUN_ID: '123',
  });
  assert.equal(shouldSend, true);
  assert.match(subject, /judge unavailable — 3\/21 unscored, 0 failures/);
  assert.match(body, /Unscored Cases \(LLM judge unavailable — NOT quality failures\)/);
  assert.match(body, /\| Unscored \(judge unavailable\) \| 3 \|/);
  assert.doesNotMatch(body, /All tests passed/);
  assert.doesNotMatch(body, /@dikshafoundation\.org/);
});
