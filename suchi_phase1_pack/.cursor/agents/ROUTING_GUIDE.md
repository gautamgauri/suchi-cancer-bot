# Problem Routing Guide

## Simple Routing Structure

When `@tests-eval-author` identifies a problem, route directly to the appropriate specialized developer:

```
@tests-eval-author (identifies problem)
    ↓
    ├─→ Retrieval/RAG issue? → @retrieval-engineer
    ├─→ Safety/Evidence issue? → @safety-gatekeeper  
    ├─→ Infrastructure issue? → @devops-gcp-deployer
    └─→ Test coverage gap? → @tests-eval-author (stays)
```

## Routing Decision Tree

### 1. Retrieval/RAG Issues → `@retrieval-engineer`
**Symptoms:**
- Low citation coverage (< threshold)
- Poor query-to-chunk matching
- Reranking not working
- Citation integrity failures
- Query rewrite problems

**Handoff format:**
```
@retrieval-engineer: Eval case RQ-XX-YY failed with [metric]. 
Problem: [specific issue]. 
Expected: [what should happen]. 
Evidence: [eval output snippet].
```

### 2. Safety/Evidence Issues → `@safety-gatekeeper`
**Symptoms:**
- Unnecessary abstentions for informational queries
- Safety regressions
- Evidence gate too strict/loose
- Trusted source filtering issues

**Handoff format:**
```
@safety-gatekeeper: Eval case RQ-XX-YY shows [safety issue]. 
Problem: [specific issue]. 
Expected: [what should happen]. 
Evidence: [eval output, abstention rate, etc.].
```

### 3. Infrastructure/Deployment Issues → `@devops-gcp-deployer`
**Symptoms:**
- Build failures
- Deployment pipeline broken
- Cloud Run issues
- Environment variable problems

**Handoff format:**
```
@devops-gcp-deployer: [Issue type] in [component]. 
Problem: [specific issue]. 
Expected: [what should work]. 
Evidence: [build logs, error messages].
```

### 4. Test Coverage Gaps → `@tests-eval-author` (stays)
**Symptoms:**
- Missing test cases for known scenarios
- Flaky tests
- Schema validation errors
- Test infrastructure issues

**Action:** Add/update test cases directly.

## Verification Flow (After Developer Fix)

After a developer fixes an issue:

1. **Developer** implements fix
2. **@verifier** reviews code (read-only check)
3. **@tests-eval-author** re-runs eval to verify fix
4. **@conductor** runs integration checklist before merge

## Example Workflow

```
1. @tests-eval-author: "RQ-STOMACH-01 failing - citation coverage 40% (threshold 60%)"
   
2. @tests-eval-author: Routes to @retrieval-engineer with:
   - Problem: Low citation coverage for stomach cancer queries
   - Evidence: RQ-STOMACH-01 shows only 2/5 chunks have citations
   - Expected: 60%+ citation coverage
   
3. @retrieval-engineer: Fixes query rewrite, improves reranking
   
4. @verifier: Reviews changes, checks file boundaries
   
5. @tests-eval-author: Re-runs eval, confirms RQ-STOMACH-01 now passes
   
6. @conductor: Runs integration checklist, approves merge
```

## Principles

- **Direct routing**: No intermediate layers (PM/Architect)
- **File boundaries**: Each agent respects allowed/forbidden paths
- **Single PR-sized**: Each fix is small and focused
- **Clear handoffs**: Always include problem, evidence, expected behavior
