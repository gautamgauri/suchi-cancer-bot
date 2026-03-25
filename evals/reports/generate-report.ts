import { readFileSync, writeFileSync } from 'fs';
import { program } from 'commander';
import { RunResult, FailureCluster, ComparisonResult } from '../types';

function main() {
  program
    .requiredOption('--input <path>', 'Run result JSON')
    .option('--clusters <path>', 'Clusters JSON')
    .option('--comparison <path>', 'Comparison JSON')
    .option('--output <path>', 'Output markdown path')
    .parse();

  const opts = program.opts();
  const run: RunResult = JSON.parse(readFileSync(opts.input, 'utf-8'));
  const clusters: FailureCluster[] | null = opts.clusters
    ? JSON.parse(readFileSync(opts.clusters, 'utf-8'))
    : null;
  const comparison: ComparisonResult | null = opts.comparison
    ? JSON.parse(readFileSync(opts.comparison, 'utf-8'))
    : null;

  const lines: string[] = [];
  const ln = (s: string = '') => lines.push(s);

  ln(`# Suchi AutoEval Report`);
  ln();
  ln(`| Field | Value |`);
  ln(`|-------|-------|`);
  ln(`| Run ID | ${run.runId} |`);
  ln(`| Timestamp | ${run.timestamp} |`);
  ln(`| API URL | ${run.apiBaseUrl} |`);
  ln(`| Dataset | ${run.datasetPath} |`);
  ln(`| Cases | ${run.aggregate.caseCount} |`);
  ln(`| Pass rate | ${(run.aggregate.passRate * 100).toFixed(1)}% |`);
  ln(`| Overall score | ${run.aggregate.overall.toFixed(3)} |`);
  ln();

  // Per-grader table
  ln(`## Scores by Grader`);
  ln();
  ln(`| Grader | Mean | Pass Rate |`);
  ln(`|--------|-----:|----------:|`);
  for (const [name, stats] of Object.entries(run.aggregate.perGrader)) {
    ln(`| ${name} | ${stats.mean.toFixed(3)} | ${(stats.passRate * 100).toFixed(1)}% |`);
  }
  ln();

  // Failures
  const failures = run.cases.filter((c) => !c.passed);
  if (failures.length > 0) {
    ln(`## Failed Cases (${failures.length})`);
    ln();
    ln(`| Case | Query | Score | Failing Graders |`);
    ln(`|------|-------|------:|-----------------|`);
    for (const f of failures) {
      const failedGraders = f.grades.filter((g) => !g.passed).map((g) => g.grader).join(', ');
      const q = f.query.length > 50 ? f.query.slice(0, 47) + '...' : f.query;
      ln(`| ${f.caseId} | ${q} | ${f.weightedScore.toFixed(2)} | ${failedGraders} |`);
    }
    ln();
  }

  // Clusters
  if (clusters && clusters.length > 0) {
    ln(`## Failure Clusters`);
    ln();
    ln(`| Rank | Cluster | Count | Cases |`);
    ln(`|-----:|---------|------:|-------|`);
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      ln(`| ${i + 1} | ${cl.label} (${cl.code}) | ${cl.count} | ${cl.caseIds.join(', ')} |`);
    }
    ln();

    // Top cluster details
    ln(`### Top Cluster: ${clusters[0].label}`);
    ln();
    for (const r of clusters[0].sampleReasons) {
      ln(`- ${r}`);
    }
    ln();
  }

  // Comparison
  if (comparison) {
    ln(`## Comparison: Baseline vs Candidate`);
    ln();
    ln(`| Metric | Baseline | Candidate | Delta |`);
    ln(`|--------|--------:|---------:|------:|`);
    ln(`| Overall | ${comparison.summary.baselineOverall.toFixed(3)} | ${comparison.summary.candidateOverall.toFixed(3)} | ${comparison.summary.netDelta >= 0 ? '+' : ''}${comparison.summary.netDelta.toFixed(3)} |`);
    ln(`| Improved | | | ${comparison.summary.improved} cases |`);
    ln(`| Regressed | | | ${comparison.summary.regressed} cases |`);
    ln(`| Unchanged | | | ${comparison.summary.unchanged} cases |`);
    ln();

    const regressions = comparison.cases.filter((c) => c.delta < -0.02);
    if (regressions.length > 0) {
      ln(`### Regressions`);
      ln();
      for (const r of regressions) {
        ln(`- **${r.caseId}**: ${r.baselineScore.toFixed(2)} → ${r.candidateScore.toFixed(2)} (${r.delta.toFixed(2)})`);
        for (const reg of r.regressions) ln(`  - ${reg}`);
      }
      ln();
    }
  }

  // All cases detail
  ln(`## All Cases`);
  ln();
  ln(`| Case | Score | Pass | Safety | Citations | Direct | Support | Complete | Discl |`);
  ln(`|------|------:|:----:|:------:|:---------:|:------:|:-------:|:--------:|:-----:|`);
  for (const c of run.cases) {
    const g = (name: string) => {
      const grade = c.grades.find((gr) => gr.grader === name);
      return grade ? (grade.passed ? 'OK' : 'FAIL') : '-';
    };
    ln(`| ${c.caseId} | ${c.weightedScore.toFixed(2)} | ${c.passed ? 'PASS' : 'FAIL'} | ${g('safety')} | ${g('citations')} | ${g('directness')} | ${g('supported_answer')} | ${g('completeness')} | ${g('disclaimer')} |`);
  }
  ln();

  const outputPath = opts.output || opts.input.replace(/\.json$/, '-report.md');
  writeFileSync(outputPath, lines.join('\n'));
  console.log(`Report written to: ${outputPath}`);
}

main();
