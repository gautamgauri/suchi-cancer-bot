const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const reportPath = path.resolve(__dirname, 'reports/phase3-100case-batched.json');
const casesPath = path.resolve(__dirname, 'cases/tier1/common_cancers_20_mode_matrix.yaml');

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadYaml(p) {
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function inferStepAndStatus(errorText = '') {
  const msg = errorText || '';
  if (msg.includes('Failed to create session')) {
    return { step: 'session_create', status: '500' };
  }
  if (msg.includes('status code 504')) {
    return { step: 'chat_send', status: '504' };
  }
  if (msg.includes('timeout')) {
    return { step: 'chat_send', status: 'timeout' };
  }
  if (msg.trim().length > 0) {
    return { step: 'chat_send', status: 'error' };
  }
  return { step: 'none', status: 'ok' };
}

function toCsv(rows, headers) {
  const escaped = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const head = headers.join(',');
  const lines = rows.map(r => headers.map(h => escaped(r[h])).join(','));
  return [head, ...lines].join('\n');
}

const report = loadJson(reportPath);
const casesYaml = loadYaml(casesPath);
const caseIndex = new Map();
for (const c of casesYaml.cases || []) {
  caseIndex.set(c.id, { cancer: c.cancer, intent: c.intent });
}

const results = report.results || [];
const errorRows = [];

for (const r of results) {
  const errorText = r.error || '';
  if (!errorText) continue;
  const meta = caseIndex.get(r.testCaseId) || {};
  const { step, status } = inferStepAndStatus(errorText);
  errorRows.push({
    caseId: r.testCaseId,
    cancerType: meta.cancer || 'unknown',
    intent: meta.intent || 'unknown',
    step,
    status,
    durationMs: r.executionTimeMs,
    error: errorText
  });
}

const byStep = {};
for (const row of errorRows) {
  const key = `${row.step}:${row.status}`;
  byStep[key] = (byStep[key] || 0) + 1;
}

const byCancer = {};
for (const row of errorRows) {
  byCancer[row.cancerType] = (byCancer[row.cancerType] || 0) + 1;
}

const byIntent = {};
for (const row of errorRows) {
  byIntent[row.intent] = (byIntent[row.intent] || 0) + 1;
}

const outDir = path.resolve(__dirname);
const csvPath = path.resolve(outDir, 'phase3-100case-error-cohort.csv');
const mdPath = path.resolve(outDir, 'PHASE3_100CASE_ERROR_COHORT.md');

const headers = ['caseId', 'cancerType', 'intent', 'step', 'status', 'durationMs', 'error'];
fs.writeFileSync(csvPath, toCsv(errorRows, headers));

const mdLines = [];
mdLines.push('# Phase3 100-case Error Cohort');
mdLines.push('');
mdLines.push(`Report: \`${reportPath}\``);
mdLines.push(`Total results: ${results.length}`);
mdLines.push(`Total errors: ${errorRows.length}`);
mdLines.push('');
mdLines.push('## Errors by Step/Status');
Object.keys(byStep).sort().forEach(k => {
  mdLines.push(`- ${k}: ${byStep[k]}`);
});
mdLines.push('');
mdLines.push('## Errors by Cancer Type');
Object.keys(byCancer).sort().forEach(k => {
  mdLines.push(`- ${k}: ${byCancer[k]}`);
});
mdLines.push('');
mdLines.push('## Errors by Intent');
Object.keys(byIntent).sort().forEach(k => {
  mdLines.push(`- ${k}: ${byIntent[k]}`);
});
mdLines.push('');
mdLines.push('## Failed Cases (for re-run)');
mdLines.push('```');
errorRows.forEach(r => mdLines.push(r.caseId));
mdLines.push('```');
mdLines.push('');
mdLines.push('## CSV Output');
mdLines.push(`- ${csvPath}`);

fs.writeFileSync(mdPath, mdLines.join('\n'));

console.log(`Wrote ${errorRows.length} errors to:`);
console.log(`- ${csvPath}`);
console.log(`- ${mdPath}`);
