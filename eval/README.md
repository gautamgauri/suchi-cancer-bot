# Suchi Eval Framework

This package runs API-level quality evaluation for Suchi Cancer Bot. It is the canonical place for:

- Test suite execution (`run`, `voice-e2e`, `voice-transcript`)
- Release gating (`release-gate`)
- Judge stability analysis (`judge-compare`)
- Automated repair loop experiments (`autoresearch`)

## What This Covers

- Intent: Verify safety, grounding, citations, completeness, and multilingual/voice quality before deployment.
- Scope: The `eval` folder only (CLI, evaluators, rubrics, case packs, gate logic).
- Non-goals: Web UI testing and backend business logic changes.

## Architecture At A Glance

- Entry point: `eval/cli.ts`
- Core pipeline: `eval/runner/evaluator.ts` + `eval/runner/report-generator.ts`
- Gold release gate: `eval/runner/release-gate.ts`
- Voice transcript path testing: `eval/runner/voice-transcript-eval.ts`
- Judge agreement tooling: `eval/runner/judge-validator.ts`
- Autoresearch loop: `eval/autoresearch/autoresearch-runner.ts`

## Setup

```bash
cd eval
npm install
```

Required for LLM-judged checks (most workflows):

- `DEEPSEEK_API_KEY` (or Secret Manager secret `deepseek-api-key`)

Common optional overrides:

- `EVAL_API_BASE_URL` (defaults to `config/default.json`)
- `EVAL_AUTH_BEARER`
- `EVAL_LLM_PROVIDER` (`deepseek`, `openai`, `vertex_ai`)
- `EVAL_FALLBACK_LLM_PROVIDER`

## Primary Commands

Run via `ts-node` (recommended during development):

```bash
npx ts-node cli.ts <command> [options]
```

### 1) Run YAML case suites

```bash
npx ts-node cli.ts run \
  --cases cases/tier1/retrieval_quality.yaml \
  --output reports/tier1-report.json \
  --summary
```

Useful filters:

- `--case <id>`
- `--tier <number>`
- `--cancer <type>`
- `--intent <type>`
- `--batch-size <n>`

### 2) Run release gate on gold pack

Runs all sets defined in `cases/gold/manifest.json` and evaluates threshold + regression gates.

```bash
npx ts-node cli.ts release-gate \
  --api-url http://localhost:3001/v1 \
  --output reports/release-gate-report.json
```

Save new baseline only after a passing deploy verdict:

```bash
npx ts-node cli.ts release-gate --save-baseline
```

Behavior:

- Exit code `0` when verdict is `DEPLOY`
- Exit code `1` when verdict is `BLOCK`

### 3) Compare judge agreement between reports

```bash
npx ts-node cli.ts judge-compare \
  --report-a reports/run-a.json \
  --report-b reports/run-b.json \
  --output reports/judge-agreement \
  --format both
```

Writes `.json` and `.md` agreement reports when `--format both`.

### 4) Voice transcript evaluation

Exercises the same text path used after Web Speech transcription (`POST /v1/chat`).

```bash
npx ts-node cli.ts voice-transcript \
  --cases cases/voice/voice_transcript_cancer_queries.yaml \
  --output reports/voice-transcript-report.json \
  --summary
```

### 5) Voice end-to-end evaluation

Runs voice fixture/synthetic audio flow over HTTP, WebSocket, or both.

```bash
npx ts-node cli.ts voice-e2e \
  --cases cases/voice/voice_e2e_cases.yaml \
  --rubrics rubrics/voice-rubrics.v1.json \
  --transport http \
  --synthetic \
  --output reports/voice-e2e-report.json \
  --summary
```

### 6) Autoresearch loop (bounded self-improvement)

```bash
npx ts-node cli.ts autoresearch \
  --target all \
  --max-iterations 3 \
  --api-url http://localhost:3001/v1 \
  --cases cases/gold/core_safety.yaml \
  --rubrics rubrics/rubrics.v1.json \
  --manifest ../repairable/manifest.json
```

Dry-run mode (no patch apply/eval):

```bash
npx ts-node cli.ts autoresearch --dry-run
```

## Gold Pack And Gate Thresholds

- Gold set manifest: `eval/cases/gold/manifest.json`
- Release gate thresholds: `eval/autoresearch/config/gate-thresholds.json`
- Baseline file for regression checks: `eval/autoresearch/baselines/latest.json`

Current release gate includes:

- P0 safety failures (`== 0`)
- Citation coverage
- Disclaimer correctness
- Language/voice pass rate
- Overall pass rate
- Regression guard vs baseline

## Autoresearch Constraints (Important)

- Hard iteration cap: `3` per run.
- Patch scope is restricted to files listed in `repairable/manifest.json`.
- Safety/rubric/database surfaces are intentionally out of repair scope.
- Accepted experiments are archived under `eval/autoresearch/experiments/`.
- Human approval is required before merge/deploy of autoresearch-produced changes.

## Output Artifacts

- Standard eval report: path passed to `--output` (JSON)
- Release gate report: includes gate verdict + embedded eval report
- Judge compare: agreement JSON/Markdown outputs
- Autoresearch experiment logs: `eval/autoresearch/experiments/*.json`

## Common Pitfalls And Troubleshooting

- `0 cases executed`:
  - Cause: filters did not match any cases.
  - Fix: re-run without filters or use canonical values shown in preflight output.

- LLM judge checks skipped:
  - Cause: missing `DEEPSEEK_API_KEY` (or unavailable provider credentials).
  - Fix: export key or configure Secret Manager before running eval.

- Release gate blocks unexpectedly:
  - Check per-gate rows in the report.
  - Compare with prior baseline; regression gate can block even when absolute score seems acceptable.

- Wrong target API:
  - `config/default.json` may point to a remote URL.
  - Set `EVAL_API_BASE_URL` or pass `--api-url` explicitly.
