import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { program } from 'commander';
import { SuchiApiClient } from './api-client';
import { runAllGraders } from '../graders';
import { DatasetRow, CaseResult, RunResult, AggregateScores, ScoringWeights } from '../types';

import runDefaults from '../configs/run-defaults.json';
import scoringWeights from '../configs/scoring.weights.json';

function loadDataset(path: string): DatasetRow[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function computeWeightedScore(grades: { grader: string; score: number }[], weights: ScoringWeights): number {
  let total = 0;
  let weightSum = 0;
  for (const g of grades) {
    const w = weights[g.grader] || 0;
    total += g.score * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

function computeAggregate(cases: CaseResult[]): AggregateScores {
  const n = cases.length;
  if (n === 0) return { overall: 0, passRate: 0, perGrader: {}, caseCount: 0 };

  const overall = cases.reduce((s, c) => s + c.weightedScore, 0) / n;
  const passRate = cases.filter((c) => c.passed).length / n;

  const graderNames = new Set<string>();
  for (const c of cases) for (const g of c.grades) graderNames.add(g.grader);

  const perGrader: Record<string, { mean: number; passRate: number }> = {};
  for (const name of graderNames) {
    const scores = cases.map((c) => c.grades.find((g) => g.grader === name)?.score ?? 0);
    const passes = cases.map((c) => c.grades.find((g) => g.grader === name)?.passed ?? false);
    perGrader[name] = {
      mean: scores.reduce((a, b) => a + b, 0) / n,
      passRate: passes.filter(Boolean).length / n,
    };
  }

  return { overall, passRate, perGrader, caseCount: n };
}

async function main() {
  program
    .option('--dataset <path>', 'JSONL dataset path', 'datasets/starter.jsonl')
    .option('--output <path>', 'Output run artifact path')
    .option('--api-url <url>', 'API base URL')
    .parse();

  const opts = program.opts();
  const apiUrl = opts.apiUrl || process.env.EVAL_API_BASE_URL || runDefaults.apiBaseUrl;
  const datasetPath = opts.dataset;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runId = `run-${timestamp}`;
  const outputPath = opts.output || `artifacts/runs/${runId}.json`;

  console.log(`\n  Suchi AutoEval Runner`);
  console.log(`  API:     ${apiUrl}`);
  console.log(`  Dataset: ${datasetPath}`);
  console.log(`  Run ID:  ${runId}\n`);

  const dataset = loadDataset(datasetPath);
  console.log(`  Loaded ${dataset.length} cases\n`);

  const client = new SuchiApiClient({
    baseUrl: apiUrl,
    timeoutMs: runDefaults.timeoutMs,
    retries: runDefaults.retries,
    channel: runDefaults.channel,
  });

  // Warm-up: create a throwaway session to wake any cold service
  process.stdout.write(`  Warming up API... `);
  try {
    const warmupSessionId = await client.createSession();
    console.log(`OK (session: ${warmupSessionId})`);
  } catch (err: any) {
    console.log(`FAILED (${err.message}) — continuing anyway`);
  }

  const weights = scoringWeights as ScoringWeights;
  const cases: CaseResult[] = [];

  for (let i = 0; i < dataset.length; i++) {
    const row = dataset[i];
    process.stdout.write(`  [${i + 1}/${dataset.length}] ${row.id} ... `);

    let trace;
    try {
      trace = await client.runCase(row.query);
    } catch (err: any) {
      trace = {
        sessionId: 'error',
        responseText: '',
        safety: { classification: 'error', actions: [] as string[] },
        citations: [],
        retrievedChunks: [],
        latencyMs: 0,
        error: err.message || 'Unknown error',
      };
    }
    const grades = runAllGraders(trace, row);
    const weightedScore = computeWeightedScore(grades, weights);
    const failureCodes = grades.filter((g) => !g.passed && g.reason).map((g) => g.reason!);
    const passed = grades.every((g) => g.passed);

    cases.push({ caseId: row.id, query: row.query, trace, grades, weightedScore, passed, failureCodes });

    const status = trace.error ? 'ERROR' : passed ? 'PASS' : 'FAIL';
    const failedGraders = grades.filter((g) => !g.passed).map((g) => g.grader);
    console.log(`${status} (${weightedScore.toFixed(2)})${failedGraders.length ? ` [${failedGraders.join(', ')}]` : ''}`);
  }

  const aggregate = computeAggregate(cases);

  const result: RunResult = {
    runId,
    timestamp: new Date().toISOString(),
    apiBaseUrl: apiUrl,
    datasetPath,
    cases,
    aggregate,
  };

  // Write artifact
  mkdirSync(outputPath.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n  Artifact saved: ${outputPath}`);

  // Print summary
  console.log(`\n  ═══ Summary ═══`);
  console.log(`  Cases:     ${aggregate.caseCount}`);
  console.log(`  Pass rate: ${(aggregate.passRate * 100).toFixed(1)}%`);
  console.log(`  Overall:   ${aggregate.overall.toFixed(3)}`);
  console.log(`\n  Per-grader:`);
  for (const [name, stats] of Object.entries(aggregate.perGrader)) {
    console.log(`    ${name.padEnd(20)} mean=${stats.mean.toFixed(3)}  pass=${(stats.passRate * 100).toFixed(1)}%`);
  }

  // Show failures
  const failures = cases.filter((c) => !c.passed);
  if (failures.length > 0) {
    console.log(`\n  ═══ Failures (${failures.length}) ═══`);
    for (const f of failures) {
      const failedGraders = f.grades.filter((g) => !g.passed).map((g) => `${g.grader}: ${g.details}`);
      console.log(`  ${f.caseId}: ${f.query}`);
      for (const fg of failedGraders) console.log(`    - ${fg}`);
    }
  }

  console.log('');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
