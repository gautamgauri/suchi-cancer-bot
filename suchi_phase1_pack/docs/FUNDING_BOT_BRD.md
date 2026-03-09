# Funding Bot — Business Requirements Document (BRD)

**Version:** 2.2
**Last updated:** 2026-03-09
**Owner:** Gautam Gauri, Diksha Foundation
**Status:** Living document — updated as features ship

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision](#2-product-vision)
3. [System Architecture](#3-system-architecture)
4. [Module Inventory](#4-module-inventory)
5. [API Surface](#5-api-surface)
6. [Data Model](#6-data-model)
7. [Proposal Generation Pipeline](#7-proposal-generation-pipeline)
8. [Orchestrator Pipeline](#8-orchestrator-pipeline)
9. [Evidence Library & RAG](#9-evidence-library--rag)
10. [Framework Intelligence](#10-framework-intelligence)
11. [Donor Pipeline Management](#11-donor-pipeline-management)
12. [Funder Scraper](#12-funder-scraper)
13. [Application Assistant](#13-application-assistant)
14. [Draft Generation (Emails & Need Statements)](#14-draft-generation-emails--need-statements)
15. [Gift & Compliance Tracking](#15-gift--compliance-tracking)
16. [Governance & Approvals](#16-governance--approvals)
17. [Citation Policy](#17-citation-policy)
18. [Quality & Eval Harness](#18-quality--eval-harness)
19. [Web Frontend](#19-web-frontend)
20. [Infrastructure & Deployment](#20-infrastructure--deployment)
21. [Known Gaps & Improvement Plan](#21-known-gaps--improvement-plan)
22. [Non-Goals](#22-non-goals)
23. [Glossary](#23-glossary)
24. [RAG Enhancement Roadmap — Suchi Cancer Bot Learnings](#24-rag-enhancement-roadmap--suchi-cancer-bot-learnings)
25. [Fellowship Pipeline & Voice Calibration](#25-fellowship-pipeline--voice-calibration)
26. [Email Pipeline](#26-email-pipeline)
27. [SCCF Document Indexer](#27-sccf-document-indexer)

**Annexures**

- [Annexure A — Reusable Code & Patterns from Suchi Cancer Bot](#annexure-a--reusable-code--patterns-from-suchi-cancer-bot)
- [Annexure B — Eval Framework Cross-Pollination](#annexure-b--eval-framework-cross-pollination)

---

## 1. Executive Summary

The Funding Bot is an AI-powered fundraising assistant built for Diksha Foundation, an NGO operating education and youth development programs across Bihar, India. It automates and augments the end-to-end fundraising lifecycle: discovering funding opportunities, assessing fit, generating grant proposals, managing the donor pipeline, drafting donor communications, tracking gifts/compliance, and filling out fellowship/grant applications.

The system is built as a **NestJS API** (`funding-api`) backed by **PostgreSQL + pgvector**, with a **React web frontend** (`funding-web`). It uses LLMs (Deepseek for CI eval, Gemini 2.0 Flash for production) for generation and Google Gemini for embeddings. It integrates with Gmail, Google Drive, Google Sheets, and Slack.

---

## 2. Product Vision

> "The bot should behave like Gautam on a deadline — disciplined, evidence-aware, Bihar-realistic, and allergic to budgets that look like they were guessed in an elevator."

### Core Principles

1. **No bullshit citations** — never attach citations that aren't supported by retrieved evidence
2. **Bihar realism** — every proposal, budget, and program design must survive contact with Bihar's operational constraints
3. **Earn the right to write** — the bot must research (fit score, evidence retrieval, Gmail memory, budget sanity) before it drafts
4. **Human-in-the-loop** — all external-facing outputs (emails, proposals, submissions) require explicit approval before delivery
5. **Evidence-grounded** — use the organization's own evidence library (Google Drive documents) as the primary knowledge base, augmented by web search

### Target Users

- **Gautam Gauri** (Executive Director) — primary user; reviews proposals, approves drafts, manages pipeline
- **Diksha staff** — view pipeline, log activities
- **Coding agents** — consume API endpoints programmatically for automation

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        funding-web (React)                       │
│  Pipeline board │ Draft workspace │ Framework browser │ Settings │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP (axios)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    funding-api (NestJS)                           │
│  /v1 prefix                                                      │
│  ┌──────────────┬──────────────┬───────────────┬──────────────┐  │
│  │ Orchestrator │  Proposals   │  Opportunities │  Pipeline    │  │
│  │              │  ┌────────┐  │  ┌──────────┐  │  ┌────────┐ │  │
│  │  fit scoring │  │planner │  │  │  intake   │  │  │ CRUD   │ │  │
│  │  gmail mem.  │  │writer  │  │  │  fit-score│  │  │ stages │ │  │
│  │  budget env. │  │QA rev. │  │  │  from-email│ │  │ lanes  │ │  │
│  │  web evid.   │  │export  │  │  └──────────┘  │  └────────┘ │  │
│  └──────────────┴──────────────┴───────────────┴──────────────┘  │
│  ┌──────────────┬──────────────┬───────────────┬──────────────┐  │
│  │  Framework   │  Evidence    │  Draft Gen.   │  Applications│  │
│  │  caps/MI     │  ingest/RAG  │  emails       │  fellowship  │  │
│  │  method cards│  chunk/embed │  need stmts   │  voice calib │  │
│  │  MEL gen.    │  retrieve    │  email pipe.  │  extract Q   │  │
│  │  consistency │  reranking   │  SCCF ingest  │  draft/revise│  │
│  └──────────────┴──────────────┴───────────────┴──────────────┘  │
│  ┌──────────────┬──────────────┬───────────────┬──────────────┐  │
│  │  Gifts       │  Funder Scr. │  Reports      │  Admin       │  │
│  │  10BD/CSR    │  TFIx/BDC    │  digest       │  audit trail │  │
│  │  reconcile   │  scheduled   │  CSR pack     │  sheets exp. │  │
│  │              │              │  meeting prep │              │  │
│  └──────────────┴──────────────┴───────────────┴──────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────────┐
              ▼             ▼                 ▼
        PostgreSQL     Google APIs        LLM APIs
        + pgvector     Drive/Gmail/       Gemini/Deepseek
                       Sheets/CSE         (OpenAI-compat)
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| API | NestJS (TypeScript), Node 20 |
| Database | PostgreSQL with pgvector extension |
| ORM | Prisma |
| Frontend | React + Vite, Axios, i18n (English + Hindi) |
| LLM (production) | Gemini 2.0 Flash via OpenAI-compatible API |
| LLM (CI eval) | Deepseek Chat |
| Embeddings (ingest) | Google `gemini-embedding-001` via direct REST (`v1beta/batchEmbedContents`), `outputDimensionality: 768` |
| Embeddings (query) | Google `gemini-embedding-001` via OpenAI-compatible endpoint (`v1beta/openai/embeddings`), `dimensions: 768` |
| Web Search | Gemini Grounding + Google Custom Search Engine |
| Email | Gmail API (read-only for memory; send via notifications) |
| Storage | Google Drive (evidence documents, proposal artifacts) |
| Sync | Google Sheets (pipeline export) |
| Chat | Slack (commands, notifications, approvals) |
| CI/CD | GitHub Actions (eval), Google Cloud Build (deploy) |
| Hosting | Google Cloud Run |
| Container Registry | Artifact Registry (`suchi-images`) |

---

## 4. Module Inventory

The `funding-api` is organized into these NestJS modules:

| Module | Path | Purpose |
|--------|------|---------|
| **orchestrator** | `modules/orchestrator` | End-to-end pipeline conductor: fit → gmail → budget → web evidence → proposal |
| **proposal** | `modules/proposal` | Proposal generation: planning, section writing, QA review, citation repair, export |
| **opportunity** | `modules/opportunity` | Opportunity CRUD, intake from email, fit scoring |
| **pipeline** | `modules/pipeline` | Donor pipeline management: entries, stages, lanes, activities, next-best-actions |
| **framework** | `modules/framework` | Capabilities (C1–C10), MI modalities (MI1–MI8), method/pattern/comparable cards, MEL generation, program design, consistency checking |
| **evidence_ingest** | `modules/evidence_ingest` | Document ingestion pipeline: inventory → download → extract → normalize → quality scoring → chunking → embedding → retrieval |
| **draft** | `modules/draft` | Draft generation: need statements, emails, with evidence grounding |
| **application** | `modules/application` | Opportunity Application Assistant: intake → triage → extract questions → draft answers → revise → approve → browser prefill → submit |
| **donor** | `modules/donor` | Donor profile generation from web data |
| **gift** | `modules/gift` | Gift/donation tracking, 10BD compliance, FY reporting, bank reconciliation |
| **funder_scraper** | `modules/funder_scraper` | Automated funder discovery from TFIx/BDC network orgs |
| **approvals** | `modules/approvals` | Artifact versioning and approval workflow |
| **reports** | `modules/reports` | Digest, CSR pack, stalled prospects, meeting prep, reconciliation metrics |
| **notifications** | `modules/notifications` | Email notifications, Slack delivery, governance delivery guard |
| **admin** | `modules/admin` | Audit trail query, pipeline-to-sheets export |
| **gmail** | `modules/gmail` | Gmail API integration (read-only) |
| **google_search** | `modules/google_search` | Google Custom Search + Gemini grounding |
| **sheets** | `modules/sheets` | Google Sheets read/write |
| **core_ai** | `modules/core_ai` | Shared LLM service, citation integrity checking |
| **prisma** | `modules/prisma` | Database client |
| **health** | `modules/health` | Health + readiness checks |
| **source_registry** | `modules/source_registry` | Source document metadata + snapshot URLs for citation traceability |
| **activity_registry** | `modules/activity_registry` | Program activities registry: activities, instances (fortnightly reports), plans, context builder |
| **fellowship** | `modules/fellowship` | Fellowship-specific proposal pipeline: personal voice, first-person drafting, section archetypes, voice calibration, condensation |
| **email_pipeline** | `modules/email-pipeline` | Inbound email processing: Gmail polling, LLM-based intent classification, auto-routing to proposal or fellowship pipeline, draft delivery |
| **sccf_ingest** | `modules/sccf-ingest` | SCCF document indexer: Google Drive + Gmail ingestion for Suchitra Cancer Care Foundation documents into evidence library |

---

## 5. API Surface

All endpoints are prefixed with `/v1/`.

### 5.1 Orchestrator

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/orchestrator/run` | Full pipeline: fit → gmail → budget → web evidence → proposal generation |
| POST | `/orchestrator/assess` | Pre-drafting intelligence only (no proposal generation) |

**Run options:** `skipGmail`, `skipBudget`, `skipWebEvidence`, `forceGenerate`, `proposalOptions` (focusGeography, targetGroup, budgetCeiling, dontMention, sectionOnly, skipFramework)

### 5.2 Proposals

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/proposals/generate` | Generate full proposal from opportunity |
| POST | `/proposals/:runId/sections/:sectionName/regenerate` | Regenerate a single section |
| GET | `/proposals/:runId` | Get proposal run status |
| GET | `/proposals/:runId/gaps` | Get missing inputs/gaps |
| POST | `/proposals/:runId/export` | Export proposal artifacts |

### 5.3 Opportunities

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/opportunities` | List opportunities (filter by status, paginated) |
| GET | `/opportunities/:id` | Get by DB UUID |
| GET | `/opportunities/by-opportunity-id/:opportunityId` | Get by opportunity ID (e.g., `RF-ESA-2026-27-001`) |
| GET | `/opportunities/by-opportunity-id/:opportunityId/fit-score` | Get/compute fit score |
| GET | `/opportunities/:id/fit-score` | Get/compute fit score by DB UUID |
| POST | `/opportunities` | Create opportunity |
| POST | `/opportunities/ingest-from-email` | Ingest from Gmail message ID |
| PATCH | `/opportunities/:id` | Update opportunity |

### 5.4 Pipeline

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/pipeline` | List all pipeline entries |
| GET | `/pipeline/:id` | Get single entry |
| GET | `/pipeline/:id/activities` | Get activities for entry |
| GET | `/pipeline/:id/next-best-actions` | Get AI-suggested next actions |
| POST | `/pipeline` | Create entry |
| POST | `/pipeline/set-lane` | Set compliance lane by org name or ID |
| POST | `/pipeline/activity` | Log activity (call, email, meeting, note) |
| PATCH | `/pipeline/:id` | Update entry |
| PATCH | `/pipeline/:id/lane` | Set lane by ID |

### 5.5 Framework

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/framework/capabilities` | List all 10 capabilities |
| GET | `/framework/mi-modalities` | List all 8 MI modalities |
| GET/POST/PATCH | `/framework/method-cards[/:id]` | CRUD for method cards |
| GET/POST/PATCH | `/framework/pattern-cards[/:id]` | CRUD for pattern cards |
| GET/POST/PATCH | `/framework/comparable-cases[/:id]` | CRUD for comparable cases |
| POST | `/framework/tag-project/:projectId` | Tag project with capabilities |
| GET | `/framework/project-tags/:projectId` | Get project capability tags |
| GET | `/framework/recommend/methods` | Recommend methods by age/setting/capabilities |
| GET | `/framework/recommend/patterns` | Recommend patterns |
| POST | `/framework/retrieve` | Multi-type card retrieval |
| POST | `/framework/ingest/url` | Ingest card from URL |
| POST | `/framework/generate/mel-pack` | Generate MEL indicators pack |
| POST | `/framework/generate/program-design` | Generate program design |
| POST | `/framework/generate/comparables-paragraph` | Generate comparables paragraph |
| POST | `/framework/check/consistency` | Consistency check (quality gate) |

### 5.6 Evidence Ingest

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/evidence-ingest/inventory` | Scan Google Drive for new documents |
| POST | `/evidence-ingest/download` | Download pending documents |
| POST | `/evidence-ingest/extract` | Extract text from Google Docs + PDFs |
| POST | `/evidence-ingest/normalize` | Normalize extracted text |
| POST | `/evidence-ingest/pipeline` | Run Phase 1 pipeline (dedup, doc-type, quality, PII) |
| POST | `/evidence-ingest/chunk` | Chunk eligible documents |
| POST | `/evidence-ingest/embed` | Embed pending chunks |
| POST | `/evidence-ingest/retrieve` | Semantic retrieval (hybrid mode) |
| POST | `/evidence-ingest/eval` | Run retrieval eval |
| GET | `/evidence-ingest/report` | Phase 1 ingestion report |
| GET | `/evidence-ingest/review-queue` | Review queue for human QA |
| PATCH | `/evidence-ingest/review-queue/:documentId` | Update review status |

### 5.7 Applications (Opportunity Application Assistant)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/applications` | List all applications |
| GET | `/applications/profile` | Get applicant profile |
| POST | `/applications/ingest` | Ingest opportunity from URL |
| POST | `/applications/slack` | Handle Slack commands |
| GET | `/applications/:id/status` | Get application status |
| POST | `/applications/:id/triage` | Triage application |
| POST | `/applications/:id/extract-questions` | Extract questions from page |
| POST | `/applications/:id/draft` | Generate draft answers |
| POST | `/applications/:id/revise` | Revise answers |
| POST | `/applications/:id/approve` | Approve answer pack |
| POST | `/applications/:id/prefill` | Browser prefill (Puppeteer) |
| POST | `/applications/:id/submit` | Mark as submitted |

### 5.8 Draft Generation

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/draft/need-statement` | Draft a need statement (evidence-grounded) |
| POST | `/draft/need-statement/refine` | Draft + evaluate + refine |
| POST | `/draft/email` | Draft donor email (intro, follow-up, meeting request, proposal nudge, thank you) |

### 5.9 Other Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/donor/profile/generate` | Generate donor profile |
| POST/GET | `/gifts/*` | Gift CRUD, FY lookup, 10BD blocking, bank match |
| GET/POST | `/funder-orgs/*` | Funder scraper orgs, facts, run-now |
| GET | `/reports/digest` | System digest |
| GET | `/reports/csr-pack` | CSR compliance pack |
| GET | `/reports/csr-due-next-30-days` | Upcoming CSR deadlines |
| GET | `/reports/next-best-actions` | AI next actions for org |
| GET | `/reports/stalled-prospects` | Stalled pipeline entries |
| GET | `/reports/meeting-prep` | Meeting prep brief |
| GET | `/reports/reconciliation-metrics` | Reconciliation metrics |
| GET/POST | `/approvals/*` | Artifact versioning & approval |
| GET | `/admin/audit` | Governance audit trail query |
| POST | `/admin/export/pipeline-to-sheets` | Export pipeline to Google Sheets |
| GET/POST | `/sources/*` | Source document registry |
| GET | `/activity-registry/*` | Program activities, instances, plans, context |

### 5.10 Fellowship

| Method | Endpoint | Purpose |
|--------|----------|---------|
| (via orchestrator) | `/orchestrator/run` | Fellowship generation triggered when opportunity has `docTypeCategory: "fellowship"` |

Note: Fellowship has no dedicated controller — it routes through the orchestrator based on `docTypeCategory`.

### 5.11 Email Pipeline

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/email-pipeline/poll` | Poll Gmail for new funding-related emails, classify, and process |
| POST | `/email-pipeline/process` | Process a specific Gmail message ID through the pipeline |
| GET | `/email-pipeline/status` | Get pipeline processing status and recent activity |

### 5.12 SCCF Ingest

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sccf-ingest/index` | Full index: Drive + Gmail |
| POST | `/sccf-ingest/index/drive` | Index SCCF documents from Google Drive |
| POST | `/sccf-ingest/index/gmail` | Index SCCF documents from Gmail |
| GET | `/sccf-ingest/index` | List indexed documents |
| GET | `/sccf-ingest/index/summary` | Get indexing summary stats |

---

## 6. Data Model

The database is PostgreSQL with pgvector. Key entities:

### 6.1 Core Business Entities

| Model | Purpose |
|-------|---------|
| `PipelineEntry` | Donor pipeline — org, contact, stage, lane, compliance, CSR fields |
| `Activity` | Pipeline activity log (calls, emails, meetings, notes) |
| `Opportunity` | Funding opportunity — structured JSON blob, status, missing inputs |
| `ProposalRun` | Proposal generation run — outline, retrieval plan, compliance report, artifacts |
| `ProposalSection` | Individual proposal section — queries, chunks, draft text, citations, gaps |
| `Gift` | Donation tracking — amount, mode, lane, compliance status, FY |
| `PersonalApplication` | Fellowship/accelerator application — status workflow, Q&A |

### 6.2 Evidence Library

| Model | Purpose |
|-------|---------|
| `EvidenceDocument` | Document metadata from Google Drive — extraction status, quality tier (A/B/C/X), corpus, PII, visibility |
| `DocumentChunk` | Text chunks from documents |
| `ChunkEmbedding` | 768-dim vectors (pgvector) for semantic search |
| `ReviewQueueEntry` | Human review queue for evidence QA |
| `SourceDocument` | Source registry for citation traceability |

### 6.3 Framework

| Model | Purpose |
|-------|---------|
| `FrameworkCapability` | 10 Nussbaum central capabilities (C1–C10) with Bihar context |
| `FrameworkMI` | 8 Multiple Intelligences modalities (MI1–MI8) |
| `FrameworkMethodCard` | Visible Thinking routines — intent, steps, when to use |
| `FrameworkPatternCard` | MI activity patterns — duration, materials, facilitator script |
| `FrameworkComparableCase` | Global comparable programs — outcomes, indicators, Bihar transferability |
| `*Capability`, `*MI` junction tables | Tag entities with capabilities and MI modalities |
| `CapabilityIndicator` | Observable indicators per capability |

### 6.4 Program Activities

| Model | Purpose |
|-------|---------|
| `ProgramActivity` | Activity registry — sports, education, digital, life skills, civic |
| `ActivityInstance` | Fortnightly report data — attendance, SEL sessions, meals, sports, etc. |
| `ProgramPlan` | Structured curriculum plans (month → week) |

### 6.5 Funder Discovery

| Model | Purpose |
|-------|---------|
| `FunderOrg` | Organization being scraped (TFIx/BDC network) |
| `FunderFact` | Discovered funder relationships — type, amount, evidence, confidence |

### 6.6 Governance

| Model | Purpose |
|-------|---------|
| `GovernanceAuditEntry` | Write audit trail (BR-GOV-01) |
| `DraftArtifact` / `DraftVersion` / `Approval` | Versioned draft artifacts with approval workflow |
| `OpportunityAuditEvent` / `ApplicationAuditEvent` | Action audit logs |

### 6.7 Pipeline Stages

```
RFP_received → lead → qualified → proposal_sent → won | lost
```

### 6.8 Compliance Lanes

```
DOMESTIC_80G | CSR | FCRA
```

Each lane has different compliance requirements (FCRA uses SBI account, CSR has UC/impact report due dates, 80G requires 10BD form compliance).

---

## 7. Proposal Generation Pipeline

The proposal module implements a multi-stage generation pipeline:

### Stages

1. **RFP Parsing** — Extract funder requirements, deadlines, budget norms, required sections
2. **Planning** — LLM generates proposal outline with sections, target word counts, key claims
3. **Query Generation** — Generate retrieval queries per section
4. **Evidence Retrieval** — Hybrid retrieval (semantic + keyword) from evidence library, with corpus routing (diksha_internal, theory_frameworks, donor_funder, external_evidence)
5. **Section Writing** — LLM drafts each section with evidence context, org profile, framework intelligence, and orchestrator context
6. **Citation Repair** — Post-processing to validate and fix citations
7. **QA Review** — Compliance checking (coverage score, hard claim validation)
8. **Artifact Export** — Export to Google Drive (Google Docs + evidence pack)

### Key Services

| Service | Purpose |
|---------|---------|
| `RfpParserService` | Parse RFP/opportunity into structured brief |
| `PlannerService` | Generate proposal outline |
| `QueryGeneratorService` | Generate retrieval queries per section |
| `SectionWriterService` | Write individual sections with evidence + context |
| `QaReviewerService` | Quality review + compliance scoring |
| `CitationRepairService` | Post-process citation integrity |
| `ArtifactExporterService` | Export to Google Drive |
| `SlackClientService` | Notify Slack on completion |
| `FunderPriorityExtractorService` | Extract funder priorities from opportunity |

### Context Injection

Each section writer receives:
- **Org profile** — Diksha Foundation's narrative profile + program snapshot
- **Evidence chunks** — Retrieved from evidence library (up to 2000 chars per chunk)
- **Framework intelligence** — MEL pack, program design, comparables (if not skipped)
- **Orchestrator context** — Fit score, Gmail memory blocks, budget envelope, web evidence
- **Activity facts** — From program activity registry

### Model Configuration

```typescript
{
  planner: process.env.PROPOSAL_PLANNER_MODEL || "deepseek-chat",
  writer: process.env.PROPOSAL_WRITER_MODEL || "deepseek-chat",
  reviewer: process.env.PROPOSAL_REVIEWER_MODEL || "deepseek-chat",
  retriever: "hybrid",
}
```

Production uses Gemini 2.0 Flash via OpenAI-compatible endpoint.

---

## 8. Orchestrator Pipeline

The orchestrator runs the "Gautam-style" gated state machine:

### Stages

```
Pre-flight: Size Mismatch Gate
    ↓
Stage 0: Deadline Verification (web search for deadline confirmation)
    ↓
Stage A: Enhanced Fit Scoring (6 dimensions, 0-100)
    ↓
Gate: decision → go (≥75) / maybe (60-74) / no (<60)
    ↓ (if go/maybe, or forceGenerate)
Stage B: Gmail Memory Search (past proposals, concept notes, budgets)
    ↓
Stage C: Budget Envelope (template-based, Rs 30-50L/year band)
    ↓
Stage D: Web Evidence Search (Gemini grounding + Google CSE)
    ↓
Stage E: Proposal Generation (enriched with all context above)
```

### Fit Scoring Dimensions

| Dimension | Weight |
|-----------|--------|
| Program fit | 0-25 |
| Strategic alignment | 0-20 |
| Strategic gap value (bonus for unfunded priority) | 0-10 |
| Evidence strength | 0-15 |
| Bihar feasibility | 0-15 |
| Budget fit to Rs 30-50L/year | 0-15 |

### Org Capacity Constraints

- Max ask: Rs 50L/year/funder
- Size mismatch gate: if funder minimum > org capacity × duration, pipeline stops with options (don't pursue / consortium / scope expansion)

### Assess Mode

`POST /orchestrator/assess` runs fit + gmail + budget + web evidence in parallel, without triggering proposal generation. Useful for quick go/no-go decisions.

### Fellowship Routing

When the opportunity's `docTypeCategory` is `"fellowship"`, the orchestrator bypasses the standard ProposalService and routes to the FellowshipService instead. Key differences:
- **Personal voice** — All context is personal (applicant profile, past answers, personal corpus), not organizational
- **Voice calibration** — System prompt includes a voice fingerprint extracted from Gautam's actual writing samples (Cambridge essays, Chevening SOPs)
- **Section archetypes** — Each section is matched to an archetype (motivation, leadership, research_plan, etc.) with tailored instructions
- **First-person singular** — Enforced via voice rewriter safety net and condensation pass
- **No budget/org framing** — Budget language, org-centric phrases, and ToC frameworks are explicitly excluded

---

## 9. Evidence Library & RAG

### Ingestion Pipeline

```
Google Drive scan → Download → Extract (Google Docs API / PDF parser)
    → Normalize → Deduplicate → Doc-type classify → Quality score (A/B/C/X)
    → PII detection → Chunking → Embedding (768-dim) → pgvector storage
```

### Embedding Architecture (CRITICAL — read before changing embedding code)

There are **two separate embedding paths** that MUST both produce 768-dim vectors to match the `vector(768)` pgvector column:

| Path | When | Implementation | Dimension Control |
|------|------|---------------|-------------------|
| **Ingest** (batch) | `POST /v1/evidence-ingest/embed` | Direct REST to `v1beta/models/gemini-embedding-001:batchEmbedContents` via `embedding-provider.ts` | `outputDimensionality: 768` in request body |
| **Query** (per-request) | Every retrieval call | OpenAI SDK in `retrieval.service.ts` → Google's OpenAI-compat endpoint | `dimensions: 768` in SDK call |

**Why two paths?** The ingest path uses Google's native batch API for throughput (500 chunks/call). The query path uses the OpenAI SDK because `retrieval.service.ts` was originally written for OpenAI and was migrated to Google by pointing it at Google's OpenAI-compatible endpoint.

**Environment variables that MUST be set together:**

| Env Var | Value | Why |
|---------|-------|-----|
| `FUNDING_EMBEDDING_PROVIDER` | `google` | Selects Google provider in `embedding-provider.ts` |
| `EVIDENCE_EMBEDDING_MODEL` | `gemini-embedding-001` | Model name for both paths |
| `FUNDING_EMBEDDINGS_API_KEY` | Gemini API key (from Secret Manager) | Auth for both paths |
| `FUNDING_EMBEDDINGS_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai/` | **Routes OpenAI SDK to Google's endpoint** — without this, queries hit `api.openai.com` and fail with 401 |

**Common failure mode:** If `FUNDING_EMBEDDINGS_BASE_URL` is missing, the query path sends the Gemini API key to OpenAI's endpoint → 401 error → all retrieval fails → proposals/fellowships generate with zero evidence.

**Dimension mismatch failure:** `gemini-embedding-001` defaults to 3072-dim. Both paths must explicitly request 768-dim. If dimensions don't match stored vectors, cosine similarity returns garbage scores.

### Retrieval Modes

- **Hybrid** (default) — combines semantic (pgvector cosine similarity) + keyword matching
- **Semantic** — pure vector similarity
- **Keyword** — BM25-style matching

### Corpus Routing

Documents are classified into corpora:
- `diksha_internal` — Diksha's own proposals, reports, concept notes
- `personal` — Personal writing (fellowship essays, SOPs, Cambridge notes) — `orgId: "gautam"`
- `theory_frameworks` — Educational theory, capability frameworks
- `donor_funder` — Donor profiles, funder requirements
- `external_evidence` — WHO, UNICEF, research papers

### Quality Tiers

- **A** — High-quality, usable as-is
- **B** — Usable with minor caveats
- **C** — Low quality, needs review
- **X** — Excluded (duplicates, low text, PII)

### Document Types

`proposal | concept_note | report | budget | presentation | mou | misc`

### Visibility Scopes

`internal | restricted | public-safe` — controls what evidence can be used in external-facing outputs.

---

## 10. Framework Intelligence

Diksha's pedagogical and outcome framework is modeled as structured data:

### Capabilities (C1–C10)

Based on Nussbaum's Central Capabilities, contextualized for Bihar:
- Each capability has: definition, subdimensions, Bihar context examples, measurement ideas, ethics risks
- Used for: project tagging, MEL indicator generation, consistency checking, proposal alignment

### MI Modalities (MI1–MI8)

Based on Gardner's Multiple Intelligences / Project Zero:
- Each modality has: definition, activity signals, assessment artifacts
- Used for: pedagogy design, activity pattern selection

### Card System

| Card Type | Purpose | Key Fields |
|-----------|---------|------------|
| Method Cards | Visible Thinking routines | title, intent, steps, when to use, age band, settings |
| Pattern Cards | MI activity patterns | duration, materials, facilitator script, adaptations |
| Comparable Cases | Global program comparables | org, geography, target group, outcomes, Bihar transferability |

Cards are embedded (768-dim vectors) for semantic retrieval during proposal writing.

### Generated Intelligence

| Generator | Output |
|-----------|--------|
| MEL Pack | Indicators, observable signals, assessment tools per capability |
| Program Design | Activity schedule, staffing, resource plan |
| Comparables Paragraph | Narrative paragraph citing relevant global programs |
| Consistency Check | Quality gate — score, flags (missing capabilities, contradictions) |

---

## 11. Donor Pipeline Management

### Pipeline Entry Fields

- Organization name, contact info
- Stage: `RFP_received → lead → qualified → proposal_sent → won | lost`
- Compliance lane: `DOMESTIC_80G | CSR | FCRA`
- CSR-specific: CSR-1 status/number, reporting cadence, UC due date, impact report due date
- FCRA-specific: foreign source hint → auto-routes to SBI FCRA account
- Deadline, Drive folder URL, submission email
- Sector tags, geography, estimated grant size, probability

### Activity Logging

Types: `email_sent | call | meeting | proposal_submitted | note`

Each activity is timestamped and attributed to a user.

### Next-Best Actions

AI-generated suggestions based on pipeline entry state, activity history, and deadlines.

### Google Sheets Sync

One-way export: `POST /admin/export/pipeline-to-sheets` pushes pipeline + activities to a configured Google Sheet.

---

## 12. Funder Scraper

Automated discovery of funders for organizations in the TFIx and BDC networks:

### Process

1. Add a `FunderOrg` (org name, website, network)
2. Scraper visits org website, searches for funding evidence
3. Extracts `FunderFact` records: funder name, type (CSR/Foundation/HNI/Gov/Multilateral), financial amounts, grant years, program focus, geography
4. Normalizes funder names, assigns match confidence scores
5. Scheduled background processing for pending orgs

### Funder Types

`CSR | Foundation | HNI | Gov | Multilateral | Other`

### Confidence Levels

`High | Medium | Low` — based on evidence quality (annual reports vs. passing mentions).

---

## 13. Application Assistant

For personal/organizational applications to fellowships, accelerators, conferences:

### Workflow

```
Intake (URL) → Triage → Extract Questions → Draft Answers → Revise → Approve → Browser Prefill → Submit
```

### Key Features

- **Question extraction** — Parses application pages to extract form questions
- **Answer generation** — Drafts answers using applicant profile + past answers + snippets
- **Snippet library** — Reusable answer blocks (bio variants, "why me" responses)
- **Past answer memory** — Stores approved answers for future reuse with pattern matching
- **Revision loop** — Human feedback → AI revision
- **Browser prefill** — Puppeteer-based form filling
- **Slack interface** — `/apply` commands for Slack-native workflow

### Application Types

`fellowship | accelerator | conference | award | grant | other`

---

## 14. Draft Generation (Emails & Need Statements)

### Email Templates

| Template | Use Case |
|----------|----------|
| `intro` | First outreach to a new funder |
| `follow_up` | Following up after initial contact |
| `meeting_request` | Requesting a meeting |
| `proposal_nudge` | Nudging after proposal submission |
| `thank_you` | Post-meeting/post-grant thank you |

Emails are grounded in:
- Pipeline context (org name, stage, contact, notes)
- Donor profile snippet
- Evidence chunks (for claim substantiation)

### Need Statement Generation

Two modes:
1. **Draft** — Generate a need statement from context + user message + evidence chunks
2. **Draft + Refine** — Generate → self-evaluate (score + weaknesses) → refine

Evidence chunks are passed with `id`, `source`, `text`, `title`, `urlOrPath` for citation traceability.

### Approval Flow

All drafts go through the approval system:
1. Create artifact (linked to pipeline entry)
2. Create version (content + author)
3. Submit for approval (`approved | changes_requested`)

---

## 15. Gift & Compliance Tracking

### Gift Fields

- Donor name/type, amount, date, mode (UPI/NEFT/card/cheque/cash)
- Transaction reference, bank credit mapping
- Funding lane (DOMESTIC_80G / CSR / FCRA)
- Purpose restriction, FY
- Compliance status: `ready_for_10bd | missing_pan | missing_contact | cash_gt_2000_risk`

### Compliance Gates

- **10BD blocking** — Gifts missing PAN or contact can't get 10BD certificates
- **Bank reconciliation** — Match gifts to bank credits
- **CSR reporting** — Track UC (utilisation certificate) and impact report due dates
- **FCRA compliance** — Auto-detect foreign sources, route to SBI FCRA account

---

## 16. Governance & Approvals

### Write Preview Contract

Before any external-facing write (email send, Slack post, proposal export), the system:
1. Creates a `WritePreviewContract` (before/after state)
2. Requires `ApprovalConfirmation` from a human actor
3. Logs to `GovernanceAuditEntry` with full provenance

### Delivery Guard

The `GovernanceDeliveryGuard` evaluates whether a message can be sent:
- Checks medium (Slack/email)
- Validates targets against allowed lists
- Returns `allow | block` with violation codes

### Audit Trail

All governance events are queryable via `GET /admin/audit` with filters: module, status, date range, pagination.

### Actor Types

```typescript
actorType: "human" | "agent" | "system"
```

---

## 17. Citation Policy

Governed by **FundingBot Citation Policy v1** (see `docs/FUNDING_CITATION_POLICY_V1.md`).

### Core Rules

1. **Rule A — Citation Integrity**: Any `[[CIT:<chunkId>]]` token must point to a chunk in the evidence set
2. **Rule B — Zero-evidence guard**: If no evidence retrieved, no citations allowed; hard claims must use placeholders
3. **Rule C — Hard-claim compliance**: Every hard claim needs citation OR placeholder OR softening
4. **Rule D — Citation not required everywhere**: Absence of citations is OK if no hard claims

### Claim Taxonomy

- **Hard Claims (H)** — Metrics, impact verbs, comparatives, named relationships → MUST be supported
- **Soft Claims (S)** — General context → citation optional
- **Intent/Plan Claims (P)** — Forward-looking proposals → citation not required

### Implementation

- `citation-integrity.service.ts` — Runtime validation in API
- `citation-integrity.ts` — Mirror in eval harness
- Hard claim detection via pattern matching (numbers, impact verbs, comparatives)

---

## 18. Quality & Eval Harness

### Eval Framework

Located in `funding-eval/`, the eval harness tests the full API surface:

### Test Case Types

| Type | What It Tests |
|------|--------------|
| `pipeline_crud` | Pipeline CRUD operations (create, list, get, update) |
| `activity_log` | Activity logging, validation (require donorId/orgId) |
| `opportunity_intake` | Opportunity CRUD, ingest from email |
| `approvals` | Artifact creation, versioning, approval submission |
| `need_statement` | Need statement generation with citation validation |
| `need_statement_refine` | Draft → evaluate → refine cycle |
| `email_draft` | Email drafting with template + context |
| `donor_profile` | Donor profile generation |
| `proposal_generate` | Full proposal generation + provenance validation |
| `framework_retrieve` | Framework card retrieval, MEL generation, consistency check |
| `evidence_retrieve` | Evidence retrieval + eval |
| `safety` | Input validation (expect 400 on bad input) |

### Report Metrics

| Metric | Description |
|--------|-------------|
| `passed / failed` | Overall pass/fail counts |
| `citationCoverageRate` | % of citation-relevant cases meeting min_citations |
| `abstainCorrectnessRate` | % of abstain/non-abstain correct |
| `crudSuccessRate` | % of CRUD operations succeeding |
| `placeholderCompliance` | % of email drafts using placeholders correctly |
| `fabricationRate` | % of outputs avoiding fabricated facts |
| `citationIntegrity` | v1 policy: invalid citations, hard claims, integrity rate |
| `latencyMs` | p50, p95, mean response times |

### Proposal-Specific Metrics

When testing proposals, the evaluator validates:
- Citation provenance: each `[citation:docId:chunkId]` must trace to a retrieved chunk for that section
- Hard claim detection and support validation
- Coverage score from QA reviewer

### CI Integration

- **On push to main** (funding-api or funding-eval changes): CRUD-only eval (no LLM costs)
- **Manual dispatch** with `full_suite=true`: Full LLM eval (costs tokens)
- Uses Cloud SQL proxy for real database, Deepseek for cheap LLM generation
- Reports uploaded as GitHub Actions artifacts (30-day retention)

### Fellowship Acceptance Tests

Three synthetic fellowship opportunities test the full fellowship pipeline:

| Test ID | Fellowship | Sections | Fit Score |
|---------|-----------|----------|-----------|
| `eval-cat2-digital-minds-2026` | Digital Minds | 7 | 20 |
| `eval-cat2-ashoka-changemaker-2026` | Ashoka Changemaker | 6 | 58 |
| `eval-cat2-wellcome-health-2026` | Wellcome Health Equity | 5 | 39 |

**Fellowship-specific checks:** word_limit_compliance, no_org_voice_leakage, cross_section_deduplication, no_budget_language, no_raw_tags, narrative_arc, authenticity, leadership_trajectory, research_plan, track_record_synthesis, personal_anecdote_present, not_too_proposal_like

Run: `npx ts-node cli.ts proposal-suite --api-url <URL> --category fellowship --verbose --summary`

### Question Verification

The `verify-questions` CLI subcommand diffs stored opportunity sections against live form URLs:

```bash
npx ts-node cli.ts verify-questions --api-url <URL> --opportunity <id>
```

Checks: section name similarity matching, word limit consistency, missing/extra sections.

---

## 19. Web Frontend

The `funding-web` React app provides:

### Pages / Features

1. **Pipeline Board** — Kanban-style view of donor pipeline entries
   - Search, filter by stage/owner/priority
   - Entry drawer: overview, activity log, drafts tab
   - Create/edit entries with optimistic locking (version field)
   - Print snapshot
   - Copy org name, notes

2. **Activity Logger** — Log calls, meetings, emails, notes per pipeline entry

3. **Draft Workspace** — Generate and refine drafts
   - Email drafting (5 templates)
   - Need statement drafting + refinement
   - Evidence chunk display with source links
   - Draft versioning + approval workflow
   - Copy/download refined output

4. **Framework Browser** — Browse capabilities, MI modalities, cards
   - Capability presets (Education, Health, Empowerment)
   - Method card, pattern card, comparable case browsers
   - Project capability tagging with strength (1-5)

5. **Settings** — API base URL configuration, connection test, UI preferences

### i18n

Supports English and Hindi locales.

### API Connection

Configurable base URL (default: `http://localhost:3001/v1`), stored in localStorage.

---

## 20. Infrastructure & Deployment

### Cloud Build Pipeline

```
Build API Docker image → Build Web Docker image
    → Push to Artifact Registry
    → Update migration job → Execute migrations
    → Deploy funding-api to Cloud Run
    → Deploy funding-web to Cloud Run
```

### Cloud Run Configuration

| Service | Memory | CPU | Timeout | Min/Max Instances |
|---------|--------|-----|---------|-------------------|
| funding-api | 512Mi | 1 | 300s | 0 / 10 |
| funding-web | 256Mi | 1 | 60s | 0 / 5 |

### Environment Variables (Production)

| Variable | Value |
|----------|-------|
| `FUNDING_MODEL_DRAFT` | `gemini-2.0-flash` |
| `FUNDING_LLM_TIMEOUT_MS` | `120000` |
| `FUNDING_OPENAI_BASE_URL` | Gemini OpenAI-compat endpoint |
| `FUNDING_EMBEDDING_PROVIDER` | `google` |
| `EVIDENCE_EMBEDDING_MODEL` | `gemini-embedding-001` |
| `FUNDING_GEMINI_GROUNDING_MODEL` | `gemini-2.0-flash` |
| `FUNDING_GMAIL_USER` | `gautamgauri@dikshafoundation.org` |

### Secrets (via GCP Secret Manager)

- `FUNDING_OPENAI_API_KEY` (Gemini API key)
- `DATABASE_URL` (Cloud SQL connection string)
- `FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON` (Google APIs SA)
- `FUNDING_GEMINI_API_KEY`, `FUNDING_EMBEDDINGS_API_KEY`

### Database

- Google Cloud SQL (PostgreSQL)
- Instance: `gen-lang-client-0202543132:us-central1:diksha-db`
- pgvector extension for 768-dim embeddings
- Prisma ORM with migration deployment

---

## 21. Known Gaps & Improvement Plan

Based on the gap analysis comparing manual "Gully Goal" proposal to bot output (from `plan.md`):

### Priority 1: Voice & Tone (highest ROI) — PARTIALLY RESOLVED

**Status (March 2026):** Voice calibration implemented for fellowship pipeline. Organizational proposal voice improvements remain open.

| Gap | Root Cause | Fix | Status |
|-----|-----------|-----|--------|
| Impersonal third-person, bullet-heavy style | No voice/tone instruction in section writer prompt | Add WRITING STYLE block: first person plural, active voice, narrative paragraphs, funder-specific framing | Open (proposals) |
| Generic "the funder" language | Section writer prompt doesn't instruct naming the funder | Add instruction to name funder explicitly | Open (proposals) |
| Hollow phrases ("holistic approach", "sustainable impact") | No anti-pattern guidance | Add avoidance list with specific replacements | **Resolved** (fellowship) |
| Fellowship voice not authentic | No voice fingerprint for personal applications | Voice calibration via `GAUTAM_VOICE_GUIDE` in `fellowship/prompts/voice-guide.ts` — covers sentence structure, emotional register, recurring patterns, anti-patterns | **Resolved** |

**Fellowship voice calibration details:**
- `GAUTAM_VOICE_GUIDE` constant extracted from actual writing samples (Cambridge essays, Chevening SOPs)
- Gmail ingest expanded with Chevening/Commonwealth scholarship SOP queries
- Eval scores improved from 0.42 avg core (local, broken) to 0.78 avg core (prod)

### Priority 2: Org Profile Enrichment

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| Missing board members, funding partners, registration details | `org-profile.ts` lacks this data | Enrich with board (7 members), annual budget, partners, compliance details |
| Bullets-only format | LLM mirrors input format | Rewrite profile as narrative prose |

### Priority 3: Section Type Guidance

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| No compliance section | No section type guidance for compliance | Add compliance section type |
| No capability alignment table | Missing capabilityAlignment section guidance | Add capability ↔ activity mapping |
| Thin sustainability section | Generic sustainability guidance | Add 5-mechanism model |

### Priority 4: Evidence Depth

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| Methodology sections lack depth | Evidence chunks truncated to 800 chars | Increase to 2000 chars |

### Priority 5: Number Integration

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| Numbers appear as raw JSON | Activity facts injected as raw JSON | Convert to narrative format with decomposition instructions |

### Priority 6: Theory of Change Format

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| ToC always a JSON table | Program design prompt forces structured format | Produce both narrative sentence + structured breakdown |

### Priority 7: Model Quality

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| Formulaic prose from cheaper model | Model hardcoded | Make model configurable via env var (`PROPOSAL_WRITER_MODEL`) |

### Future Stages (from Orchestrator Spec)

| Stage | Description | Status |
|-------|-------------|--------|
| Stage F: MI/Capabilities Alignment | Auto-tag opportunities with capabilities and MI coverage | Planned (Slice 2) |
| Stage G: Traceability Metadata | Full provenance chain for every claim | Planned (Slice 2) |
| Stage H: Final Assembly | Merge all outputs into final proposal document | Planned (Slice 2) |
| Gmail integration for proposal memory | Search past submissions for reusable blocks | Implemented (Stage B) |
| Slack commands for opportunity workflow | `/opportunity ingest`, `/opportunity assess`, etc. | Partially implemented (Application module has Slack) |

---

## 22. Non-Goals

- **Medical/cancer safety** — Handled separately in Suchi (not the Funding Bot)
- **Eval harness infrastructure changes** — Eval framework is stable
- **Frontend-heavy features** — Focus is API-first; web UI is operational dashboard
- **Multi-tenant SaaS** — Single-tenant for Diksha Foundation (though `orgId` field exists for future)
- **Real-time collaboration** — Not a collaborative editor; one user at a time
- **Automated submission** — Human always clicks submit; bot prefills but doesn't auto-submit grants

---

## 23. Glossary

| Term | Definition |
|------|-----------|
| **Diksha Foundation** | NGO operating KHEL education centers and youth programs in Bihar |
| **KHEL** | Diksha's after-school learning centers (Patna, Bihta, Sarairanjan) |
| **Empowering Futures** | Adolescent girls program across 6 urban settlements in Patna |
| **Fit Score** | 0-100 composite score assessing opportunity-organization fit |
| **Budget Envelope** | Template-based budget constrained to Rs 30-50L/year/funder |
| **Bihar Realism Pass** | Feasibility check against Bihar's operational constraints |
| **Evidence Library** | Google Drive document collection, chunked and embedded for RAG |
| **Capability (C1-C10)** | Nussbaum's Central Capabilities, contextualized for development programming |
| **MI (MI1-MI8)** | Gardner's Multiple Intelligences modalities for pedagogy design |
| **Method Card** | Structured Visible Thinking routine for classroom use |
| **Pattern Card** | MI-aligned activity pattern with facilitator instructions |
| **Comparable Case** | Global program precedent for evidence-based proposal writing |
| **MEL Pack** | Monitoring, Evaluation, and Learning indicators generated per capability |
| **10BD** | Indian tax form for donation receipts (compliance requirement) |
| **CSR** | Corporate Social Responsibility (Indian regulatory framework) |
| **FCRA** | Foreign Contribution Regulation Act (governs foreign funding to Indian NGOs) |
| **UC** | Utilisation Certificate (CSR compliance document) |
| **TFIx / BDC** | Networks of organizations scraped for funder discovery |
| **Hard Claim** | Factual assertion requiring citation, placeholder, or softening |
| **Orchestrator Context** | Combined intelligence (fit score + Gmail memory + budget + web evidence) passed to proposal writer |

---

## 24. RAG Enhancement Roadmap — Suchi Cancer Bot Learnings

The Suchi Cancer Bot has a battle-tested, 8-stage RAG pipeline built for high-stakes medical Q&A. The Funding Bot currently uses single-stage vector retrieval with corpus routing. Transplanting key patterns from the Cancer Bot can materially improve proposal quality — particularly evidence depth, citation coverage, and retrieval relevance.

### 24.1 Side-by-Side Architecture Comparison

| Dimension | Cancer Bot (Current) | Funding Bot (Current) | Gap Severity |
|-----------|---------------------|----------------------|-------------|
| **Search type** | Hybrid (vector + PostgreSQL FTS), dynamic weights by query length | Vector-only (pgvector cosine) + keyword fallback | **Critical** |
| **Reranking** | Cross-encoder (Voyage/Cohere/Jina) with intent-based gating | None | **Critical** |
| **Query expansion** | 6 synonym categories + medical abbreviation expansion (zero LLM cost) | LLM-generated queries only | **High** |
| **Multi-query fusion** | 3 parallel query variants + RRF scoring (chunks found by multiple queries get boosted) | Queries generated independently, no fusion | **High** |
| **Retrieval confidence** | Evidence gate (HIGH/MEDIUM/LOW) → hard routing: answer / hedge / abstain | Basic confidence scoring → soft prompt hint, no hard gate | Moderate |
| **Trusted source boost** | Multiplicative post-retrieval boost (1.5x / 1.25x / 1.1x) by source priority | Quality-tier filtering (A/B/C) but no post-retrieval boosting | Moderate |
| **Query decomposition** | Rule-based multi-intent detection → parallel sub-queries | Each section gets separate query batch (via LLM) | Moderate |
| **Result diversification** | Round-robin by document source (max N per doc) | None | Low |
| **Retrieval retry** | Auto-expansion and retry when initial results thin | None | Low |

### 24.2 Priority Enhancements

#### P0 — Critical Impact (Week 1)

**P0-A: Hybrid Search (Vector + Full-Text Search)**

Add PostgreSQL `websearch_to_tsquery` with `ts_rank_cd` as a parallel search path alongside the existing pgvector cosine search. Combine via weighted sum in a single SQL query using CTEs. Dynamic weighting: short queries 80/20 vector/lexical, long queries 55/45.

- **Why**: Funder names ("UNICEF", "Azim Premji Foundation"), program names ("KHEL", "SPARK"), and specific metrics ("85% attendance") are proper nouns/numbers that vectors handle poorly but lexical search finds precisely.
- **Requirement**: Add GIN index on `DocumentChunk.content` via Prisma migration.
- **Effort**: ~2 days. **Cost**: $0 (PostgreSQL built-in).

**P0-B: Cross-Encoder Reranking with Section-Type Gating**

Port the Cancer Bot's `RerankerService` (Voyage AI, $0.05/1M tokens) with section-type gating instead of intent-based gating.

- **Always rerank**: `budget`, `objectives`, `monitoring`, `results`, `need` (high-evidence sections where precision is critical)
- **Skip rerank**: `team`, `sustainability`, `cover_letter` (narrative-heavy, less evidence-dependent)
- **Conditional rerank**: When score ambiguity detected (gap3 ≤ 0.04 or gap6 ≤ 0.07)
- **Cost**: ~$0.002 per proposal (10 sections × 20 chunks × ~400 tokens). Negligible.
- **Effort**: ~1 day.

#### P1 — High Impact (Week 2)

**P1-A: Multi-Query Retrieval with RRF Fusion**

The Funding Bot already generates 5-10 queries per section via `QueryGeneratorService`. Add Reciprocal Rank Fusion (RRF) scoring: chunks found by multiple queries get a 15% boost per additional query match. This leverages existing infrastructure with zero additional LLM cost.

- **Effort**: ~1 day.

**P1-B: Domain-Specific Query Expansion**

Create a `FundingQueryExpanderService` with static synonym maps for fundraising, Indian development sector, and Diksha-specific terminology. Zero LLM cost.

Example maps: `"outcomes"` → `["impact indicators", "M&E results", "ToC outputs"]`; `"KHEL"` → `["sports program", "physical education"]`; `"CSR"` → `["corporate social responsibility", "Section 135"]`.

- **Effort**: ~0.5 days.

**P1-C: Strengthened Retrieval Confidence Gating**

Per-section-type confidence requirements: `budget` and `monitoring` → require HIGH confidence (insert `[Insert: data needed]` placeholders rather than hallucinate on LOW); `objectives` → MEDIUM; `team` → LOW acceptable. Add auto-retry with expanded queries before accepting LOW.

- **Effort**: ~0.5 days.

#### P2 — Moderate Impact (Week 3)

| Enhancement | Description | Effort |
|-------------|-------------|--------|
| **Trusted source boosting** | Multiply scores by quality tier: A=1.30x, B=1.10x, C=1.00x, X=0.90x | 0.5d |
| **Result diversification** | Cap at N chunks per source document to prevent mono-source sections | 0.25d |
| **Query decomposition** | Decompose multi-evidence sections into sub-queries with different corpus preferences | 1d |
| **Retrieval-with-retry** | Auto-expand and retry when initial retrieval < minChunks | 0.5d |

### 24.3 Domain Adaptation Mappings

The Cancer Bot's intent-based architecture maps naturally to the Funding Bot's section-type architecture:

| Cancer Bot Concept | Funding Bot Equivalent |
|-------------------|----------------------|
| User intent (RED_FLAG / SYMPTOMATIC / INFORMATIONAL) | Section type (budget / objectives / team) |
| Source trust priority (NCI=high, PMC=medium) | Quality tier (A=vetted, B=supporting, C=background) |
| Medical synonym expansion | Fundraising/development-sector synonym expansion |
| Cross-cancer topic detection | Cross-section evidence sharing (budget ↔ sustainability) |
| Evidence gate → answer / hedge / abstain | Evidence gate → write with citations / mark limited / insert placeholders |
| Emotional state routing | Not applicable |
| Hindi↔English cross-lingual | Not applicable (proposals are English-only) |

### 24.4 Expected Impact

| Metric | Current (Est.) | After P0 | After P1 | After P2 |
|--------|---------------|----------|----------|----------|
| Avg top-5 similarity score | 0.45 | 0.55 (+22%) | 0.62 (+38%) | 0.65 (+44%) |
| % sections with ≥3 relevant chunks | 60% | 75% | 85% | 90% |
| Citation coverage (hard claims with citations) | 65% | 72% | 82% | 88% |
| Proper noun recall (program/funder names) | 40% | 70% | 80% | 85% |
| Evidence diversity (unique docs per section) | 1.8 | 2.2 | 2.8 | 3.2 |

**Total incremental cost**: ~$0.002 per proposal. **Total added latency**: ~1-3 seconds per proposal.

---

## 25. Fellowship Pipeline & Voice Calibration

### Overview

The fellowship pipeline generates personal application essays that read as Gautam's authentic voice — not organizational grant proposals. It shares the orchestrator's gated pipeline (fit → gmail → budget → web evidence) but routes to `FellowshipService` instead of `ProposalService`.

### Architecture

```
Orchestrator (docTypeCategory === "fellowship")
    ↓
FellowshipService.generateFellowship(opportunityId)
    ↓
For each section:
  1. Match archetype (motivation | leadership | research_plan | contribution | career_direction | engagement)
  2. Build retrieval queries (section question + expanded + personal framing)
  3. Retrieve from personal corpus only (orgId: "gautam", corpus: ["personal"])
  4. Assemble prompt with voice guide + archetype + cross-section dedup
  5. LLM generation with FELLOWSHIP_SYSTEM_PROMPT
  6. Voice rewriter safety net (rewriteToFirstPerson)
  7. Condensation pass if over word limit × 1.15
  8. Store as ProposalSection
```

### Voice Calibration

The `GAUTAM_VOICE_GUIDE` constant (in `fellowship/prompts/voice-guide.ts`) is a voice fingerprint extracted from Gautam's actual writing samples:

- **Sentence structure** — Opens with concrete action, not abstract thesis; short declarative followed by longer explanatory
- **Emotional register** — Understated; lets facts carry weight; uses specific moments rather than grand claims
- **Recurring patterns** — Bihar as constant anchor; "I returned to..." framing; bridge between institutional learning and ground reality
- **Anti-patterns** — Never uses "I am passionate about", "holistic approach", "sustainable impact", or bullet-point deliverable lists

### Gmail Memory Expansion

Ingest queries expanded to capture fellowship-relevant writing samples:
- Cambridge MPhil concept notes and drafts
- Chevening/Commonwealth scholarship SOPs and personal statements
- Pre-2018 personal writing with fellowship keywords

### Eval Results (3 test fellowships)

| Opportunity | Core Score | Category Score | Status |
|---|---|---|---|
| Digital Minds 2026 | 0.80 | 0.83 | PASS |
| Ashoka Changemaker 2026 | 0.81 | 0.92 | PASS |
| Wellcome Health Equity 2026 | 0.71 | 0.92 | PASS |

**Average:** Core 0.77, Category 0.89 (best prod run)

### Key Files

| File | Purpose |
|------|---------|
| `modules/fellowship/fellowship.service.ts` | Core pipeline: retrieve → draft → condense → store |
| `modules/fellowship/prompts/fellowship.prompts.ts` | System prompt, user prompt builder, archetype matcher |
| `modules/fellowship/prompts/voice-guide.ts` | `GAUTAM_VOICE_GUIDE` voice fingerprint constant |
| `modules/fellowship/utils/voice-rewriter.ts` | First-person enforcement safety net |
| `modules/fellowship/fellowship.types.ts` | `FellowshipDraftOptions` type |

---

## 26. Email Pipeline

### Overview

The email pipeline automates inbound email processing: polling Gmail for funding-related messages, classifying intent, routing to the appropriate pipeline (opportunity intake → orchestrator → proposal/fellowship), and emailing formatted draft results back to the user.

### Pipeline Flow

```
Gmail Poll (label: "funding-bot")
    ↓
Intent Classification (LLM-based, 4 intents)
    ↓
Route by intent:
  fellowship_lead → OpportunityIntake → Orchestrator (fellowship path)
  proposal_lead   → OpportunityIntake → Orchestrator (proposal path)
  draft_request   → Direct draft generation
  unknown         → Park with notification
    ↓
Format draft (HTML + plain text)
    ↓
Email to sender + gautamgauri@dikshafoundation.org
```

### Intent Classification

| Intent | Description | Routing |
|--------|-------------|---------|
| `fellowship_lead` | Fellowship/scholarship/personal application opportunity | Fellowship pipeline |
| `proposal_lead` | Organizational grant/CSR/foundation opportunity | Proposal pipeline |
| `draft_request` | Request to draft/revise a specific section | Direct generation |
| `unknown` | Unclassifiable — parked for manual review | Notification only |

### Configuration

| Env Var | Default | Purpose |
|---------|---------|---------|
| `EMAIL_PIPELINE_POLL_ENABLED` | `false` | Enable Cloud Scheduler polling |
| `EMAIL_PIPELINE_POLL_LABEL` | `funding-bot` | Gmail label to filter on |
| `EMAIL_PIPELINE_OWNER_EMAIL` | — | Always receives pipeline output (default: gautamgauri@dikshafoundation.org) |

### Idempotency

Processed emails are tracked in the `ProcessedEmail` table to prevent duplicate processing. Each email is recorded with its Gmail message ID, classification result, and processing outcome.

### Key Files

| File | Purpose |
|------|---------|
| `modules/email-pipeline/email-pipeline.service.ts` | Core pipeline: poll → classify → intake → orchestrate → format → send |
| `modules/email-pipeline/email-classifier.service.ts` | LLM-based intent classification |
| `modules/email-pipeline/draft-formatter.service.ts` | HTML/plain text email formatting |
| `modules/email-pipeline/email-pipeline.controller.ts` | REST endpoints |

---

## 27. SCCF Document Indexer

### Overview

Indexes documents from Suchitra Cancer Care Foundation (SCCF) — Diksha's sister organization — into the evidence library. Lives in the funding-api (not suchi-api) because SCCF documents serve as proposal evidence for health-related funding opportunities.

### Sources

- **Google Drive** — SCCF shared Drive folder (screening reports, navigation protocols, patient data)
- **Gmail** — SCCF-related email threads (reports, updates, partnership communications)

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/sccf-ingest/index` | Full index: Drive + Gmail |
| POST | `/sccf-ingest/index/drive` | Index from Google Drive only |
| POST | `/sccf-ingest/index/gmail` | Index from Gmail only |
| GET | `/sccf-ingest/index` | List indexed documents |
| GET | `/sccf-ingest/index/summary` | Indexing summary stats |

### Configuration

| Env Var | Purpose |
|---------|---------|
| `SCCF_DRIVE_FOLDER_ID` | SCCF root folder on Diksha shared Drive |
| `SCCF_GMAIL_SEARCH_QUERY` | Override default Gmail search query |

Note: Reuses `FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON` and `FUNDING_GMAIL_USER` from the main funding bot config.

### Schema

`SccfDocument` model in `apps/funding-api/prisma/schema.prisma` (diksha-db).

---

## Annexure A — Reusable Code & Patterns from Suchi Cancer Bot

This annexure maps specific Cancer Bot source files and code logic that can be directly reused, adapted, or ported to the Funding Bot. Both bots share the same stack (NestJS + Prisma + PostgreSQL + pgvector), making transplantation straightforward.

### A.1 Direct Port — Copy and Adapt

These files can be copied from the Cancer Bot and adapted with minimal changes (domain-specific constants swapped, same architecture preserved).

| # | Cancer Bot Source File | Target Funding Bot File (New) | What It Does | Adaptation Required |
|---|----------------------|------------------------------|-------------|-------------------|
| 1 | `apps/api/src/modules/rag/reranker.service.ts` (~486 lines) | `apps/funding-api/src/modules/evidence_ingest/reranker.service.ts` | Cross-encoder reranking via Voyage/Cohere/Jina with intelligent gating (skip when scores are unambiguous) | Replace intent-based gating with section-type gating (`ALWAYS_RERANK_SECTIONS`, `SKIP_RERANK_SECTIONS`). Same provider config, same scoring math. |
| 2 | `apps/api/src/modules/rag/query-expander.service.ts` (~435 lines) | `apps/funding-api/src/modules/evidence_ingest/query-expander.service.ts` | Rule-based query expansion using static synonym maps. Zero LLM cost. | Replace medical synonym maps with fundraising/development-sector maps: outcomes, beneficiaries, budget, M&E, Indian development abbreviations, Diksha program names. Same expansion algorithm. |
| 3 | `apps/api/src/modules/rag/query-decomposer.service.ts` (~412 lines) | `apps/funding-api/src/modules/proposal/services/query-decomposer.service.ts` | Rule-based signal detection to decompose multi-faceted queries into targeted sub-queries | Replace medical signal patterns (symptoms, treatments) with proposal signal patterns (statistics, policy context, org experience). Map sub-queries to corpus preferences. |
| 4 | Hybrid search SQL in `apps/api/src/modules/rag/rag.service.ts` (lines 706-841) | Modify existing `apps/funding-api/src/modules/evidence_ingest/retrieval.service.ts` | Parallel vector + FTS search with dynamic weighting and CTE-based combination | Add `fts_matches` CTE alongside existing `top_vectors` CTE. Same SQL pattern, same dynamic weighting logic. Existing raw SQL (`$queryRawUnsafe`) makes this surgical. |
| 5 | RRF fusion logic in `apps/api/src/modules/rag/rag.service.ts` (lines 116-184) | `apps/funding-api/src/modules/proposal/utils/rrf-fusion.ts` (New) | Reciprocal Rank Fusion scoring: merge multi-query results, boost chunks found by multiple queries | Direct port — same algorithm, same constants (`k=60`, `boost=0.15` per additional query match). |
| 6 | Trust-based reranking in `apps/api/src/modules/rag/rag.service.ts` (lines 350-400) | Modify existing `apps/funding-api/src/modules/evidence_ingest/retrieval.service.ts` | Multiplicative score boost by source priority after retrieval | Map Cancer Bot's source trust tiers (NCI=1.5x, PMC=1.25x) to Funding Bot quality tiers (A=1.3x, B=1.1x, C=1.0x, X=0.9x). Same multiplicative math. |

### A.2 Pattern Reuse — Same Architecture, Different Domain

These Cancer Bot architectural patterns should be adopted, but implemented fresh for the funding domain (the code structure and gating logic are directly transferable, but the content is entirely different).

| # | Cancer Bot Pattern | Cancer Bot Location | Funding Bot Application | Key Difference |
|---|-------------------|-------------------|------------------------|---------------|
| 7 | **Evidence Gate with hard routing** | `apps/api/src/modules/evidence/evidence-gate.service.ts` (~300 lines) | Strengthen existing `retrieval-confidence.ts` to hard-gate: LOW → placeholder insertion, not LLM hallucination | Cancer Bot routes to answer/hedge/abstain for medical safety. Funding Bot routes to write/mark-limited/insert-placeholders for proposal quality. Same gate architecture, different consequences. |
| 8 | **Intent-gated reranking thresholds** | `reranker.service.ts` gating logic (gap3, gap6, h1 thresholds) | Section-type-gated reranking thresholds | Cancer Bot: RED_FLAG_URGENT → always rerank. Funding Bot: `budget`, `monitoring` → always rerank. Same threshold math (gap3 ≤ 0.04, gap6 ≤ 0.07, h1 < 0.62). |
| 9 | **Cross-topic evidence sharing** | `apps/api/src/modules/rag/cross-cancer-topics.ts` | Cross-section evidence sharing: tag chunks relevant to multiple sections, avoid redundant retrieval | Cancer Bot: smoking → lung + bladder + esophageal. Funding Bot: attendance data → budget + monitoring + objectives sections. Same tagging mechanism. |
| 10 | **Retrieval-with-expansion retry** | `rag.service.ts` `retrieveWithExpansion()` | Add retry when initial retrieval returns < minChunks or low avg scores | Same retry-with-expanded-terms pattern. Funding Bot uses fundraising expansion terms instead of diagnostic/screening terms. |
| 11 | **Result diversification** | `rag.service.ts` round-robin by document source | Cap chunks per source document to prevent mono-source sections | Same `maxPerDoc` filter. Cancer Bot caps by source name; Funding Bot caps by `documentId`. |

### A.3 Eval Framework Reuse

| # | Cancer Bot Eval Component | Funding Bot Adaptation |
|---|--------------------------|----------------------|
| 12 | **Deterministic checker** (`eval/runner/deterministic-checker.ts`) — Regex-based checks for required sections, citation format, prohibited language | Port the checker framework. Replace medical checks (disclaimer patterns, diagnosis language) with funding checks (placeholder compliance, fabrication detection, hard claim coverage). |
| 13 | **Hybrid retrieval test scenarios** (`eval/hybrid_retrieval_scenarios.json`) — 12 scenarios validating vector + FTS blend with expected sources and terms | Create equivalent `funding_retrieval_scenarios.json` with proposal-relevant scenarios: org name recall, budget line items, program names, funder name matching, metric precision. |
| 14 | **Rubric-based scoring** (`eval/rubrics/rubrics.v1.json`) — Per-intent rubrics with weighted deterministic + LLM judge checks, pass thresholds | Create per-section-type rubrics for funding: budget sections need citation density ≥ 0.4; objectives need evidence grounding; sustainability needs 5-mechanism coverage. |
| 15 | **LLM judge with fallback** (`eval/runner/llm-judge.ts`) — OpenAI / Deepseek / Vertex AI with cost tracking and consensus voting | Port the provider-agnostic judge framework. Currently funding-eval is deterministic-only; adding LLM judge for semantic quality (voice/tone, Bihar realism, funder-specific framing) would close a gap. |
| 16 | **CI email notifications** (Cancer Bot `eval-tier1.yml` sends failure emails with top-5 failed cases) | Add email notification to funding-eval CI workflow for regression alerts. Same SMTP pattern. |

### A.4 Shared Package Opportunities

Both bots share the NestJS + Prisma + pgvector stack. Extracting shared packages avoids duplicate maintenance:

| Package | Contents | Used By |
|---------|----------|---------|
| `@suchi/reranker` | Cross-encoder reranking service (Voyage/Cohere/Jina providers, gating logic) | Cancer Bot, Funding Bot |
| `@suchi/hybrid-search` | Hybrid search SQL builder (vector + FTS CTE generation, dynamic weighting) | Cancer Bot, Funding Bot |
| `@suchi/rrf-fusion` | Reciprocal Rank Fusion utility (multi-query merge, boost calculation) | Cancer Bot, Funding Bot |
| `@suchi/eval-runner` | Eval runner framework (case loading, deterministic checker, LLM judge, report generation) | Cancer Bot eval, Funding Bot eval |

### A.5 Code NOT Transferable

| Cancer Bot Code | Reason Not Applicable to Funding Bot |
|----------------|-------------------------------------|
| `cross-lingual.service.ts` (Hindi↔English parallel queries) | Funding proposals are English-only |
| Emergency fast-path (regex-based crisis detection) | No crisis/emergency routing in proposal generation |
| Self-harm / emotional state detection | Not applicable to document generation |
| `synonym-service.ts` (NCIt medical synonyms) | Medical terminology not relevant; replaced by fundraising synonyms |
| SafeFallbackResponse with helpline numbers | Proposals don't need helpline fallbacks |
| Disclaimer engine (medical disclaimers) | Not applicable; replaced by citation policy enforcement |
| Voice rubrics / STT accuracy scoring | Funding Bot is text-only |

---

## Annexure B — Eval Framework Cross-Pollination

### B.1 Current State Comparison

| Dimension | Cancer Bot Eval | Funding Bot Eval |
|-----------|----------------|-----------------|
| **Test cases** | 100+ (20 cancers × 5 intents + retrieval quality + regression) | 42+ (12 domain areas) |
| **Evaluation method** | Deterministic + LLM judge (Deepseek/Vertex AI) | Deterministic only (citation counting, CRUD validation) |
| **Rubric scoring** | Per-intent rubrics with 7-10 weighted checks, 85% pass threshold | Binary pass/fail on citation count, CRUD success, placeholder compliance |
| **Retrieval quality testing** | 12 hybrid retrieval scenarios with expected sources, term presence, chunk count | Evidence retrieve + eval endpoint test (2-3 cases) |
| **CI integration** | Nightly + PR-triggered (non-blocking), email alerts on failure | Push-triggered (CRUD-only) + manual dispatch (full suite), blocking on regression |
| **Cost tracking** | LLM judge cost tracked (Deepseek pricing) | Not tracked |
| **Report depth** | Per-case scores, evidence quotes, avg score, trusted source rate | Aggregate metrics (citation rate, CRUD rate, latency), per-case pass/fail |

### B.2 Recommended Enhancements for Funding Bot Eval

**Priority 1 — Retrieval Quality Test Suite**

Add a `funding_retrieval_scenarios.json` (modeled on Cancer Bot's `hybrid_retrieval_scenarios.json`) with 15-20 scenarios:

| Scenario Category | Example Query | Expected Behavior |
|-------------------|--------------|-------------------|
| Org name recall | "What programs does Diksha Foundation run?" | Top-3 includes diksha_internal chunks |
| Funder name precision | "Azim Premji Foundation requirements" | Exact match on funder name in retrieved chunks |
| Budget line items | "Equipment costs for KHEL centers" | Budget-tagged chunks ranked above narrative |
| Program metric recall | "Attendance rates across centers" | Chunks with specific numbers (82%, 147 students) |
| Framework retrieval | "Nussbaum capabilities for education" | theory_frameworks corpus chunks |
| Cross-section evidence | "Sustainability of football program" | Chunks from both diksha_internal and external_evidence |

**Priority 2 — Per-Section-Type Rubrics**

Create `funding-rubrics.v1.json` with section-type-specific checks:

| Section Type | Deterministic Checks | Pass Threshold |
|-------------|---------------------|---------------|
| `budget` | Citation density ≥ 0.3, no fabricated numbers, Indian format (lakhs/crores) | 90% |
| `objectives` | Evidence grounding (≥2 citations), capability alignment present | 85% |
| `need` | Statistics cited, Bihar context present, NEP/policy reference | 85% |
| `monitoring` | MEL indicators present, data collection method specified | 80% |
| `sustainability` | ≥3 of 5 mechanisms named, concrete (not aspirational) | 80% |
| `methodology` | ≥2 paragraphs on "how", not just activity names | 75% |

**Priority 3 — LLM Judge for Voice/Tone**

Port the Cancer Bot's `llm-judge.ts` framework (provider-agnostic, cost-tracked) and add proposal-specific semantic checks:

| Check | What It Evaluates |
|-------|------------------|
| `first_person_voice` | Uses "We"/"Our" — not "The organization" |
| `funder_named` | Funder referenced by name — not "the funder" |
| `bihar_realistic` | References local geography, policies, constraints by name |
| `narrative_not_bullets` | Flowing prose paragraphs, not bullet-only sections |
| `numbers_woven` | Numbers decomposed and woven into sentences, not standalone |
| `no_hollow_phrases` | Avoids "holistic approach", "sustainable impact", etc. |

---

*End of document — Funding Bot BRD v2.2*
