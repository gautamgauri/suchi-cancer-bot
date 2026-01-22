const fs = require('fs');
const path = require('path');

const reportPath = path.resolve(__dirname, 'reports/phase3-100case-batched.json');
const outPath = path.resolve(__dirname, 'PHASE3_100CASE_SLO.md');

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const results = report.results || [];

const sessionCreateMs = [];
const chatSendMs = [];
const clientTimeouts = results.filter(r => r.error && r.error.includes('timeout')).length;
const session500s = results.filter(r => r.error && r.error.includes('Failed to create session')).length;
const send504s = results.filter(r => r.error && r.error.includes('status code 504')).length;

for (const r of results) {
  if (r.timingMs?.sessionCreateMs !== undefined) sessionCreateMs.push(r.timingMs.sessionCreateMs);
  if (r.timingMs?.chatSendMs !== undefined) chatSendMs.push(r.timingMs.chatSendMs);
}

const p95Session = percentile(sessionCreateMs, 95);
const p95Chat = percentile(chatSendMs, 95);
const p99Chat = percentile(chatSendMs, 99);

const lines = [];
lines.push('# Phase3 100-case SLO Check');
lines.push('');
lines.push(`Report: \`${reportPath}\``);
lines.push(`Total cases: ${results.length}`);
lines.push('');
lines.push('## Observed Reliability');
lines.push(`- Session create 5xx count: ${session500s}`);
lines.push(`- Chat send 504 count: ${send504s}`);
lines.push(`- Client-side timeouts: ${clientTimeouts}`);
lines.push('');
lines.push('## Latency (ms)');
lines.push(`- Session create p95: ${p95Session === null ? 'N/A' : p95Session}`);
lines.push(`- Chat send p95: ${p95Chat === null ? 'N/A' : p95Chat}`);
lines.push(`- Chat send p99: ${p99Chat === null ? 'N/A' : p99Chat}`);
lines.push('');
lines.push('## SLO Targets');
lines.push('- Session create: <0.5% 5xx, p95 <1000ms');
lines.push('- Chat send: <1% 5xx/504, p95 <10000ms, p99 <30000ms');
lines.push('- Client-side timeouts: 0');
lines.push('');
lines.push('## Notes');
lines.push('- If timing fields are N/A, re-run failed cases after deploying timing changes.');

fs.writeFileSync(outPath, lines.join('\n'));
console.log(`Wrote SLO report: ${outPath}`);
