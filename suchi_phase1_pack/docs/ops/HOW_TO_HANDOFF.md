# How to Handoff Work to Developers in Parallel

This guide shows how to assign work to specialized developers using Cursor's subagent system so they can work in parallel.

## Quick Start: Parallel Handoff

In Cursor chat, you can invoke multiple agents in parallel by mentioning them in separate messages or using the orchestrator pattern.

### Method 1: Direct Agent Invocation (Recommended)

Open Cursor chat and send these three messages **in parallel** (you can send them one after another, Cursor will handle them):

#### Message 1: Handoff to @retrieval-engineer
```
@retrieval-engineer: Please review and fix the citation coverage issues documented in docs/ops/handoffs/2026-01-17-retrieval-engineer-handoff.md

Problem: Citation coverage at 66.7%, below 80% target. Cases RQ-ORAL-01 and RQ-NHL-01 failing citation checks.

Stay within your allowed paths (apps/api/src/modules/rag/**, apps/api/src/modules/citations/**). After fix, verify with: cd eval && npm run eval:tier1
```

#### Message 2: Handoff to @safety-gatekeeper
```
@safety-gatekeeper: Please review and fix the response format issues documented in docs/ops/handoffs/2026-01-17-safety-gatekeeper-handoff.md

Problem: Missing disclaimers and required sections in responses. Cases RQ-BREAST-01, RQ-LUNG-01, RQ-COLORECTAL-01 failing.

Stay within your allowed paths (apps/api/src/modules/evidence/**, apps/api/src/modules/chat/**). After fix, verify with: cd eval && npm run eval:tier1
```

#### Message 3: Handoff to @devops-gcp-deployer
```
@devops-gcp-deployer: Please review and fix the timeout and LLM config issues documented in docs/ops/handoffs/2026-01-17-devops-handoff.md

Problem: 15/21 tests timing out, LLM judge not configured. This is blocking eval runs.

Stay within your allowed paths (cloudbuild*.yaml, docs/**, eval/** for config only). After fix, verify with: cd eval && npm run eval:tier1
```

### Method 2: Orchestrator Pattern (For Complex Workflows)

If you want to coordinate all three at once, use the orchestrator prompt first:

```
We are making a single PR-sized change. No refactors. Follow file boundaries. Use the handoff format. Treat safety behavior as invariant. DoD commands must be runnable as written. When problems are found, route directly to specialized developers (see ROUTING_GUIDE.md).

I need three parallel fixes:

1. @retrieval-engineer: Fix citation coverage (see docs/ops/handoffs/2026-01-17-retrieval-engineer-handoff.md)
2. @safety-gatekeeper: Fix response format (see docs/ops/handoffs/2026-01-17-safety-gatekeeper-handoff.md)
3. @devops-gcp-deployer: Fix timeout and LLM config (see docs/ops/handoffs/2026-01-17-devops-handoff.md)

Each developer should work independently within their file boundaries and provide a handoff summary when done.
```

## How Cursor Handles Parallel Work

Cursor's subagent system allows:
- **Parallel execution**: Multiple `@agent-name` mentions can work simultaneously
- **File boundary enforcement**: Each agent only edits files in their allowed paths
- **Independent work**: Agents don't interfere with each other's changes

## Handoff Format (What Each Developer Should Deliver)

After completing their work, each developer should provide:

1. **Files changed**: List of file paths modified
2. **What changed**: 3 bullet points max summarizing changes
3. **How to verify**: Exact commands run and expected outputs
4. **Risks/edge cases**: Top 3 things that could break

Example:
```
Files changed:
- apps/api/src/modules/rag/query-rewriter.ts
- apps/api/src/modules/citations/citation.service.ts

What changed:
- Improved query rewrite for oral cancer queries
- Enhanced citation generation logic

How to verify:
cd eval && npm run eval:tier1
Expected: RQ-ORAL-01 and RQ-NHL-01 pass citation checks, coverage ≥ 80%

Risks:
- None identified, changes are scoped to citation logic only
```

## Verification Workflow

After all three developers complete their fixes:

1. **@verifier**: Reviews all changes (read-only check)
   ```
   @verifier: Review the changes from @retrieval-engineer, @safety-gatekeeper, and @devops-gcp-deployer. 
   Check file boundaries, run typecheck, and flag any risks.
   ```

2. **@tests-eval-author**: Re-runs eval to verify fixes
   ```
   @tests-eval-author: Re-run tier1 eval to verify all fixes. 
   Compare results with baseline: eval/reports/tier1-report.json
   ```

3. **@conductor**: Runs integration checklist before merge
   ```
   @conductor: Run integration checklist for the three parallel fixes.
   Handoff file: docs/ops/handoffs/2026-01-17-routing-demo.md
   ```

## Tips for Parallel Work

1. **Clear boundaries**: Each handoff document specifies allowed/forbidden paths
2. **Independent changes**: Developers work on different file sets, no conflicts
3. **Sequential verification**: Run verification after all fixes are complete
4. **Communication**: Use handoff documents as the source of truth

## Troubleshooting

**Q: What if agents conflict?**
A: They shouldn't - each has different allowed paths. If they do, @verifier will catch it.

**Q: Can I assign work to agents one at a time?**
A: Yes, but parallel is faster. You can assign sequentially if you prefer.

**Q: How do I track progress?**
A: Each developer provides a handoff summary. Check the handoff documents for status.

**Q: What if a developer needs help?**
A: They can ask questions in chat, or route to another agent if the problem is outside their scope.

## Example: Complete Parallel Session

```
You: @retrieval-engineer: Fix citation issues (docs/ops/handoffs/2026-01-17-retrieval-engineer-handoff.md)
     @safety-gatekeeper: Fix response format (docs/ops/handoffs/2026-01-17-safety-gatekeeper-handoff.md)
     @devops-gcp-deployer: Fix timeout/config (docs/ops/handoffs/2026-01-17-devops-handoff.md)

[Agents work in parallel...]

@retrieval-engineer: [Provides handoff summary]
@safety-gatekeeper: [Provides handoff summary]
@devops-gcp-deployer: [Provides handoff summary]

You: @verifier: Review all three changes
@verifier: [Provides review]

You: @tests-eval-author: Re-run eval to verify fixes
@tests-eval-author: [Runs eval, reports results]

You: @conductor: Run integration checklist
@conductor: [Provides PASS/FAIL recommendation]
```
