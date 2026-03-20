# Review Copilot: Suchi vs Funding Bot — Platform Comparison

**Date:** 2026-03-20
**Purpose:** Identify what can be shared in a common platform vs what must remain domain-specific.

---

## What Is Common (Shared Platform Layer)

These components are domain-agnostic and should be built once, used by both copilots:

| Component | Description |
|-----------|-------------|
| **ReviewRecord data model** | Verdict enum (PASS/REPAIRED/BLOCKED/FLAGGED), patch tracking, latency, human review fields — identical structure |
| **Review pipeline orchestrator** | Ordered execution: hard checks → soft checks → ambiguous checks → write record |
| **Policy registry** | CRUD for review policies with enable/disable, thresholds, category tags |
| **Shadow mode infrastructure** | Run all checks, write records, take no action — same toggle pattern |
| **Human review queue** | Flagged items, reviewer assignment, approve/reject/modify workflow |
| **Metrics & dashboard** | Block rate, repair rate, flag rate, latency histograms, false positive tracking |
| **Deterministic patch engine** | Apply text patches: append text, reformat strings, truncate, insert headers |
| **LLM-assisted patch framework** | Constrained rewrite with before/after diff, semantic equivalence check |
| **API shape** | `/review/records`, `/review/queue`, `/review/metrics`, `/review/policies` |
| **Rollout phasing** | Shadow → hard blocks → auto-repair → full review (same progression) |
| **Audit trail** | Every response reviewed, every patch logged, every human decision recorded |

## What Must Remain Different (Domain-Specific Policy Layers)

### Failure Taxonomy

| Dimension | Suchi (Medical) | Funding Bot |
|-----------|-----------------|-------------|
| **Hard block triggers** | Ungrounded medical claim, diagnosis language, dosing, fabricated citation, emergency bypass | Budget hallucination, eligibility fabrication, deadline error, unauthorized commitment |
| **Soft repair types** | Missing disclaimer, citation format, readability grade, tone/empathy, section headers | Missing eligibility caveat, format compliance, jargon simplification, template adherence |
| **Ambiguous flags** | Over/under-escalation, source conflict, cultural sensitivity, implicit diagnosis | Ambiguous eligibility, conflicting program terms, multi-funder overlap, stale deadline |

### Citation & Grounding

| Aspect | Suchi | Funding Bot |
|--------|-------|-------------|
| **Citation format** | `[citation:docId:chunkId]` inline with medical claims | Source attribution to funding program documents |
| **Minimum citations** | 2+ for medical content; 0 for navigation/support | 1+ for eligibility claims; 0 for process guidance |
| **Grounding source** | Curated medical KB (NCI, WHO, NCG, SCCF) | Funding program databases, RFP documents, grant portals |
| **Recency requirements** | 12-60 months depending on topic type | Current funding cycle; stale = closed/past-deadline |

### Safety Severity

| Aspect | Suchi | Funding Bot |
|--------|-------|-------------|
| **Worst-case failure** | Patient acts on fabricated medical advice → health harm | Applicant misses deadline or submits to wrong program → wasted effort |
| **Regulatory exposure** | Medical device / health information regulations | None (informational service) |
| **Block threshold** | Extremely conservative — block if in doubt | Moderate — flag if in doubt, block only on clear errors |
| **Abstention policy** | Must abstain if evidence insufficient (SafeFallbackResponse) | Can provide general guidance even without specific program match |

### Tone & Empathy

| Aspect | Suchi | Funding Bot |
|--------|-------|-------------|
| **Emotional context** | Users may be frightened, grieving, in crisis | Users may be frustrated or confused, but rarely in crisis |
| **Empathy requirement** | Critical — empathy scoring in rubrics, tone repair | Important but lower stakes — professional tone sufficient |
| **Escalation pattern** | "Please seek medical attention immediately" | "Contact the program office for clarification" |

### Policy Documents

| Suchi | Funding Bot |
|-------|-------------|
| `SUCHI_SAFETY_CONTRACT.md` | Funding accuracy contract |
| `SUCHI_ANSWER_POLICY.md` | Eligibility answer policy |
| `safety.rules.ts` + `safety.templates.ts` | Funding rules + templates |
| Eval rubrics with medical-specific checks | Eval rubrics with funding-specific checks |

## Recommended Architecture

```
┌─────────────────────────────────────────────┐
│         Shared Review Copilot Platform       │
│                                              │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Pipeline      │  │ ReviewRecord Model  │  │
│  │ Orchestrator  │  │ + Prisma Schema     │  │
│  └──────────────┘  └─────────────────────┘  │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Policy        │  │ Patch Engine        │  │
│  │ Registry      │  │ (deterministic+LLM) │  │
│  └──────────────┘  └─────────────────────┘  │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Human Review  │  │ Metrics &           │  │
│  │ Queue         │  │ Dashboard           │  │
│  └──────────────┘  └─────────────────────┘  │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │ Shadow Mode   │  │ API Layer           │  │
│  │ Toggle        │  │ /review/*           │  │
│  └──────────────┘  └─────────────────────┘  │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌───────────────┐   ┌─────────────────┐
│ Suchi Policy   │   │ Funding Policy   │
│ Layer          │   │ Layer            │
│                │   │                  │
│ • Medical      │   │ • Eligibility    │
│   failure      │   │   failure        │
│   taxonomy     │   │   taxonomy       │
│ • Citation     │   │ • Source         │
│   validation   │   │   validation     │
│ • Safety       │   │ • Deadline       │
│   contract     │   │   checking       │
│ • Empathy      │   │ • Budget         │
│   scoring      │   │   verification   │
│ • Emergency    │   │ • Program        │
│   escalation   │   │   matching       │
└───────────────┘   └─────────────────┘
```

## Key Design Principle

**The platform asks "what kind of failure is this?" — the policy layer answers.**

Each domain registers its failure types, detection functions, and repair strategies with the shared platform. The platform handles orchestration, persistence, metrics, and human review workflow. This means:

- Adding a new domain (e.g., education bot, legal bot) = writing a new policy layer, not a new platform.
- Suchi's safety-critical policies can be as conservative as needed without affecting the funding bot's thresholds.
- Shared infrastructure investment benefits both products equally.

## Migration Path

1. **Now:** Build Suchi Review Copilot as a NestJS module within `apps/api/src/modules/review/`.
2. **Later:** Extract shared components into a `@sccf/review-copilot-core` package.
3. **Eventually:** Funding bot imports the shared package and registers its own policy layer.

This avoids premature abstraction while keeping the door open for platform convergence.
