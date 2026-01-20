---
name: Using Tests-Eval-Author Sub-Agent + Sanity Check
overview: Guide for using the tests-eval-author sub-agent in Cursor, plus implementing an automatic sanity check that verifies frontend, backend, RAG, and AI model on repo open.
todos: []
---

# Using the Tests-Eval-Author Sub-Agent + Sanity Check

## Part 1: Using the Tests-Eval-Author Sub-Agent

### How Cursor Sub-Agents Work

Cursor recognizes sub-agents defined in `.cursor/agents/*.md` files with YAML frontmatter. To invoke a sub-agent, use the `@agent-name` syntax in Cursor's chat.

### First Task: Expand Tier1 Test Coverage

**Current State:**
- `eval/cases/tier1/retrieval_quality.yaml` has 21 cases (15 original + 6 recently added)
- Coverage includes: symptoms, treatment, side effects, screening, diagnosis tests
- Known gaps: edge cases for query classification, multi-turn conversations, boundary conditions

**Recommended First Task:** Add 3-5 tier1 test cases targeting specific failure modes or edge cases

**Why this task:**
- Small, focused scope (matches sub-agent constraints)
- High signal (each case targets a known risk)
- Low risk (only touches eval files, no code changes)
- Validates the sub-agent workflow

### How to Invoke

In Cursor's chat, type:

```
@tests-eval-author: Add 3 tier1 test cases to eval/cases/tier1/retrieval_quality.yaml targeting these scenarios:
1. Query that should be classified as "symptoms" but might be misclassified (test the new symptoms QueryType)
2. Multi-turn conversation where user clarifies intent (tests conversation context handling)
3. Edge case: query with both symptom and treatment language (tests precedence logic)

Each case should:
- Follow the existing RETRIEVAL_QUALITY template
- Include expected_sources, query_type, and notes
- Target a specific failure mode
- Keep deterministic expectations

After adding cases, verify with: npm run eval:tier1 (should run without schema errors)
```

### Expected Deliverables

1. Updated `eval/cases/tier1/retrieval_quality.yaml` with 3-5 new cases
2. Brief rationale for each case (what failure mode it targets)
3. Verification that `npm run eval:tier1` runs without schema errors

---

## Part 2: Implementing Sanity Check

### Requirements

1. **Automatic on repo open**: Runs when you open the workspace in Cursor
2. **Manual command**: Available as `npm run sanity-check` (or similar)
3. **Minimal checks**: Health endpoints, build succeeds
4. **Functional checks**: Actual RAG retrieval and AI model calls

### Implementation Plan

#### Step 1: Create Sanity Check Script

**File:** `scripts/sanity-check.ts` (or `.js` for simpler execution)

**Checks to implement:**

1. **Frontend Check:**
   - Verify `apps/web` can build: `cd apps/web && npm run build`
   - Or check if dev server can start (faster check)

2. **Backend Check:**
   - Health endpoint: `GET /v1/health` (checks database connectivity)
   - If API not running, attempt to start it or report as skipped

3. **RAG Check:**
   - Test retrieval: Call `POST /v1/chat` with a simple query like "What is cancer?"
   - Verify response contains citations
   - Verify at least one trusted source in top-3 results

4. **AI Model Check:**
   - Test LLM call: Verify the response from step 3 actually came from LLM (not fallback)
   - Check for proper citation format in response
   - Verify response is not empty or error message

**Script structure:**
```typescript
// scripts/sanity-check.ts
async function checkFrontend() { /* build check */ }
async function checkBackend() { /* health endpoint */ }
async function checkRAG() { /* retrieval test */ }
async function checkAIModel() { /* LLM call test */ }

async function runSanityCheck() {
  const results = {
    frontend: await checkFrontend(),
    backend: await checkBackend(),
    rag: await checkRAG(),
    aiModel: await checkAIModel()
  };
  // Print results, exit with code 1 if any fail
}
```

#### Step 2: Add npm Scripts

**File:** `package.json` (root level, or create one)

```json
{
  "scripts": {
    "sanity-check": "ts-node scripts/sanity-check.ts",
    "sanity-check:quick": "ts-node scripts/sanity-check.ts --quick"
  }
}
```

#### Step 3: Configure Auto-Run on Workspace Open

**Option A: Cursor Workspace Task (Recommended)**

Create `.cursor/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Sanity Check",
      "type": "shell",
      "command": "npm run sanity-check",
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "always",
        "panel": "new"
      },
      "problemMatcher": []
    }
  ]
}
```

**Option B: VS Code Tasks (if Cursor supports it)**

Create `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Sanity Check on Open",
      "type": "shell",
      "command": "npm run sanity-check",
      "runOptions": {
        "runOn": "folderOpen"
      },
      "presentation": {
        "reveal": "always",
        "panel": "new"
      }
    }
  ]
}
```

**Option C: Post-Open Script Hook**

If Cursor doesn't support auto-run tasks, create a simple script that can be run manually:
- `scripts/post-open-check.ps1` (PowerShell) or `scripts/post-open-check.sh` (Bash)
- Document in README to run after opening repo

#### Step 4: Environment Detection

The sanity check should:
- Detect if API is already running (check `http://localhost:3001/v1/health`)
- If not running, optionally start it in background for checks
- Or gracefully skip backend/RAG/AI checks if API unavailable
- Always run frontend build check (doesn't require API)

#### Step 5: Output Format

**Success output:**
```
✅ Sanity Check Results:
✅ Frontend: Build successful
✅ Backend: Health check passed (database connected)
✅ RAG: Retrieval working (3 chunks retrieved, 2 trusted sources)
✅ AI Model: LLM responding correctly (citations present)
```

**Failure output:**
```
❌ Sanity Check Results:
✅ Frontend: Build successful
❌ Backend: Health check failed (database disconnected)
⏭️  RAG: Skipped (backend unavailable)
⏭️  AI Model: Skipped (backend unavailable)
```

### Files to Create/Modify

1. **New files:**
   - `scripts/sanity-check.ts` - Main sanity check script
   - `.cursor/tasks.json` or `.vscode/tasks.json` - Auto-run configuration
   - `package.json` (root) - npm scripts (if doesn't exist)

2. **Modified files:**
   - `README.md` - Document sanity check usage
   - Potentially `apps/api/package.json` - Add helper script for starting API

### Dependencies

The sanity check script will need:
- `axios` or `fetch` for HTTP requests
- `ts-node` for running TypeScript
- Access to environment variables (API URL, keys)

### Error Handling

- **Frontend build fails**: Report error, continue with other checks
- **Backend not running**: Skip backend/RAG/AI checks, report as "skipped"
- **RAG retrieval fails**: Report specific error (no chunks, no trusted sources, etc.)
- **AI model fails**: Report error (empty response, no citations, API error)

### Quick Mode

Add `--quick` flag that:
- Skips frontend build (just checks if files exist)
- Only checks backend health (skips RAG/AI functional tests)
- Faster for frequent checks

---

## Verification After Implementation

1. **Test manual command:** `npm run sanity-check` should run all checks
2. **Test auto-run:** Open workspace in Cursor, verify task runs automatically
3. **Test with API down:** Should gracefully skip backend checks
4. **Test with API up:** Should run all checks successfully

## Next Steps

1. Implement sanity check script
2. Configure auto-run task
3. Test both manual and automatic execution
4. Document in README
5. Then proceed with tests-eval-author sub-agent task
