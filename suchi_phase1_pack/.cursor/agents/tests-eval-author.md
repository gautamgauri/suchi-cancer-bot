# Tests & Eval Author Agent Instructions

**Role:** Testing & Evaluation Infrastructure Specialist  
**Current Assignment:** Trust-First RAG v2 - Phase 1  
**Handoff Document:** `docs/ops/handoffs/2026-01-20-tests-eval-author-trust-first-rag-v2.md`

---

## Your Mission

Create evaluation scenarios and test infrastructure to validate hybrid retrieval quality, ensuring medical queries surface trusted sources and relevant content.

---

## Step-by-Step Instructions

### STEP 1: Read Your Handoff Document
```bash
# Open and read carefully
code docs/ops/handoffs/2026-01-20-tests-eval-author-trust-first-rag-v2.md
```

**Key sections to understand:**
- Context: Need for retrieval-only testing
- Tasks 1-4: Scenario creation and test script implementation
- Acceptance Criteria: 80% pass rate target

### STEP 2: Create Hybrid Retrieval Scenarios

**File:** `eval/hybrid_retrieval_scenarios.json` (new)

Create comprehensive test scenarios covering key query types:

```json
{
  "schemaVersion": "1.0",
  "description": "Test scenarios for hybrid retrieval (vector + FTS) quality validation",
  "scenarios": [
    {
      "id": "symptoms-lung-cancer",
      "query": "What are the symptoms of lung cancer?",
      "isMedicalQuery": true,
      "mustContainTerms": ["cough", "breath", "chest pain"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks", "03_who_public_health"],
      "minChunks": 3,
      "notes": "Should surface authoritative symptom lists from trusted sources"
    },
    {
      "id": "screening-mammogram",
      "query": "When should I get a mammogram?",
      "isMedicalQuery": true,
      "mustContainTerms": ["mammogram", "screening", "age"],
      "expectedSourceTypes": ["02_nci_core", "03_who_public_health"],
      "minChunks": 3,
      "notes": "Screening guidelines from national/international authorities"
    },
    {
      "id": "side-effects-chemotherapy",
      "query": "What are common side effects of chemotherapy?",
      "isMedicalQuery": true,
      "mustContainTerms": ["nausea", "fatigue", "hair loss", "side effect"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "Should retrieve comprehensive side effect information"
    },
    {
      "id": "treatment-options-breast",
      "query": "What are treatment options for breast cancer?",
      "isMedicalQuery": true,
      "mustContainTerms": ["surgery", "chemotherapy", "radiation"],
      "expectedSourceTypes": ["02_nci_core", "05_india_ncg"],
      "minChunks": 3,
      "notes": "Should cover multiple treatment modalities from guidelines"
    },
    {
      "id": "diagnosis-process-general",
      "query": "How is cancer diagnosed?",
      "isMedicalQuery": true,
      "mustContainTerms": ["biopsy", "test", "diagnosis"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "General diagnostic process overview"
    },
    {
      "id": "symptom-side-effect-confusion",
      "query": "Is nausea a symptom or side effect?",
      "isMedicalQuery": true,
      "mustContainTerms": ["nausea", "symptom", "side effect"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "Tests disambiguation - should find content about both"
    },
    {
      "id": "drug-specific-tamoxifen",
      "query": "What is Tamoxifen used for?",
      "isMedicalQuery": true,
      "mustContainTerms": ["tamoxifen", "breast", "hormone"],
      "expectedSourceTypes": ["02_nci_core", "06_pmc_selective"],
      "minChunks": 2,
      "notes": "Specific drug information from medical literature"
    },
    {
      "id": "prevention-diet",
      "query": "Can diet prevent cancer?",
      "isMedicalQuery": true,
      "mustContainTerms": ["diet", "nutrition", "prevention"],
      "expectedSourceTypes": ["02_nci_core", "03_who_public_health"],
      "minChunks": 3,
      "notes": "Prevention-focused query with lifestyle factors"
    },
    {
      "id": "report-interpretation-navigation",
      "query": "I don't understand my pathology report",
      "isMedicalQuery": false,
      "mustContainTerms": ["pathology", "report", "doctor"],
      "expectedSourceTypes": ["99_local_navigation", "01_suchi_oncotalks"],
      "minChunks": 2,
      "notes": "Navigation query - not diagnostic, helps patient communicate with doctor"
    },
    {
      "id": "caregiver-support",
      "query": "How can I support someone with cancer?",
      "isMedicalQuery": false,
      "mustContainTerms": ["caregiver", "support", "help"],
      "expectedSourceTypes": ["01_suchi_oncotalks", "99_local_navigation"],
      "minChunks": 2,
      "notes": "Caregiver support resources - non-medical content"
    },
    {
      "id": "staging-terminology",
      "query": "What does stage 3 cancer mean?",
      "isMedicalQuery": true,
      "mustContainTerms": ["stage", "staging", "spread"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "Staging system explanation - medical terminology"
    },
    {
      "id": "pain-management-side-effects",
      "query": "What are side effects of cancer pain medication?",
      "isMedicalQuery": true,
      "mustContainTerms": ["pain", "medication", "side effect"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "Pain management side effects - supportive care topic"
    }
  ]
}
```

Save this file at `eval/hybrid_retrieval_scenarios.json`.

### STEP 3: Create Test Script

**File:** `scripts/test-hybrid-retrieval.ts` (new)

```typescript
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
```

Save this file at `scripts/test-hybrid-retrieval.ts`.

### STEP 4: Add NPM Script

**File:** `package.json` (root - if not exists, check `eval/package.json`)

Add this script:

```json
{
  "scripts": {
    "eval:hybrid-retrieval": "tsx scripts/test-hybrid-retrieval.ts"
  }
}
```

If script goes in `eval/package.json`:

```json
{
  "scripts": {
    "test:hybrid": "tsx ../scripts/test-hybrid-retrieval.ts"
  }
}
```

### STEP 5: Test Your Evaluation Infrastructure

1. **Ensure API is running:**
```bash
cd apps/api
npm run dev
```

2. **Run evaluation (in separate terminal):**
```bash
# From workspace root
npm run eval:hybrid-retrieval

# OR from eval directory
cd eval
npm run test:hybrid
```

3. **Expected output:**
```
🔍 Testing Hybrid Retrieval - 12 scenarios

Testing: symptoms-lung-cancer
  Query: "What are the symptoms of lung cancer?"
  ✅ PASS

Testing: screening-mammogram
  Query: "When should I get a mammogram?"
  ✅ PASS

...

======================================================================
SUMMARY: 10/12 passed (83.3%)
======================================================================

✅ Test suite PASSED (≥80% required)

📄 Detailed report: eval/reports/hybrid-retrieval-test.json
```

4. **Check report file:**
```bash
cat eval/reports/hybrid-retrieval-test.json
```

### STEP 6: Coordinate with Retrieval Engineer

Once @retrieval-engineer completes hybrid search implementation:

1. **Request debug mode** (if not available):
   - Need `retrievedChunks` in API response for accurate testing
   - Coordinate format of chunk data (chunkId, content, sourceType, similarity)

2. **Run full test suite** and report results

3. **Iterate on scenarios** if pass rate is below 80%:
   - Check which scenarios are failing
   - Adjust `mustContainTerms` if too strict
   - Review `expectedSourceTypes` for accuracy
   - Add more scenarios for edge cases

---

## Success Checklist

Before marking your work complete, verify:

- [ ] `eval/hybrid_retrieval_scenarios.json` created with 12+ scenarios
- [ ] Scenarios cover: symptoms, screening, side effects, treatment, diagnosis, confusion cases
- [ ] `scripts/test-hybrid-retrieval.ts` implemented and runs successfully
- [ ] NPM script added for easy execution
- [ ] Test script validates all three criteria (chunk count, terms, trusted sources)
- [ ] JSON report generated in `eval/reports/`
- [ ] Pass rate ≥80% after hybrid search implementation
- [ ] Documentation clear for future maintainers

---

## If You Get Stuck

**Common Issues:**

1. **No retrievedChunks in API response:** Need debug mode or use citations as proxy
2. **All tests failing:** Check API is running and responding correctly
3. **Pass rate too low:** Review scenarios - may need to adjust expectations
4. **Script errors:** Check TypeScript setup and dependencies (tsx installed?)

**Get Help:**
- Review handoff document for more context
- Check existing eval infrastructure in `eval/` directory
- Ask orchestrator or @retrieval-engineer for coordination

---

## When Complete

1. Update TODO status
2. Share results with orchestrator
3. Coordinate with @retrieval-engineer if pass rate <80%
4. Document any scenario adjustments made

The eval infrastructure is now ready for continuous validation!
