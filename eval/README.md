# Eval Framework

This folder contains the evaluation harness for Suchi:
- case suites in `eval/cases`
- scoring logic in `eval/runner`
- CLI entrypoint in `eval/cli.ts`
- config loader in `eval/config/loader.ts`

## Prerequisites
- API reachable at `EVAL_API_BASE_URL` (default: `http://localhost:3001`)
- Node dependencies installed:
```bash
cd eval
npm install
```

## Canonical Commands

### 1. Core text eval
```bash
cd eval
npx ts-node cli.ts run \
  --cases cases/tier1/common_cancers_20_mode_matrix.yaml \
  --rubrics rubrics/rubrics.v1.json \
  --output reports/tier1-report.json \
  --summary
```

Useful filters:
- `--case <id>`
- `--tier <number>`
- `--cancer <type>`
- `--intent <type>`
- `--batch-size <n>` (writes incremental reports after each batch)

### 2. Voice E2E eval (`/v1/voice/respond` and optional WS)
```bash
npx ts-node cli.ts voice-e2e \
  --cases cases/voice/voice_e2e_cases.yaml \
  --rubrics rubrics/voice-rubrics.v1.json \
  --transport both \
  --synthetic \
  --output reports/voice-e2e-report.json \
  --summary
```

Notes:
- `--transport` supports `http`, `ws`, or `both`.
- WS tests require API started with `VOICE_WS_ENABLED=true`.
- `--synthetic` generates test audio via TTS; without it, fixture files are used.

### 3. Voice transcript eval (text channel with voice-like prompts)
```bash
npx ts-node cli.ts voice-transcript \
  --cases cases/voice/voice_transcript_cancer_queries.yaml \
  --output reports/voice-transcript-report.json \
  --summary
```

Optional:
- `--email <address>` sends transcript report email via eval emailer.

### 4. Release gate
```bash
npx ts-node cli.ts release-gate \
  --output reports/release-gate-report.json
```

Exit code is non-zero when verdict is `BLOCK`.

### 5. Judge agreement and optimization tools
```bash
npx ts-node cli.ts judge-compare \
  --report-a reports/tier1-report.json \
  --report-b reports/tier1-report-v5.json
```

```bash
npx ts-node cli.ts eval-optimize --dry-run
```

### 6. Autoresearch loop
```bash
npx ts-node cli.ts autoresearch \
  --target all \
  --mode gold \
  --api-url http://localhost:3001
```

Mode options:
- `gold`: uses gold pack cases
- `voice`: uses voice transcript cases

## Configuration

Default config is `eval/config/default.json`. Override with `--config` or env vars.

High-signal env vars:
- `EVAL_API_BASE_URL`: target API base URL
- `EVAL_AUTH_BEARER`: bearer token for protected targets
- `EVAL_LLM_PROVIDER`: `vertex_ai`, `openai`, or `deepseek`
- `EVAL_FALLBACK_LLM_PROVIDER`: optional fallback provider
- `EVAL_TIMEOUT_MS`: request timeout
- `EVAL_RETRIES`: retries for API calls
- `EVAL_PARALLEL`: run in parallel
- `EVAL_MAX_CONCURRENCY`: parallel worker count

Provider-specific:
- OpenAI: `OPENAI_API_KEY`, `OPENAI_MODEL`
- DeepSeek: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`
- Vertex AI: `GOOGLE_CLOUD_PROJECT`, `VERTEX_AI_LOCATION`, `VERTEX_AI_MODEL`

Secret Manager:
- Loader can pull from GCP Secret Manager when available.
- If API keys are already present in env vars, loader skips Secret Manager access.

## Output and Reporting

`run` writes incremental JSON report snapshots during execution, then finalizes the output file.

Report includes:
- suite metadata (`loaded`, `selected`, `executed`)
- pass/fail summary and average score
- per-case deterministic + judge checks
- failure breakdown

## Troubleshooting

### 1. Zero cases executed
- The CLI fails fast when filters select zero cases.
- Check canonicalized `--cancer` and `--intent` values in preflight output.

### 2. Repeated 504s / timeouts
- This generally indicates API latency issues rather than rubric logic.
- Try smaller `--batch-size`, lower parallelism, or warm up API first.

### 3. DeepSeek/OpenAI judge failures
- Confirm API key env vars are present for chosen provider.
- If using Vertex fallback, ensure `GOOGLE_CLOUD_PROJECT` is set.

### 4. Voice WS failures
- Ensure API runs with `VOICE_WS_ENABLED=true`.
- Confirm eval target URL matches the deployed WS namespace `/v1/voice/stream`.

### 5. Audio URL reachability failures in voice E2E
- Check API `GCS_BUCKET_TTS` access and signed URL expiry settings.

