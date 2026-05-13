# Suchi Navigator Pipeline

Hospital directory curation pipeline for the Suchi Navigator feature. Produces entries in `apps/api/data/hospitals.json`.

## Overview

```
research → add → send → review portal → edit (optional) → approve → hospitals.json
```

All pipeline state lives in `navigator/queue.json` (mirrored to GCS when `QUEUE_GCS_BUCKET` is set).

---

## Pipeline Steps

### 1. Research (`navigator/cli.ts research <region>`)

Prints agent instructions + a template JSON for the hospital-researcher agent. The agent collects up to 5 hospitals per batch:
- Full name, short name, city, state
- Type, accreditation, departments, cost tier
- PMJAY empanelment, NCG membership
- Key doctors, contact details
- Navigation notes (practical patient tips)
- Sources, researcher confidence (high / medium / low)

Output saved to a JSON file: `{ batch_id, hospitals[] }`.

### 2. Add (`navigator/cli.ts add <path>`)

Loads the draft JSON and writes hospitals into the named batch in `queue.json`. Sets batch status → `researched`. Enforces max 5 hospitals per batch.

### 3. Send (`navigator/cli.ts send <batch-id>`)

Generates an HMAC token (`NAVIGATOR_APPROVAL_SECRET` env var) keyed on `batchId`, sends a review email to `gautamgauri@dikshafoundation.org` and `divya.vats@dikshafoundation.org`, and sets batch status → `email_sent`. Token and timestamp persisted to `queue.json` + GCS.

Email contains full hospital data cards plus a single "Review & Approve" button linking to the review portal.

SMTP: `SMTP_PASS` env var first, then Secret Manager (`SMTP_PASS` secret). Falls back gracefully — token is saved even if email fails.

### 4. Review portal (`GET /v1/admin/navigator/review/:batchId?token=<hmac>`)

Served as HTML by `admin.controller.ts` → `navigator-review.html.ts`. Shows all hospitals (up to 5) with:
- Read view: all fields in a table, Sources list, Navigation Notes, Key Doctors
- "Edit" button per hospital: expands an inline edit form

**Editable fields:** name, short_name, type, tier, score (0–100), confidence, accreditation (comma-separated), departments (comma-separated), cost_tier, notes, navigation_notes (one per line), key_doctors (one per line: `Name | Role`), phone, address, website.

Edit saves are sent via `PATCH /v1/admin/navigator/batch/:batchId/hospital/:hospitalId?token=<hmac>` and persisted to `queue.json` + GCS immediately. Approving a batch with unsaved edits would use the last-saved state.

### 5. Approve (`GET /v1/admin/navigator/approve/:batchId?token=<hmac>`)

Triggered by "Approve All" button on the review portal. Batch must be in `email_sent` status:

1. Verify HMAC token (timing-safe compare)
2. Load `queue.json` (GCS primary, local fallback; fails hard if GCS configured and unreachable)
3. Convert each `HospitalDraft` → `hospitals.json` entry (fills in defaults for empty fields)
4. Append entries to `hospitals.json`, increment `_meta.total_hospitals`, set `_meta.last_updated`
5. Set batch status → `approved` in `queue.json`

Returns an HTML confirmation page. Idempotent: re-approving an already-approved batch returns immediately with a note, does not duplicate hospitals.

---

## Batch States

| Status | Meaning |
|---|---|
| `pending` | Batch created in queue.json, research not started |
| `researched` | Draft hospitals loaded via `add` command |
| `email_sent` | Review email sent, approval token stored |
| `approved` | Hospitals merged into hospitals.json |
| `rejected` | Manually set; not used by automated flow |

---

## hospitals.json

Source of truth at `apps/api/data/hospitals.json`. Served by `hospital-directory.service.ts` in the chat module. Mirrored to GCS as `hospitals.json` in the same bucket as `queue.json`.

**Scoring:** 0–100 scale throughout.
- Quality: TMC/NCG full member=50, AIIMS=40, NABH full=30, Govt tertiary=20, Private=10
- Cost: Low=30, Medium=20, High=10
- Location: East India state=10, elsewhere=0
- PMJAY: Yes=10, No/Unknown=0
- Risk flag: verified concern=−30
- SCCF affiliation: +20 reserved (pending conference attendee list)

**Total hospitals as of 2026-05-13:** 83

---

## Key Files

| File | Purpose |
|---|---|
| `navigator/cli.ts` | CLI entry point (research / add / send / status) |
| `navigator/hospital-mailer.ts` | Builds + sends HTML review email, generates HMAC token |
| `navigator/queue-manager.ts` | Load/save/update `queue.json` |
| `navigator/gcs-queue.ts` | GCS sync for `queue.json` |
| `navigator/types.ts` | `ResearchTarget`, `HospitalDraft`, `BatchStatus` |
| `apps/api/src/modules/admin/navigator-approve.service.ts` | Review portal data + PATCH edits + approval logic |
| `apps/api/src/modules/admin/navigator-review.html.ts` | HTML builder for the review portal page |
| `apps/api/src/modules/admin/admin.controller.ts` | Routes: `GET /v1/admin/navigator/review/:batchId`, `PATCH /v1/admin/navigator/batch/:batchId/hospital/:hospitalId`, `GET /v1/admin/navigator/approve/:batchId` |
| `apps/api/data/hospitals.json` | Live hospital directory (83 hospitals) |

---

## Environment Variables

| Variable | Description |
|---|---|
| `NAVIGATOR_APPROVAL_SECRET` | HMAC secret for approval tokens (default: `suchi-nav-dev-secret`) |
| `QUEUE_GCS_BUCKET` | GCS bucket name for queue.json + hospitals.json (if unset, uses local files) |
| `QUEUE_GCS_OBJECT` | GCS object key for queue (default: `queue.json`) |
| `HOSPITALS_GCS_OBJECT` | GCS object key for hospital directory (default: `hospitals.json`) |
| `SMTP_PASS` | Gmail app password for outbound email |
| `SMTP_HOST` | SMTP host (default: `smtp.gmail.com`) |
| `SMTP_USER` | SMTP sender (default: `gautamgauri@dikshafoundation.org`) |
