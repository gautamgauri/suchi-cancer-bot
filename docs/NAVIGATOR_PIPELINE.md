# Suchi Navigator Pipeline

Hospital directory curation pipeline for the Suchi Navigator feature. It turns researched hospital drafts into reviewed entries consumed by chat, the landing site, and the KB navigation markdown.

## Overview

```text
pending batch -> research -> researched -> email_sent -> review/edit -> approve -> hospitals.json
```

The workflow is intentionally approval-gated. Drafts can be created manually with the CLI or by a scheduled Cloud Run Job, but entries only become part of the directory after a reviewer opens the signed review link and approves the batch.

## Data Stores

| Store | Purpose | Source code |
|---|---|---|
| `navigator/queue.json` | Batch queue for research targets and draft hospitals. | `navigator/queue-manager.ts`, `navigator/cli.ts`, `navigator/daily-researcher.ts`, `navigator/daily-sender.ts` |
| `apps/landing/src/content/hospitals.json` | Git-tracked seed directory used by the landing app and local API development. | `apps/landing/src/content/hospitals.json` |
| `apps/api/data/hospitals.json` | API container copy staged at build time from the landing app file. | `cloudbuild.yaml`, `apps/api/Dockerfile`, `apps/api/src/modules/chat/hospital-directory.service.ts` |
| `gs://$QUEUE_GCS_BUCKET/queue.json` | Production queue state when `QUEUE_GCS_BUCKET` is set. | `navigator/gcs-queue.ts`, `apps/api/src/modules/admin/navigator-approve.service.ts` |
| `gs://$QUEUE_GCS_BUCKET/hospitals.json` | Production approval target for hospital directory updates when `QUEUE_GCS_BUCKET` is set. | `navigator/gcs-queue.ts`, `apps/api/src/modules/admin/navigator-approve.service.ts` |
| `kb/en/99_local_navigation/hospital-directory.md` | KB markdown generated from the Git-tracked hospital JSON. | `scripts/sync-hospital-kb.ts` |

`hospital-directory.service.ts` first looks for `data/hospitals.json` in the API container, then falls back to `apps/landing/src/content/hospitals.json` for local development. It does not read GCS directly today. When the admin approval service runs with `QUEUE_GCS_BUCKET`, it reads and writes GCS objects first and fails hard if GCS is unavailable; without the bucket it uses local files.

## Manual Workflow

### 1. Research

```bash
npx ts-node navigator/cli.ts research "<region>"
```

Prints instructions and a JSON template for a hospital researcher. Each draft should include official name, city/state, hospital type, accreditation, departments, cost tier, PMJAY and NCG fields, contact details, doctors, navigation notes, sources, and confidence.

### 2. Add Drafts

```bash
npx ts-node navigator/cli.ts add /path/to/batch.json
```

Loads `{ "batch_id": "...", "hospitals": [...] }`, enforces a maximum of five hospitals, forces each hospital to `status: "draft"`, and sets the batch to `researched` in local `navigator/queue.json`.

### 3. Send For Review

```bash
npx ts-node navigator/cli.ts send <batch-id>
```

Generates an HMAC token from `NAVIGATOR_APPROVAL_SECRET` and the `batchId`, sends a review email to the configured reviewers in `navigator/hospital-mailer.ts`, and sets the batch to `email_sent`. The token and timestamp are saved even if SMTP fails. When `QUEUE_GCS_BUCKET` is set, `navigator/gcs-queue.ts` also writes `queue.json` to GCS.

`navigator/hospital-mailer.ts` currently hard-codes the production review base URL:

```text
https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/navigator/review
```

If the review portal is deployed under a different host, update that constant or make it env-driven before sending links.

### 4. Review And Edit

```http
GET /v1/admin/navigator/review/:batchId?token=<hmac>
PATCH /v1/admin/navigator/batch/:batchId/hospital/:hospitalId?token=<hmac>
```

The HTML review page is served by `apps/api/src/modules/admin/admin.controller.ts` and rendered by `navigator-review.html.ts`. Reviewers can edit name, short name, type, tier, score, confidence, accreditation, departments, cost tier, notes, navigation notes, key doctors, phone, address, website, NCG, PMJAY, and sources.

Navigator review routes are protected by the signed `token` query parameter, not `BasicAuthGuard`. `navigator-approve.service.ts` verifies the token with `timingSafeEqual`.

### 5. Approve

```http
GET /v1/admin/navigator/approve/:batchId?token=<hmac>
```

Approval requires `email_sent` status. The service:

1. Verifies the HMAC token.
2. Loads `queue.json` from GCS when configured, otherwise local files.
3. Converts each `HospitalDraft` to the full `hospitals.json` schema.
4. Appends entries to `hospitals.json`, updates `_meta.total_hospitals`, and sets `_meta.last_updated`.
5. Marks the batch `approved` with `approvedAt` and `approvedBy: "email_approval"`.

Approval is idempotent: a second approval of an already-approved batch returns a confirmation without duplicating hospitals.

## Scheduled Jobs

The scheduled automation uses the shared image built by `Dockerfile.navigator-research` and deployed by `cloudbuild.navigator-research.yaml`.

| Job | Script | State transition | Notes |
|---|---|---|---|
| `suchi-navigator-research` | `navigator/daily-researcher.ts` | `pending` -> `researched` -> `email_sent` | Calls Claude with `ANTHROPIC_API_KEY`, gates results through inclusion criteria, then sends the review email. |
| `suchi-navigator-sender` | `navigator/daily-sender.ts` | `researched` -> `email_sent` | Sends the next already-researched batch without a Claude call. |

Both jobs use `QUEUE_GCS_BUCKET=suchi-navigator-state` in the current Cloud Build config. The sender Scheduler example in `cloudbuild.navigator-research.yaml` runs at 10:00am IST (`30 4 * * *` UTC).

## Inclusion Gate And Scoring

`navigator/inclusion-criteria.ts` filters automated research before it can enter review. A draft must pass all three gates:

- At least one core oncology department, such as `medical_oncology`, `surgical_oncology`, `radiation_oncology`, `pediatric_oncology`, or `hemato_oncology`.
- At least two treatment modalities from the recognized department/modality list.
- At least one trust signal: recognized accreditation (`NABH`, `NABL`, `NCG_MEMBER`, `TMC_AFFILIATED`, `JCI`, `ISO`), `ncg_member: true`, or a government/AIIMS/ESIC type.

The gate also computes a rough 0-10 score for automatic tier estimation:

- Tier `A`: NCG member, TMC-affiliated, or score >= 7.
- Tier `B`: score >= 4.
- Tier `C`: score < 4 after passing all gates.

The published directory metadata still uses a 0-100 editorial scoring rubric in `hospitals.json` for quality, cost, location, PMJAY, risk flags, and future SCCF affiliation. Do not mix the two scores: the 0-10 gate score is for draft triage, while the 0-100 score is the public directory ranking signal used by `hospital-directory.service.ts`.

## Directory Consumption

`apps/api/src/modules/chat/hospital-directory.service.ts` loads the directory once at startup and performs deterministic filtering before LLM generation. Key constraints:

- Tier `D` hospitals are filtered out entirely.
- National referral centres (`national_referral: true`) are split from regional hospitals and appended only when appropriate.
- Filters are additive: city/state, cancer type departments, PMJAY, affordability, then score sort and max result limit.
- If no JSON file is found, the service logs a warning and lets navigation queries fall back to KB markdown.
- Newly approved GCS entries are not reloaded by chat automatically; the API process loads the staged JSON once at startup.

After changing the Git-tracked hospital JSON, run:

```bash
npx ts-node scripts/sync-hospital-kb.ts
```

Use `--dry-run` to preview `kb/en/99_local_navigation/hospital-directory.md` without writing it.

## Batch States

| Status | Meaning |
|---|---|
| `pending` | Batch exists in `queue.json`; research has not been added yet. |
| `researched` | Draft hospitals are attached and ready for email. |
| `email_sent` | Review email was attempted and an approval token is stored. |
| `approved` | Hospitals were merged into `hospitals.json`; repeat approvals are no-ops. |
| `rejected` | Reserved/manual state; not used by the automated flow. |

## Key Files

| File | Purpose |
|---|---|
| `navigator/cli.ts` | Manual `research`, `add`, `send`, and `status` commands. |
| `navigator/daily-researcher.ts` | Scheduled pending-batch researcher and email sender. |
| `navigator/daily-sender.ts` | Scheduled email sender for already-researched batches. |
| `navigator/inclusion-criteria.ts` | Automated hospital eligibility gate and draft tier estimator. |
| `navigator/hospital-mailer.ts` | HTML review email, reviewer list, review base URL, HMAC token generation. |
| `navigator/gcs-queue.ts` | GCS/local adapter for queue and hospital JSON used by navigator scripts. |
| `apps/api/src/modules/admin/navigator-approve.service.ts` | Review data, inline edits, approval logic, and API-side GCS persistence. |
| `apps/api/src/modules/admin/navigator-review.html.ts` | Inline review portal HTML and client-side edit form. |
| `apps/api/src/modules/admin/admin.controller.ts` | Review, edit, and approve routes under the global `/v1` prefix. |
| `apps/api/src/modules/chat/hospital-directory.service.ts` | Runtime hospital search used by chat planning before LLM generation. |
| `scripts/sync-hospital-kb.ts` | Regenerates the KB hospital markdown from `apps/landing/src/content/hospitals.json`. |
| `cloudbuild.navigator-research.yaml` | Builds and deploys Navigator Cloud Run Jobs. |

## Environment Variables

| Variable | Description |
|---|---|
| `NAVIGATOR_APPROVAL_SECRET` | HMAC secret for review and approval tokens. Defaults to `suchi-nav-dev-secret` if unset. |
| `QUEUE_GCS_BUCKET` | GCS bucket for production `queue.json` and `hospitals.json`. If unset, local files are used. |
| `QUEUE_GCS_OBJECT` | GCS queue object key. Defaults to `queue.json`. |
| `HOSPITALS_GCS_OBJECT` | GCS hospital directory object key. Defaults to `hospitals.json`. |
| `ANTHROPIC_API_KEY` | Required by `daily-researcher.ts` to call Claude. |
| `NAVIGATOR_SCRIPT` | Selects the script inside the shared job image, such as `daily-researcher.ts` or `daily-sender.ts`. |
| `SMTP_PASS` | SMTP password for outbound review email. `hospital-mailer.ts` checks the env var first, then Secret Manager. |
| `SMTP_HOST` | SMTP host. Defaults to `smtp.gmail.com`. |
| `SMTP_USER` | SMTP sender. Defaults to `gautamgauri@dikshafoundation.org`. |
