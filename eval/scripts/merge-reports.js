const fs = require('fs');
const path = require('path');

const [inputDir, outputFile] = process.argv.slice(2);

if (!inputDir || !outputFile) {
  console.error('Usage: node scripts/merge-reports.js <inputDir> <outputFile>');
  process.exit(1);
}

const files = fs.readdirSync(inputDir)
  .filter(f => f.endsWith('.json'))
  .map(f => path.join(inputDir, f));

const allResults = [];
const allFailures = [];

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(data.results)) {
    allResults.push(...data.results);
  }
  if (Array.isArray(data.failures)) {
    allFailures.push(...data.failures);
  }
}

const merged = {
  runId: `run-${Date.now()}`,
  timestamp: new Date().toISOString(),
  config: {},
  summary: {
    total: allResults.length,
    passed: allResults.filter(r => r.passed).length,
    failed: allResults.filter(r => !r.passed).length,
    skipped: allResults.filter(r => r.error?.includes('skipped')).length,
    averageScore: (() => {
      const scores = allResults.filter(r => r.score !== undefined).map(r => r.score || 0);
      return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    })(),
    executionTimeMs: allResults.reduce((sum, r) => sum + (r.executionTimeMs || 0), 0),
  },
  results: allResults,
  failures: allFailures,
};

fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2));
console.log(`Merged ${files.length} reports -> ${outputFile}`);
