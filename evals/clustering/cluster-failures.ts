import { readFileSync, writeFileSync } from 'fs';
import { program } from 'commander';
import { RunResult, FailureCluster, FailureCode } from '../types';

const CLUSTER_LABELS: Record<FailureCode, string> = {
  DISC_MISSING: 'Missing disclaimer',
  CIT_ZERO: 'Zero citations',
  CIT_ORPHAN: 'Ungrounded citations',
  SAFETY_DIAG: 'Prohibited diagnosis language',
  SAFETY_DOSE: 'Dosage recommendation',
  SAFETY_PROG: 'Prognosis claim',
  DIRECT_ABSTAIN: 'False abstention',
  DIRECT_OVERASK: 'Unnecessary clarification',
  SUPPORT_UNGROUNDED: 'Answer not evidence-supported',
  COMPLETE_MISSING_SECTION: 'Missing expected sections',
};

function main() {
  program
    .option('--input <path>', 'Run result JSON', 'artifacts/runs/latest.json')
    .option('--output <path>', 'Cluster output JSON')
    .parse();

  const opts = program.opts();
  const run: RunResult = JSON.parse(readFileSync(opts.input, 'utf-8'));

  const clusterMap = new Map<FailureCode, { caseIds: string[]; reasons: string[] }>();

  for (const c of run.cases) {
    if (c.passed) continue;

    for (const g of c.grades) {
      if (g.passed || !g.reason) continue;
      const code = g.reason as FailureCode;
      if (!clusterMap.has(code)) {
        clusterMap.set(code, { caseIds: [], reasons: [] });
      }
      const entry = clusterMap.get(code)!;
      if (!entry.caseIds.includes(c.caseId)) {
        entry.caseIds.push(c.caseId);
      }
      if (entry.reasons.length < 3) {
        entry.reasons.push(`[${c.caseId}] ${g.details}`);
      }
    }
  }

  const clusters: FailureCluster[] = [];
  for (const [code, data] of clusterMap) {
    clusters.push({
      code,
      label: CLUSTER_LABELS[code] || code,
      count: data.caseIds.length,
      caseIds: data.caseIds,
      sampleReasons: data.reasons,
    });
  }

  clusters.sort((a, b) => b.count - a.count);

  const outputPath = opts.output || opts.input.replace(/\.json$/, '-clusters.json');
  writeFileSync(outputPath, JSON.stringify(clusters, null, 2));

  // Print summary
  console.log(`\n  ═══ Failure Clusters ═══`);
  console.log(`  Run: ${run.runId} (${run.cases.length} cases, ${run.cases.filter((c) => !c.passed).length} failures)\n`);

  if (clusters.length === 0) {
    console.log('  No failures found!\n');
    return;
  }

  for (const cl of clusters) {
    console.log(`  [${cl.count}] ${cl.label} (${cl.code})`);
    console.log(`      Cases: ${cl.caseIds.join(', ')}`);
    for (const r of cl.sampleReasons) {
      console.log(`      - ${r}`);
    }
    console.log('');
  }

  console.log(`  Saved: ${outputPath}\n`);
}

main();
