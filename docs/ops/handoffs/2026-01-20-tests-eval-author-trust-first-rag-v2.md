# Trust-First RAG v2 - Eval & CI Scaffolding Workstream

**Date:** 2026-01-20  
**Agent:** @tests-eval-author  
**Scope:** Phase 1 - Hybrid retrieval eval scenarios + test script  
**Priority:** HIGH - Quality assurance for retrieval improvements

---

## Objective

Create eval scenarios and test script to validate hybrid retrieval quality, ensuring:
1. Medical queries surface trusted sources in top-5
2. Query-relevant terms appear in top-3 chunks
3. Minimum 3 chunks returned for most queries

---

## Context

Current eval setup tests end-to-end chat responses. This Phase 1 adds **retrieval-only** testing to validate the new hybrid search (vector + FTS) before full chat integration.

---

## Tasks

### 1. Create Hybrid Retrieval Scenarios

**File:** `eval/hybrid_retrieval_scenarios.json` (new)

Structure:

```json
{
  "schemaVersion": "1.0",
  "description": "Test scenarios for hybrid retrieval (vector + FTS) quality",
  "scenarios": [
    {
      "id": "symptoms-lung-cancer",
      "query": "What are the symptoms of lung cancer?",
      "isMedicalQuery": true,
      "mustContainTerms": ["cough", "breath", "chest pain"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks", "03_who_public_health"],
      "minChunks": 3,
      "notes": "Should surface authoritative symptom lists"
    },
    {
      "id": "screening-mammogram",
      "query": "When should I get a mammogram?",
      "isMedicalQuery": true,
      "mustContainTerms": ["mammogram", "screening", "age"],
      "expectedSourceTypes": ["02_nci_core", "03_who_public_health"],
      "minChunks": 3,
      "notes": "Screening guidelines from trusted sources"
    },
    {
      "id": "side-effects-chemotherapy",
      "query": "What are common side effects of chemotherapy?",
      "isMedicalQuery": true,
      "mustContainTerms": ["nausea", "fatigue", "hair loss", "side effect"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "Should retrieve comprehensive side effect lists"
    },
    {
      "id": "treatment-options-breast",
      "query": "What are treatment options for breast cancer?",
      "isMedicalQuery": true,
      "mustContainTerms": ["surgery", "chemotherapy", "radiation"],
      "expectedSourceTypes": ["02_nci_core", "05_india_ncg"],
      "minChunks": 3,
      "notes": "Should cover multiple treatment modalities"
    },
    {
      "id": "report-interpretation-confusion",
      "query": "I don't understand my pathology report",
      "isMedicalQuery": false,
      "mustContainTerms": ["pathology", "report", "doctor"],
      "expectedSourceTypes": ["99_local_navigation", "01_suchi_oncotalks"],
      "minChunks": 2,
      "notes": "Navigation query, not diagnostic"
    },
    {
      "id": "diagnosis-process",
      "query": "How is cancer diagnosed?",
      "isMedicalQuery": true,
      "mustContainTerms": ["biopsy", "test", "diagnosis"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "General diagnostic process overview"
    },
    {
      "id": "symptom-vs-side-effect-confusion",
      "query": "Is nausea a symptom or side effect?",
      "isMedicalQuery": true,
      "mustContainTerms": ["nausea", "symptom", "side effect", "treatment"],
      "expectedSourceTypes": ["02_nci_core", "01_suchi_oncotalks"],
      "minChunks": 3,
      "notes": "Tests disambiguation between symptoms and side effects"
    },
    {
      "id": "drug-specific-query",
      "query": "What is Tamoxifen used for?",
      "isMedicalQuery": true,
      "mustContainTerms": ["tamoxifen", "breast", "hormone", "therapy"],
      "expectedSourceTypes": ["02_nci_core", "06_pmc_selective"],
      "minChunks": 2,
      "notes": "Drug-specific information"
    },
    {
      "id": "prevention-diet",
      "query": "Can diet prevent cancer?",
      "isMedicalQuery": true,
      "mustContainTerms": ["diet", "nutrition", "prevention", "risk"],
      "expectedSourceTypes": ["02_nci_core", "03_who_public_health"],
      "minChunks": 3,
      "notes": "Prevention-focused query"
    },
    {
      "id": "caregiver-support",
      "query": "How can I support someone with cancer?",
      "isMedicalQuery": false,
      "mustContainTerms": ["caregiver", "support", "help"],
      "expectedSourceTypes": ["01_suchi_oncotalks", "99_local_navigation"],
      "minChunks": 2,
      "notes": "Caregiver navigation, non-medical"
    }
  ]
}
```

**Scenario Design Goals:**
- Cover major query types: symptoms, screening, side effects, treatment, diagnosis
- Include confusion cases (symptom vs side effect, report interpretation)
- Mix medical (requires trusted sources) and non-medical (navigation) queries
- Test both broad and specific queries

### 2. Create Hybrid Retrieval Test Script

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
  const scenarios: { scenarios: Scenario[] } = JSON.parse(
    fs.readFileSync(scenariosPath, 'utf-8')
  );

  const results: ScenarioResult[] = [];
  let passCount = 0;
  let failCount = 0;

  console.log(`\n🔍 Testing Hybrid Retrieval - ${scenarios.scenarios.length} scenarios\n`);

  for (const scenario of scenarios.scenarios) {
    console.log(`Testing: ${scenario.id}`);
    console.log(`  Query: "${scenario.query}"`);

    try {
      // Call RAG API endpoint (adjust to your actual endpoint)
      // For now, using chat API and inspecting retrievedChunks in debug mode
      const response = await fetch(`${apiBaseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: `test-hybrid-${scenario.id}`,
          userText: scenario.query,
          channel: 'test',
          locale: 'en-US',
          debug: true // Enable debug mode to get chunk details
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      const retrievedChunks = data.retrievedChunks || [];

      // Check 1: Minimum chunk count
      const chunkCountPass = retrievedChunks.length >= scenario.minChunks;

      // Check 2: Must-contain terms in top-3 chunks
      const top3Content = retrievedChunks
        .slice(0, 3)
        .map((c: any) => c.content?.toLowerCase() || '')
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
          .filter((st: string) => scenario.expectedSourceTypes.includes(st));

        trustedSourcesInTop5 = top5Sources;
        trustedSourcePass = top5Sources.length >= 1;
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
        console.log(`     Terms: ${termsFound.length}/${scenario.mustContainTerms.length} ${termsPass ? '✓' : '✗'}`);
        if (scenario.isMedicalQuery) {
          console.log(`     Trusted: ${trustedSourcesInTop5.length > 0 ? trustedSourcesInTop5.join(', ') : 'none'} ${trustedSourcePass ? '✓' : '✗'}`);
        }
        failCount++;
      }
    } catch (error) {
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

    console.log('');
  }

  // Summary
  const totalCount = passCount + failCount;
  const passRate = totalCount > 0 ? (passCount / totalCount * 100).toFixed(1) : '0.0';

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${passCount}/${totalCount} passed (${passRate}%)`);
  console.log(`${'='.repeat(60)}\n`);

  // Write detailed report
  const reportPath = path.join(process.cwd(), 'eval', 'reports', 'hybrid-retrieval-test.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalScenarios: totalCount,
    passed: passCount,
    failed: failCount,
    passRate: parseFloat(passRate),
    results
  }, null, 2));

  console.log(`Detailed report: ${reportPath}\n`);

  // Exit code (for CI integration later)
  // For now, always exit 0 (manual check)
  process.exit(0);
}

// Main
const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
const scenariosPath = path.join(process.cwd(), 'eval', 'hybrid_retrieval_scenarios.json');

testHybridRetrieval(apiBaseUrl, scenariosPath).catch(error => {
  console.error('Test script error:', error);
  process.exit(1);
});
```

### 3. Add NPM Script

**File:** `package.json` (root)

Add script to run hybrid retrieval tests:

```json
{
  "scripts": {
    "eval:hybrid-retrieval": "tsx scripts/test-hybrid-retrieval.ts"
  }
}
```

### 4. Test Execution

```bash
# Ensure API is running
cd apps/api
npm run dev

# In another terminal, run hybrid retrieval tests
cd ../../
npm run eval:hybrid-retrieval

# Expected output:
#   🔍 Testing Hybrid Retrieval - 10 scenarios
#   
#   Testing: symptoms-lung-cancer
#     Query: "What are the symptoms of lung cancer?"
#     ✅ PASS
#   
#   Testing: screening-mammogram
#     Query: "When should I get a mammogram?"
#     ✅ PASS
#   
#   ...
#   
#   SUMMARY: 8/10 passed (80.0%)
```

---

## Acceptance Criteria

✅ `eval/hybrid_retrieval_scenarios.json` created with 10+ scenarios  
✅ Scenarios cover symptoms, screening, side effects, treatment, diagnosis  
✅ Scenarios include confusion cases and non-medical queries  
✅ `scripts/test-hybrid-retrieval.ts` calls API and validates:
  - `chunkCount >= minChunks`
  - At least 1 `mustContainTerm` in top-3 chunks
  - For medical queries: ≥1 trusted source in top-5 chunks  
✅ Script generates JSON report in `eval/reports/`  
✅ Pass rate ≥80% after hybrid search implementation  
✅ NPM script `npm run eval:hybrid-retrieval` works

---

## Files to Create

1. **NEW:** `eval/hybrid_retrieval_scenarios.json`
2. **NEW:** `scripts/test-hybrid-retrieval.ts`
3. **EDIT:** `package.json` (add npm script)

---

## Coordination Points

- **@retrieval-engineer:** Coordinate on debug mode implementation to expose `retrievedChunks` in API response
- **@safety-gatekeeper:** Ensure eval scenarios align with medical vs non-medical definitions

---

## Future CI Integration (Phase 2)

Currently, test script exits with code 0 (manual check). For Phase 2 CI:
- Change exit code to 1 if pass rate <80%
- Add to GitHub Actions workflow
- Gate deployments on eval pass

---

## Questions / Blockers

- **Debug mode available?** Need `retrievedChunks` in API response for testing
- **Scenario count?** Start with 10, expand to 20+ later?
- **Thresholds?** 80% pass rate acceptable for Phase 1?

---

## Notes

- Keep scenarios focused on retrieval quality (not full response quality)
- Test script should be fast (<2 minutes for 10 scenarios)
- Report format should be CI-friendly (JSON with structured results)
