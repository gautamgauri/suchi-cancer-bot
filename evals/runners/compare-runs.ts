import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { program } from 'commander';
import { RunResult, CaseResult, CaseDelta, ComparisonResult, DatasetRow } from '../types';

// ── Types for enhanced comparison ──────────────────────────────────────────

interface GraderDelta {
  grader: string;
  baselineMean: number;
  candidateMean: number;
  delta: number;
  baselinePassRate: number;
  candidatePassRate: number;
}

interface GroupSummary {
  group: string;
  caseCount: number;
  baselineMean: number;
  candidateMean: number;
  delta: number;
  improved: number;
  regressed: number;
}

type RegressionSeverity = 'critical' | 'major' | 'minor';

interface EnhancedCaseDelta extends CaseDelta {
  severity?: RegressionSeverity;
  cancerType?: string;
  intent?: string;
  regressedGraders: string[];
  improvedGraders: string[];
}

interface EnhancedComparisonResult extends ComparisonResult {
  perGrader: GraderDelta[];
  byCancerType: GroupSummary[];
  byIntent: GroupSummary[];
  topRegressions: EnhancedCaseDelta[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function classifyRegressionSeverity(caseDelta: CaseDelta, baseCase: CaseResult, candidateCase: CaseResult): RegressionSeverity {
  // Critical: safety grader regressed
  const baseSafety = baseCase.grades.find((g) => g.grader === 'safety');
  const candSafety = candidateCase.grades.find((g) => g.grader === 'safety');
  if (baseSafety && candSafety && candSafety.score < baseSafety.score) return 'critical';

  // Major: >10% drop
  if (caseDelta.delta < -0.10) return 'major';

  // Minor: any other regression
  return 'minor';
}

function computePerGraderDeltas(baseline: RunResult, candidate: RunResult): GraderDelta[] {
  const allGraders = new Set([
    ...Object.keys(baseline.aggregate.perGrader),
    ...Object.keys(candidate.aggregate.perGrader),
  ]);

  return [...allGraders].map((grader) => {
    const b = baseline.aggregate.perGrader[grader] ?? { mean: 0, passRate: 0 };
    const c = candidate.aggregate.perGrader[grader] ?? { mean: 0, passRate: 0 };
    return {
      grader,
      baselineMean: b.mean,
      candidateMean: c.mean,
      delta: c.mean - b.mean,
      baselinePassRate: b.passRate,
      candidatePassRate: c.passRate,
    };
  }).sort((a, b) => a.delta - b.delta);
}

function groupBy(cases: EnhancedCaseDelta[], key: 'cancerType' | 'intent'): GroupSummary[] {
  const groups = new Map<string, EnhancedCaseDelta[]>();

  for (const c of cases) {
    const group = c[key] ?? 'unknown';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(c);
  }

  return [...groups.entries()]
    .map(([group, groupCases]) => ({
      group,
      caseCount: groupCases.length,
      baselineMean: groupCases.reduce((s, c) => s + c.baselineScore, 0) / groupCases.length,
      candidateMean: groupCases.reduce((s, c) => s + c.candidateScore, 0) / groupCases.length,
      delta: groupCases.reduce((s, c) => s + c.delta, 0) / groupCases.length,
      improved: groupCases.filter((c) => c.delta > 0.02).length,
      regressed: groupCases.filter((c) => c.delta < -0.02).length,
    }))
    .sort((a, b) => a.delta - b.delta);
}

// ── Formatting ──────────────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  return s.padEnd(n);
}

function sign(n: number): string {
  return n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatTextReport(result: EnhancedComparisonResult): string {
  const lines: string[] = [];

  lines.push(`\n  ═══ Enhanced Run Comparison ═══`);
  lines.push(`  Baseline:  ${result.baselineRunId} (overall: ${pct(result.summary.baselineOverall)})`);
  lines.push(`  Candidate: ${result.candidateRunId} (overall: ${pct(result.summary.candidateOverall)})`);
  lines.push(`  Net delta: ${sign(result.summary.netDelta)}\n`);
  lines.push(`  Improved:  ${result.summary.improved}`);
  lines.push(`  Regressed: ${result.summary.regressed}`);
  lines.push(`  Unchanged: ${result.summary.unchanged}\n`);

  // Per-grader breakdown
  lines.push(`  ── Per-Grader Breakdown ──`);
  lines.push(`  ${pad('Grader', 22)} ${pad('Baseline', 10)} ${pad('Candidate', 10)} ${pad('Delta', 10)} ${pad('Pass Rate', 12)}`);
  lines.push(`  ${'─'.repeat(64)}`);
  for (const g of result.perGrader) {
    const passChange = `${pct(g.baselinePassRate)} -> ${pct(g.candidatePassRate)}`;
    lines.push(`  ${pad(g.grader, 22)} ${pad(pct(g.baselineMean), 10)} ${pad(pct(g.candidateMean), 10)} ${pad(sign(g.delta), 10)} ${passChange}`);
  }
  lines.push('');

  // By cancer type
  if (result.byCancerType.length > 1) {
    lines.push(`  ── By Cancer Type ──`);
    lines.push(`  ${pad('Cancer Type', 22)} ${pad('Cases', 6)} ${pad('Baseline', 10)} ${pad('Candidate', 10)} ${pad('Delta', 10)} ${pad('+/-', 8)}`);
    lines.push(`  ${'─'.repeat(66)}`);
    for (const g of result.byCancerType) {
      lines.push(`  ${pad(g.group, 22)} ${pad(String(g.caseCount), 6)} ${pad(pct(g.baselineMean), 10)} ${pad(pct(g.candidateMean), 10)} ${pad(sign(g.delta), 10)} +${g.improved}/-${g.regressed}`);
    }
    lines.push('');
  }

  // By intent
  if (result.byIntent.length > 1) {
    lines.push(`  ── By Intent ──`);
    lines.push(`  ${pad('Intent', 28)} ${pad('Cases', 6)} ${pad('Baseline', 10)} ${pad('Candidate', 10)} ${pad('Delta', 10)} ${pad('+/-', 8)}`);
    lines.push(`  ${'─'.repeat(72)}`);
    for (const g of result.byIntent) {
      lines.push(`  ${pad(g.group, 28)} ${pad(String(g.caseCount), 6)} ${pad(pct(g.baselineMean), 10)} ${pad(pct(g.candidateMean), 10)} ${pad(sign(g.delta), 10)} +${g.improved}/-${g.regressed}`);
    }
    lines.push('');
  }

  // Top regressions
  const regressions = result.topRegressions.filter((c) => c.delta < -0.02);
  if (regressions.length > 0) {
    lines.push(`  ── Top Regressions ──`);
    for (const r of regressions) {
      const sev = r.severity ? `[${r.severity.toUpperCase()}]` : '';
      lines.push(`  ${sev} ${r.caseId}: ${r.baselineScore.toFixed(2)} -> ${r.candidateScore.toFixed(2)} (${sign(r.delta)})`);
      lines.push(`    Query: ${r.query.slice(0, 80)}${r.query.length > 80 ? '...' : ''}`);
      if (r.regressedGraders.length) lines.push(`    Regressed: ${r.regressedGraders.join(', ')}`);
    }
    lines.push('');
  }

  // Top improvements
  const improvementCases = result.cases.filter((c) => c.delta > 0.02).sort((a, b) => b.delta - a.delta);
  if (improvementCases.length > 0) {
    lines.push(`  ── Top Improvements ──`);
    for (const imp of improvementCases.slice(0, 10)) {
      lines.push(`  ${imp.caseId}: ${imp.baselineScore.toFixed(2)} -> ${imp.candidateScore.toFixed(2)} (+${imp.delta.toFixed(2)})`);
      for (const i of imp.improvements) lines.push(`    ↑ ${i}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  program
    .requiredOption('--baseline <path>', 'Baseline run JSON')
    .requiredOption('--candidate <path>', 'Candidate run JSON')
    .option('--dataset <path>', 'JSONL dataset for metadata enrichment (cancer_type, intent)')
    .option('--top-n <number>', 'Number of top regressions to show', '10')
    .option('--json', 'Output as JSON only')
    .option('--output <path>', 'Comparison output JSON')
    .parse();

  const opts = program.opts();
  const topN = parseInt(opts.topN, 10);
  const baseline: RunResult = JSON.parse(readFileSync(opts.baseline, 'utf-8'));
  const candidate: RunResult = JSON.parse(readFileSync(opts.candidate, 'utf-8'));

  // Optionally load dataset for metadata enrichment
  let datasetMap = new Map<string, DatasetRow>();
  if (opts.dataset) {
    const rows = readFileSync(opts.dataset, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as DatasetRow);
    for (const row of rows) datasetMap.set(row.id, row);
  }

  const baselineMap = new Map(baseline.cases.map((c) => [c.caseId, c]));
  const candidateMap = new Map(candidate.cases.map((c) => [c.caseId, c]));
  const allIds = new Set([...baselineMap.keys(), ...candidateMap.keys()]);

  const cases: EnhancedCaseDelta[] = [];

  for (const id of allIds) {
    const b = baselineMap.get(id);
    const c = candidateMap.get(id);
    if (!b || !c) continue;

    const delta = c.weightedScore - b.weightedScore;
    const regressions: string[] = [];
    const improvements: string[] = [];
    const regressedGraders: string[] = [];
    const improvedGraders: string[] = [];

    for (const bg of b.grades) {
      const cg = c.grades.find((g) => g.grader === bg.grader);
      if (!cg) continue;
      const diff = cg.score - bg.score;
      if (diff < -0.05) {
        regressions.push(`${bg.grader}: ${bg.score.toFixed(2)} -> ${cg.score.toFixed(2)}`);
        regressedGraders.push(bg.grader);
      }
      if (diff > 0.05) {
        improvements.push(`${bg.grader}: ${bg.score.toFixed(2)} -> ${cg.score.toFixed(2)}`);
        improvedGraders.push(bg.grader);
      }
    }

    const severity = delta < -0.02 ? classifyRegressionSeverity({ caseId: id, query: b.query, baselineScore: b.weightedScore, candidateScore: c.weightedScore, delta, regressions, improvements }, b, c) : undefined;
    const dsRow = datasetMap.get(id);

    cases.push({
      caseId: id,
      query: b.query,
      baselineScore: b.weightedScore,
      candidateScore: c.weightedScore,
      delta,
      regressions,
      improvements,
      severity,
      cancerType: dsRow?.cancer_type,
      intent: dsRow?.intent,
      regressedGraders,
      improvedGraders,
    });
  }

  cases.sort((a, b) => a.delta - b.delta);

  const improved = cases.filter((c) => c.delta > 0.02).length;
  const regressed = cases.filter((c) => c.delta < -0.02).length;
  const unchanged = cases.length - improved - regressed;

  const perGrader = computePerGraderDeltas(baseline, candidate);
  const byCancerType = groupBy(cases, 'cancerType');
  const byIntent = groupBy(cases, 'intent');

  // Top N worst regressions (by severity, then delta)
  const topRegressions = cases
    .filter((c) => c.delta < -0.02)
    .sort((a, b) => {
      const sevOrder = { critical: 0, major: 1, minor: 2, undefined: 3 };
      const sevA = sevOrder[a.severity ?? 'undefined'] ?? 3;
      const sevB = sevOrder[b.severity ?? 'undefined'] ?? 3;
      if (sevA !== sevB) return sevA - sevB;
      return a.delta - b.delta;
    })
    .slice(0, topN);

  const result: EnhancedComparisonResult = {
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    timestamp: new Date().toISOString(),
    cases,
    summary: {
      totalCases: cases.length,
      improved,
      regressed,
      unchanged,
      netDelta: cases.reduce((s, c) => s + c.delta, 0) / (cases.length || 1),
      baselineOverall: baseline.aggregate.overall,
      candidateOverall: candidate.aggregate.overall,
    },
    perGrader,
    byCancerType,
    byIntent,
    topRegressions,
  };

  // Output
  const outputPath = opts.output || 'artifacts/reports/comparison.json';
  mkdirSync(outputPath.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTextReport(result));
    console.log(`  Saved: ${outputPath}\n`);
  }
}

main();
