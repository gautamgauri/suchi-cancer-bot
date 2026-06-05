# Suchi Navigator Pipeline

Hospital directory curation pipeline for the Suchi Navigator feature. Produces entries in `apps/api/data/hospitals.json`.

## Overview

```
Cloud Scheduler (01:30 UTC daily)
  → POST /v1/admin/hospital-research
    → NavigatorResearchService
      → reads next pending batch from GCS queue
      → calls Gemini (LlmService)
      → validates through inclusion criteria (3 gates)
      → updates queue → email_sent
      → emails Gautam + Divya with review portal link
        → Divya edits (optional) → Approve All
          → hospitals merged into hospitals.json
```

All pipeline state lives in GCS: `suchi-navigator-state/queue.json` (bucket set via `QUEUE_GCS_BUCKET`).

---

## Pipeline Steps

### 1. Daily Automated Research (Cloud Scheduler)

**Trigger:** Cloud Scheduler job `suchi-hospital-research-daily` fires daily at **01:30 UTC (7:00 AM IST)**.

**Mechanism:** HTTP POST to `POST /v1/admin/hospital-research` on the `suchi-api` Cloud Run service, secured with `SchedulerOidcGuard` (same pattern as `POST /admin/daily-report`). The OIDC token is issued for the service account `suchi-scheduler@gen-lang-client-0202543132.iam.gserviceaccount.com`.

**Logic** (`apps/api/src/modules/admin/navigator-research.service.ts`):
1. Reads `queue.json` from GCS
2. Finds the next batch with status `pending`
3. Calls Gemini via `LlmService.generate()` with a structured research prompt for the batch's region
4. Validates each returned hospital through 3 inclusion gates (see below)
5. Updates the batch in GCS: hospitals saved, status → `email_sent`, approval token stored
6. Emails Gautam + Divya with a summary table and a "Review & Approve" link

If no `pending` batch is found, the job returns `{ status: "no_pending" }` and exits cleanly.

**Inclusion criteria (all 3 must pass)** — OD-010 closed Jun 2026:

| Gate | Requirement | Examples that qualify |
|---|---|---|
| 1. Oncology department | At least one dedicated oncology department | Medical oncology, surgical oncology, radiation oncology, gynae-oncology, paediatric oncology, haemato-oncology |
| 2. Treatment modalities | 2 or more active treatment modalities | Surgery, chemotherapy, radiation, immunotherapy, BMT, targeted therapy, hormone therapy |
| 3. Trust signal | At least one verifiable trust signal | NABH/NABL/JCI/ISO accreditation, NCG membership, TMC/AIIMS affiliation, government tertiary hospital |

**Required fields** — a hospital entry without these is incomplete and must be flagged in review:

| Field | Why required |
|---|---|
| `name` | Identity |
| `city` + `state` | Location for patient routing |
| `address` | Patient can find the facility |
| `phone` | Patient can call to verify/book |
| `departments` (≥1) | Confirms oncology capability |
| `type` (`government`/`private`/`trust`) | Cost guidance for patients |
| `last_verified` | Staleness tracking |

**Disqualifying conditions** (hospital is excluded regardless of trust signals):
- No oncology department — only palliative care or general surgery
- Purely hospice / end-of-life care facility
- Unable to be contacted for verification (phone disconnected, no web presence)
- Closed or relocated without updated contact details

Hospitals failing any gate are logged as warnings and dropped. If the entire batch fails, the job returns an error result without advancing the queue.

### 2. Adding batches to the queue (manual, ad hoc)

New research regions are added to `queue.json` as `pending` batches either directly (editing GCS) or via the CLI:

```bash
# CLI adds a region stub to queue.json with status pending
cd navigator && npx ts-node cli.ts add-region "<Region Name>"
```

The CLI (`navigator/cli.ts`) and queue manager (`navigator/queue-manager.ts`) remain available for manual operations and local fallback.

### 3. Review portal

**URL:** `GET /v1/admin/navigator/review/:batchId?token=<hmac>`

Served as HTML by `admin.controller.ts` → `navigator-review.html.ts`. Shows all hospitals in the batch with:
- Read view: all fields, sources, navigation notes, key doctors
- "Edit" button per hospital — expands an inline edit form

**Editable fields:** name, short_name, type, tier, score (0–100), confidence, accreditation, departments, cost_tier, notes, navigation_notes, key_doctors, phone, address, website.

Edits are saved via `PATCH /v1/admin/navigator/batch/:batchId/hospital/:hospitalId?token=<hmac>` and persisted to GCS immediately.

### 4. Approve

**Trigger:** "Approve All" button on the review portal.

**Route:** `GET /v1/admin/navigator/approve/:batchId?token=<hmac>`

1. Verifies HMAC token (timing-safe compare)
2. Loads `queue.json` from GCS (fails hard if GCS unreachable)
3. Converts each `HospitalDraft` → `hospitals.json` entry
4. Appends to `hospitals.json`, updates `_meta.total_hospitals` and `_meta.last_updated`
5. Sets batch status → `approved` in `queue.json`

Idempotent: re-approving an already-approved batch returns a note and does not duplicate hospitals.

---

## Batch States

| Status | Meaning |
|---|---|
| `pending` | Region queued, research not yet run |
| `researched` | (Legacy) Draft hospitals loaded via manual `add` CLI command |
| `email_sent` | Research complete, review email sent, approval token stored |
| `approved` | Hospitals merged into hospitals.json |
| `rejected` | Manually set; not used by automated flow |

**Current queue state (2026-05-20):** 3 pending (Jharkhand, West Bengal, Sikkim/Northeast), 11 email_sent (awaiting Divya's approval), 9 approved.

---

## hospitals.json

Source of truth at `apps/api/data/hospitals.json`. Served by `hospital-directory.service.ts` in the chat module. Mirrored to GCS in the same bucket as `queue.json`.

**Scoring (0–100 scale):**
- Quality: TMC/NCG full member=50, AIIMS=40, NABH full=30, Govt tertiary=20, Private=10
- Cost: Low=30, Medium=20, High=10
- Location: East India state=10, elsewhere=0
- PMJAY: Yes=10, No/Unknown=0
- Risk flag: verified concern=−30
- SCCF affiliation: +20 reserved (pending conference attendee list)

**Total hospitals (2026-05-13):** 83

---

## Key Files

| File | Purpose |
|---|---|
| `apps/api/src/modules/admin/navigator-research.service.ts` | Daily research logic (GCS read → Gemini → validate → GCS write → email) |
| `apps/api/src/modules/admin/navigator-approve.service.ts` | Review portal data, PATCH edits, approval logic |
| `apps/api/src/modules/admin/navigator-review.html.ts` | HTML builder for the review portal page |
| `apps/api/src/modules/admin/admin.controller.ts` | Routes: `POST /v1/admin/hospital-research`, `GET /v1/admin/navigator/review/:batchId`, `PATCH /v1/admin/navigator/batch/:batchId/hospital/:hospitalId`, `GET /v1/admin/navigator/approve/:batchId` |
| `apps/api/data/hospitals.json` | Live hospital directory (83 hospitals) |
| `navigator/cli.ts` | CLI for manual queue operations and local research |
| `navigator/hospital-mailer.ts` | Standalone email builder (used by CLI) |
| `navigator/queue-manager.ts` | Load/save/update queue.json |
| `navigator/daily-researcher.ts` | Original standalone script (Anthropic API). Superseded by `NavigatorResearchService`; kept as local fallback/reference. |

---

## Environment Variables

| Variable | Description |
|---|---|
| `NAVIGATOR_APPROVAL_SECRET` | HMAC secret for approval tokens (default: `suchi-nav-dev-secret`) |
| `QUEUE_GCS_BUCKET` | GCS bucket name for queue.json + hospitals.json (required in prod) |
| `QUEUE_GCS_OBJECT` | GCS object key for queue (default: `queue.json`) |
| `HOSPITALS_GCS_OBJECT` | GCS object key for hospital directory (default: `hospitals.json`) |
| `SMTP_PASS` | Gmail app password for outbound email |
| `SMTP_HOST` | SMTP host (default: `smtp.gmail.com`) |
| `SMTP_USER` | SMTP sender (default: `gautamgauri@dikshafoundation.org`) |
| `DAILY_REPORT_EMAIL` | Primary reviewer email (default: `gautamgauri@dikshafoundation.org`) |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (default: `gen-lang-client-0202543132`) |

---

## Manual Steps That Remain

1. **Queue new regions** — add `pending` batches to `queue.json` on GCS whenever a new region should be researched.
2. **Review and approve batches** — click the review link from the daily email, optionally edit hospital fields inline, then click "Approve All". This is the only human gate before hospitals reach the live directory.
3. **Monitor** — if a daily run returns `no_pending`, add more regions. If it returns `error`, check Cloud Run logs for the `NavigatorResearchService` logger.
