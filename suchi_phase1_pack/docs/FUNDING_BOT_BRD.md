# Funding Bot — Business Requirements Document (BRD)

**Version:** 2.0
**Last updated:** 2026-03-01
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
│  │  caps/MI     │  ingest/RAG  │  emails       │  intake      │  │
│  │  method cards│  chunk/embed │  need stmts   │  extract Q   │  │
│  │  MEL gen.    │  retrieve    │  approval     │  draft/revise│  │
│  │  consistency │              │               │  prefill     │  │
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
| Embeddings | Google `text-embedding-004` / `gemini-embedding-001` (768 dims) |
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

---

## 9. Evidence Library & RAG

### Ingestion Pipeline

```
Google Drive scan → Download → Extract (Google Docs API / PDF parser)
    → Normalize → Deduplicate → Doc-type classify → Quality score (A/B/C/X)
    → PII detection → Chunking → Embedding (768-dim) → pgvector storage
```

### Retrieval Modes

- **Hybrid** (default) — combines semantic (pgvector cosine similarity) + keyword matching
- **Semantic** — pure vector similarity
- **Keyword** — BM25-style matching

### Corpus Routing

Documents are classified into corpora:
- `diksha_internal` — Diksha's own proposals, reports, concept notes
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

### Priority 1: Voice & Tone (highest ROI)

| Gap | Root Cause | Fix |
|-----|-----------|-----|
| Impersonal third-person, bullet-heavy style | No voice/tone instruction in section writer prompt | Add WRITING STYLE block: first person plural, active voice, narrative paragraphs, funder-specific framing |
| Generic "the funder" language | Section writer prompt doesn't instruct naming the funder | Add instruction to name funder explicitly |
| Hollow phrases ("holistic approach", "sustainable impact") | No anti-pattern guidance | Add avoidance list with specific replacements |

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

*End of document — Funding Bot BRD v2.0*
