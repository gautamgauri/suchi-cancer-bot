# Funding Eval Pack

Functionality evaluation for the Funding API: citation coverage, abstain correctness, latency, CRUD, safety (no fabrication), and placeholder compliance. Aligned to the Funding Bot BRD (`../docs/product/funding-bot/requirements.md`).

## Setup

```bash
npm install
```

## Run

```bash
# Start funding-api (e.g. on port 3001), then run a single case file:
npx tsx cli.ts run --api-url http://localhost:3001 --cases cases/need_statement_sample.yaml --summary --output funding-eval-report.json

# Run all default case files (full functionality evaluation):
npx tsx cli.ts run --api-url http://localhost:3001 --batch --summary --output funding-eval-report.json
```

### Options

- `--api-url` (required): Base URL of funding-api (e.g. `http://localhost:3001`)
- `--cases`: Path to a single YAML cases file (default: `cases/need_statement_sample.yaml`)
- `--batch`: Run all default case files and aggregate one report (see Case files below)
- `--output`: Output JSON report path (default: `funding-eval-report.json`)
- `--summary`: Print summary to console
- `--fail-on-regression`: Exit with code 1 if any case fails (for CI)
- `--timeout`: Request timeout in ms (default: 60000)
- `--export-token`: Optional Bearer token for evidence-ingest endpoints (when API has `FUNDING_EXPORT_TOKEN` set)

## Case files (full coverage)

| File | Coverage |
|------|----------|
| `cases/need_statement_sample.yaml` | Need statement draft, refine, abstain |
| `cases/pipeline_cases.yaml` | Pipeline list, create, get, update (PIPE-01–04) |
| `cases/activity_cases.yaml` | Activity log with/without `createdBy`, validation, get activities (ACT-01–04) |
| `cases/email_draft_cases.yaml` | Template email, evidence-backed email, no fabrication (EMAIL-01–03) |
| `cases/donor_profile_cases.yaml` | Donor profile with URLs, without URLs, with chunks (DONOR-01–03) |
| `cases/opportunity_cases.yaml` | Opportunity list, create, update (OPP-01–04) |
| `cases/proposal_cases.yaml` | Proposal generate, get run, get gaps (PROP-01–04) |
| `cases/framework_cases.yaml` | Framework retrieve, recommend methods, consistency check, MEL pack (FW-01–04) |
| `cases/evidence_cases.yaml` | Evidence retrieve, eval (EV-01–03) |
| `cases/approvals_cases.yaml` | Approvals artifact, version, submit, get pending (APPR-01–04) |
| `cases/safety/abstain_cases.yaml` | Abstain when no evidence (ABSTAIN-01–03) |
| `cases/safety/fabrication_cases.yaml` | Placeholder compliance, expect 400 (FAB-01, LLM-01, FAB-02) |

With `--batch`, the CLI runs the above files in order and merges results into a single report.

## Case format (YAML)

### Draft / evidence-backed

```yaml
cases:
  - id: NS-01
    type: need_statement | need_statement_refine | donor_profile
    context: "..."
    userMessage: "..."   # for need_statement / need_statement_refine
    chunks: []           # optional; empty => expect abstain when expect_abstain: true
    conversationContext: { funderName?: "", intent?: "", checklist?: "" }
    expectations:
      min_citations: 1
      expect_abstain: false
```

### CRUD / API (params and body; refs)

```yaml
cases:
  - id: PIPE-02
    type: pipeline_crud
    action: create
    body:
      orgName: "Test Org"
      stage: "lead"
  - id: PIPE-03
    type: pipeline_crud
    action: get
    params:
      id: "$ref:PIPE-02.id"
```

Use `$ref:CASE_ID.path` in `params` or `body` to reference the response of a previous case in the same file (e.g. `$ref:PIPE-02.id`, `$ref:PROP-01.runId`).

### Case types

- `need_statement`, `need_statement_refine`, `donor_profile` — drafting
- `email_draft` — template/evidence-backed email
- `pipeline_crud` — action: `list` \| `create` \| `get` \| `update`
- `activity_log` — action: `log` \| `log_with_createdBy` \| `require_donor_or_org` \| `get_activities`
- `opportunity_intake` — action: `list` \| `create` \| `update` \| `ingest_from_email`
- `proposal_generate` — action: `generate` \| `get_run` \| `get_gaps`
- `framework_retrieve` — action: `retrieve` \| `recommend_methods` \| `check_consistency` \| `generate_mel_pack`
- `evidence_retrieve` — action: `retrieve` \| `eval`
- `approvals` — action: `create_artifact` \| `create_version` \| `submit_approval` \| `get_pending`
- `safety` — action: `expect_400` (validation hardening)

## Metrics

- **Citation coverage rate**: Fraction of need_statement / need_statement_refine cases where `citationCount >= min_citations`.
- **Abstain correctness rate**: Fraction of cases where the model correctly abstains (when `expect_abstain: true`) or does not abstain (when false).
- **CRUD success rate**: Fraction of pipeline, activity, opportunity, and approvals cases that passed.
- **Placeholder compliance**: Fraction of email_draft cases with required placeholders (e.g. “(insert metric)”).
- **Fabrication safety rate**: Fraction of non-evidence email drafts that use placeholders or citations (no invented metrics).
- **Latency**: p50, p95, mean in ms.

## CI gate (EVAL-003)

Use `--fail-on-regression` in CI:

```yaml
# Single suite
- name: Funding Eval
  run: |
    cd funding-eval
    npm ci
    npx tsx cli.ts run --api-url ${{ env.FUNDING_API_URL }} --cases cases/need_statement_sample.yaml --output report.json --fail-on-regression

# Full functionality (batch)
- name: Funding Eval (full)
  run: |
    cd funding-eval
    npm ci
    npx tsx cli.ts run --api-url ${{ env.FUNDING_API_URL }} --batch --output report.json --fail-on-regression
```

Set regression thresholds by parsing `report.json` (e.g. `citationCoverageRate >= 0.8`, `abstainCorrectnessRate >= 1`, `crudSuccessRate >= 1`).
