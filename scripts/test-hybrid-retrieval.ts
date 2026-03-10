import fs from 'fs';
import path from 'path';

interface Scenario {
  id: string;
  query: string;
  isMedicalQuery: boolean;
  mustContainTerms: string[];
  expectedSourceTypes: string[];
  minChunks: number;
  notes?: string;
}

interface ScenarioResult {
  id: string;
  query: string;
  passed: boolean;
  details: {
    chunkCount: number;
    chunkCountPass: boolean;
    termsFound: string[];
    termsFoundCount: number;
    termsPass: boolean;
    trustedSourcesInTop5: string[];
    trustedSourcePass: boolean;
  };
  errors?: string[];
}

async function testHybridRetrieval(apiBaseUrl: string, scenariosPath: string) {
  // Load scenarios
  const scenariosData: { scenarios: Scenario[] } = JSON.parse(
    fs.readFileSync(scenariosPath, 'utf-8')
  );

  const results: ScenarioResult[] = [];
  let passCount = 0;
  let failCount = 0;

  console.log(`\n🔍 Testing Hybrid Retrieval - ${scenariosData.scenarios.length} scenarios\n`);
  console.log(`API: ${apiBaseUrl}\n`);
  console.log('='.repeat(70));

  for (const scenario of scenariosData.scenarios) {
    console.log(`\nTesting: ${scenario.id}`);
    console.log(`  Query: "${scenario.query}"`);

    try {
      // Call chat API with debug mode to get retrievedChunks
      const response = await fetch(`${apiBaseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: `test-hybrid-${scenario.id}-${Date.now()}`,
          userText: scenario.query,
          channel: 'test',
          locale: 'en-US'
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Try to get chunks from debug response or citations
      const retrievedChunks = data.retrievedChunks || data.citations || [];
      
      if (retrievedChunks.length === 0) {
        console.warn('  ⚠️  No chunks returned - check if debug mode is enabled or API supports chunk inspection');
      }

      // Check 1: Minimum chunk count
      const chunkCountPass = retrievedChunks.length >= scenario.minChunks;

      // Check 2: Must-contain terms in top-3 chunks
      const top3Content = retrievedChunks
        .slice(0, 3)
        .map((c: any) => {
          // Handle different response formats
          const content = c.content || c.citationText || '';
          return content.toLowerCase();
        })
        .join(' ');

      const termsFound = scenario.mustContainTerms.filter(term =>
        top3Content.includes(term.toLowerCase())
      );
      const termsPass = termsFound.length >= 1; // At least 1 term in top-3

      // Check 3: For medical queries, trusted source in top-5
      let trustedSourcePass = true;
      let trustedSourcesInTop5: string[] = [];
      if (scenario.isMedicalQuery) {
        const top5Sources = retrievedChunks
          .slice(0, 5)
          .map((c: any) => c.sourceType)
          .filter((st: string) => st && scenario.expectedSourceTypes.includes(st));

        trustedSourcesInTop5 = [...new Set(top5Sources)]; // Deduplicate
        trustedSourcePass = trustedSourcesInTop5.length >= 1;
      }

      // Overall pass/fail
      const passed = chunkCountPass && termsPass && trustedSourcePass;

      results.push({
        id: scenario.id,
        query: scenario.query,
        passed,
        details: {
          chunkCount: retrievedChunks.length,
          chunkCountPass,
          termsFound,
          termsFoundCount: termsFound.length,
          termsPass,
          trustedSourcesInTop5,
          trustedSourcePass
        }
      });

      if (passed) {
        console.log(`  ✅ PASS`);
        passCount++;
      } else {
        console.log(`  ❌ FAIL`);
        console.log(`     Chunks: ${retrievedChunks.length}/${scenario.minChunks} ${chunkCountPass ? '✓' : '✗'}`);
        console.log(`     Terms: ${termsFound.length}/${scenario.mustContainTerms.length} (found: ${termsFound.join(', ') || 'none'}) ${termsPass ? '✓' : '✗'}`);
        if (scenario.isMedicalQuery) {
          console.log(`     Trusted sources: ${trustedSourcesInTop5.length > 0 ? trustedSourcesInTop5.join(', ') : 'none'} ${trustedSourcePass ? '✓' : '✗'}`);
        }
        failCount++;
      }
    } catch (error: any) {
      console.log(`  ❌ ERROR: ${error.message}`);
      results.push({
        id: scenario.id,
        query: scenario.query,
        passed: false,
        details: {
          chunkCount: 0,
          chunkCountPass: false,
          termsFound: [],
          termsFoundCount: 0,
          termsPass: false,
          trustedSourcesInTop5: [],
          trustedSourcePass: false
        },
        errors: [error.message]
      });
      failCount++;
    }
  }

  // Summary
  const totalCount = passCount + failCount;
  const passRate = totalCount > 0 ? (passCount / totalCount * 100).toFixed(1) : '0.0';

  console.log(`\n${'='.repeat(70)}`);
  console.log(`SUMMARY: ${passCount}/${totalCount} passed (${passRate}%)`);
  console.log(`${'='.repeat(70)}\n`);

  // Determine pass/fail based on 80% threshold
  const passThreshold = 80;
  const meetsThreshold = parseFloat(passRate) >= passThreshold;
  
  if (meetsThreshold) {
    console.log(`✅ Test suite PASSED (≥${passThreshold}% required)\n`);
  } else {
    console.log(`❌ Test suite FAILED (${passRate}% < ${passThreshold}% required)\n`);
  }

  // Write detailed report
  const reportsDir = path.join(process.cwd(), 'eval', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  const reportPath = path.join(reportsDir, 'hybrid-retrieval-test.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalScenarios: totalCount,
    passed: passCount,
    failed: failCount,
    passRate: parseFloat(passRate),
    meetsThreshold,
    threshold: passThreshold,
    results
  }, null, 2));

  console.log(`📄 Detailed report: ${reportPath}\n`);

  // Exit code: 0 for now (manual check), will be used for CI later
  process.exit(0);
}

// Main execution
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const scenariosPath = path.join(process.cwd(), 'eval', 'hybrid_retrieval_scenarios.json');

if (!fs.existsSync(scenariosPath)) {
  console.error(`❌ Scenarios file not found: ${scenariosPath}`);
  process.exit(1);
}

testHybridRetrieval(apiBaseUrl, scenariosPath).catch(error => {
  console.error('❌ Test script error:', error);
  process.exit(1);
});
