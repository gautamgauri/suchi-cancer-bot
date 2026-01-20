# Trust-First RAG v2 Phase 1 - Handoff Summary

**Date:** 2026-01-20  
**Orchestrator:** Main agent  
**Scope:** Single PR implementation of Trust-First RAG v2  

---

## Overview

Trust-First RAG v2 Phase 1 implements evidence-based medical responses with:
- **Hybrid retrieval** (pgvector + Postgres FTS)
- **Hard evidence gating** (no evidence → no LLM call)
- **Citation enforcement** (medical content requires 2-5 citations)
- **Idempotent ingestion** (skip unchanged documents)

---

## Workstreams & Agent Assignments

### 🔍 Workstream A: Retrieval & Hybrid Search
**Agent:** @retrieval-engineer  
**Handoff:** `2026-01-20-retrieval-engineer-trust-first-rag-v2.md`

**Key Deliverables:**
- Prisma migration for FTS (content_tsv column + GIN index)
- `fullTextSearchWithMetadata()` method
- `hybridSearchWithMetadata()` method (0.6 vec + 0.4 lex)
- Wire hybrid as primary path in `retrieveWithMetadata()`

**Acceptance:**
- Hybrid search returns results in <200ms
- Trust-aware reranking still applied
- Medical queries surface trusted sources in top-5

---

### 🛡️ Workstream B: Safety & Evidence Gate
**Agent:** @safety-gatekeeper  
**Handoff:** `2026-01-20-safety-gatekeeper-trust-first-rag-v2.md`

**Key Deliverables:**
- `docs/SUCHI_ANSWER_POLICY.md` policy document
- Refined `EvidenceGateResult` interface (status/approvedChunks/reasonCode)
- ChatService integration: no-evidence → no-LLM → SafeFallbackResponse
- Runtime citation enforcement: medical + <2 citations → discard

**Acceptance:**
- Zero LLM calls when evidence is insufficient
- All medical messages have 2-5 citations or are rejected
- SafeFallbackResponse is purely navigational (no medical advice)

---

### 📦 Workstream C: Ingestion & Hashing
**Agent:** @retrieval-engineer or @devops-gcp-deployer  
**Handoff:** `2026-01-20-retrieval-engineer-ingestion-hashing.md`

**Key Deliverables:**
- Content normalization before hashing
- SKIP logic for unchanged documents (matching versionHash)
- Dry run mode prints SKIP/NEW/UPDATE

**Acceptance:**
- Running ingestion twice on unchanged KB: all SKIPs, <10% time
- Dry run shows accurate preview without mutations

---

### ✅ Workstream D: Eval & CI Scaffolding
**Agent:** @tests-eval-author  
**Handoff:** `2026-01-20-tests-eval-author-trust-first-rag-v2.md`

**Key Deliverables:**
- `eval/hybrid_retrieval_scenarios.json` (10+ scenarios)
- `scripts/test-hybrid-retrieval.ts` test script
- NPM script: `npm run eval:hybrid-retrieval`

**Acceptance:**
- Test script validates: chunk count, mustContainTerms, trusted sources
- Pass rate ≥80% after hybrid search implementation
- JSON report generated in `eval/reports/`

---

## Coordination & Dependencies

### Critical Path
1. **@retrieval-engineer** (Workstream A) → Implements hybrid search FIRST
2. **@tests-eval-author** (Workstream D) → Creates eval scenarios in parallel
3. **@safety-gatekeeper** (Workstream B) → Integrates evidence gate after retrieval ready
4. **@retrieval-engineer** (Workstream C) → Implements ingestion improvements (can be parallel)

### Integration Points
- **A ↔ B:** Hybrid search must return `EvidenceChunk[]` compatible with evidence gate
- **A ↔ D:** Debug mode needed in ChatController to expose retrievedChunks for testing
- **B ↔ D:** Eval scenarios should test no-evidence flows and citation enforcement

---

## Single PR Definition of Done

✅ **Hybrid Retrieval:** Medical queries surface trusted sources in top-5 (80% eval pass rate)  
✅ **Evidence Gating:** No-evidence flows never call LLM, only return SafeFallbackResponse  
✅ **Citation Enforcement:** All medical messages have 2-5 citations with stable snippets  
✅ **Idempotent Ingestion:** Unchanged docs SKIPped, dry run accurate  
✅ **Documentation:** Policy doc created, handoffs complete  
✅ **Testing:** Hybrid retrieval eval script passing ≥80%

---

## Agent Handoff Instructions

### For Each Sub-Agent

1. **Read your handoff document** in `docs/ops/handoffs/`
2. **Review context section** to understand current state
3. **Execute tasks in order** (numbered in handoff)
4. **Test locally** using provided test commands
5. **Update TODO status** as you complete tasks
6. **Ask questions** via blockers section if stuck
7. **Coordinate with other agents** per integration points

### For Orchestrator

- Monitor progress across all workstreams
- Resolve blockers and questions
- Coordinate integration testing
- Prepare final PR with all changes
- Run full acceptance check before merge

---

## Files Modified (Summary)

### New Files
- `docs/SUCHI_ANSWER_POLICY.md`
- `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_fts_to_kbchunk/migration.sql`
- `eval/hybrid_retrieval_scenarios.json`
- `scripts/test-hybrid-retrieval.ts`

### Modified Files
- `apps/api/src/modules/rag/rag.service.ts` (3 new methods, 1 updated)
- `apps/api/src/modules/evidence/evidence-gate.service.ts` (interface + method update)
- `apps/api/src/modules/chat/chat.service.ts` (gate integration + citation enforcement)
- `apps/api/src/modules/abstention/abstention.service.ts` (new SafeFallbackResponse method)
- `apps/api/src/scripts/ingest-kb.ts` (normalization + SKIP logic)
- `package.json` (new npm script)

---

## Timeline Estimate

**Assuming parallel work:**
- Workstream A (Hybrid Search): ~4-6 hours
- Workstream B (Evidence Gate): ~3-4 hours
- Workstream C (Ingestion): ~2-3 hours
- Workstream D (Eval Scaffolding): ~2-3 hours
- **Integration & Testing:** ~2-3 hours
- **Total:** ~10-15 hours of focused work

**With sequential handoffs:** 15-20 hours

---

## Next Steps

1. **@retrieval-engineer:** Start with Workstream A (hybrid search)
2. **@tests-eval-author:** Start with Workstream D (eval scenarios) in parallel
3. Once hybrid search is ready, **@safety-gatekeeper** begins Workstream B
4. **@retrieval-engineer or @devops-gcp-deployer:** Workstream C (ingestion) anytime
5. **Orchestrator:** Monitor progress, coordinate integration, prepare final PR

---

## Questions or Issues?

Contact orchestrator or post in handoff document's "Questions / Blockers" section.
