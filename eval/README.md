# Suchi Eval Framework

This package contains the evaluation harness, rubric checks, voice evals, and the autoresearch quality loop for Suchi Cancer Bot.

## Entry Points

- `cli.ts`: `ts-node` CLI entry point.
- `runner/`: core evaluation, reporting, release-gate, and voice transcript runners.
- `cases/`: YAML eval suites grouped by tier, gold pack, voice, dynamic scenarios, and generated cases.
- `rubrics/`: scoring rubrics used by the evaluator and release gates.
- `autoresearch/`: failure mining, repair agents, patch generation, gatekeeping, archiving, and summary email.

## Setup

```bash
cd eval
npm install
```

For local API-backed evals, run the API first:

```bash
cd ../apps/api
npm run dev
```

Then run eval commands from `eval/`.

## Configuration

The evaluator loads defaults from `config/default.json`; CLI flags and environment variables override those defaults.

Common variables:

- `EVAL_API_BASE_URL`: API base URL; CLI `--api-url` overrides it for commands that expose that flag.
- `EVAL_LLM_PROVIDER`: `openai`, `deepseek`, or `vertex_ai`.
- `OPENAI_API_KEY`, `OPENAI_MODEL`: OpenAI judge configuration.
- `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_BASE_URL`: Deepseek judge/agent configuration.
- `GOOGLE_CLOUD_PROJECT`, `VERTEX_AI_LOCATION`, `VERTEX_AI_MODEL`: Vertex AI configuration.
- `EVAL_TIMEOUT_MS`, `EVAL_RETRIES`, `EVAL_PARALLEL`, `EVAL_MAX_CONCURRENCY`: request execution controls.
- `GEMINI_API_KEY`: preferred autoresearch agent key.
- `AUTORESEARCH_MODEL`: autoresearch agent model when using Gemini; defaults to `gemini-2.0-flash`.
- `SMTP_PASS`: optional summary email password; autoresearch can also load `SMTP_PASS` from Secret Manager.

Keep API keys in environment variables or Secret Manager, not committed config files. See `docs/SECRETS_SETUP.md` for Secret Manager setup.

## Core Eval Usage

Run a focused suite:

```bash
npx ts-node cli.ts run \
  --cases cases/tier1/zero_citation_regression.yaml \
  --output reports/zero-citation-regression.json \
  --summary
```

Run by case metadata:

```bash
npx ts-node cli.ts run --case SUCHI-T1-BREAST-GEN-01 --summary
npx ts-node cli.ts run --tier 1 --summary
npx ts-node cli.ts run --cancer breast --summary
npx ts-node cli.ts run --intent INFORMATIONAL_GENERAL --summary
```

Generate a text or JSON report from saved results:

```bash
npx ts-node cli.ts report --input reports/tier1-report.json --format text
```

Run release gates against an API:

```bash
npx ts-node cli.ts release-gate \
  --api-url http://localhost:3001 \
  --output reports/release-gate-report.json
```

Compare judge agreement between two reports:

```bash
npx ts-node cli.ts judge-compare \
  --before reports/baseline.json \
  --after reports/candidate.json
```

Run voice transcript eval:

```bash
npx ts-node cli.ts voice-transcript \
  --cases cases/voice/voice_transcript_cancer_queries.yaml \
  --output reports/voice-transcript.json \
  --summary
```

Run synthetic voice end-to-end eval:

```bash
npm run eval:voice
```

## Autoresearch Workflow

Autoresearch is the automated improvement loop in `autoresearch/`. It runs a baseline eval, mines failure clusters, routes each cluster to a repair agent, generates candidate patches, chooses a winner, evaluates the result when measurable, and archives an experiment log.

Main codepaths:

- `autoresearch/autoresearch-runner.ts`: orchestrates gold and voice modes.
- `autoresearch/failure-miner.ts`: converts eval reports into failure buckets.
- `autoresearch/triage-router.ts`: routes buckets to `prompt`, `kb`, or `config` repair agents.
- `autoresearch/researcher.ts`, `prompt-agent.ts`, `kb-agent.ts`, `patcher.ts`: generate hypotheses and patches for repairable files.
- `autoresearch/judge.ts`: runs an N-of-K pairwise tournament over valid candidate patches.
- `autoresearch/gatekeeper.ts`: enforces safety, citation, disclaimer, multilingual, overall, and voice gates.
- `autoresearch/archivist.ts`: writes experiment archives under `autoresearch/experiments/`.
- `autoresearch/summary-emailer.ts`: writes local HTML summaries and optionally sends email.

Run a dry run to inspect hypotheses and candidate diffs without git changes:

```bash
GEMINI_API_KEY=... npx ts-node cli.ts autoresearch \
  --target all \
  --mode gold \
  --max-iterations 2 \
  --dry-run \
  --api-url http://localhost:3001 \
  --cases cases/gold/core_safety.yaml \
  --rubrics rubrics/rubrics.v1.json \
  --manifest ../repairable/manifest.json
```

Run a measurable gold-mode loop:

```bash
GEMINI_API_KEY=... npx ts-node cli.ts autoresearch \
  --target all \
  --mode gold \
  --max-iterations 5 \
  --api-url http://localhost:3001 \
  --cases cases/gold/core_safety.yaml \
  --rubrics rubrics/rubrics.v1.json \
  --manifest ../repairable/manifest.json \
  --email engineer@example.org \
  --run-label manual
```

Use `--proposal-mode` only when the target API does not consume the patched files at runtime. In this mode, autoresearch still mines failures, generates up to four candidate patches per bucket, runs the pairwise judge, applies the winning patch, and archives the result, but it skips subset eval, full regression, and gates because the API would keep serving the same baseline behavior. Accepted proposal-mode branches require human review and are not evidence of quality improvement.

Nightly production autoresearch is configured by:

- `cloudbuild-autoresearch.yaml`: installs eval deps, installs git in `node:20-slim`, runs `cli.ts autoresearch --proposal-mode`, and best-effort pushes `autoresearch/*` branches.
- `scripts/setup-nightly-autoresearch.sh`: creates or checks the `autoresearch-nightly` Cloud Build trigger, Scheduler job, and Secret Manager access.

Operational constraints:

- The loop requires `GEMINI_API_KEY` or `DEEPSEEK_API_KEY`; Gemini is preferred when both are present.
- `--max-iterations` is capped in the runner to prevent unbounded nightly spend.
- A baseline pass rate below the runner floor aborts the run; check API reachability, keys, cases, and rubric compatibility before rerunning.
- Non-proposal mode accepts a patch only after subset improvement and full regression gate checks pass.
- Voice mode adds voice-readiness, word-count, and formatting no-regression gates while also checking gold eval quality.
- Do not auto-merge `autoresearch/*` branches; review `git diff main...<branch>` and the archived experiment JSON first.

## Test Case Format

YAML cases generally include:

- `id`: stable case identifier.
- `tier`: test tier, when applicable.
- `cancer`: cancer type or scenario area.
- `intent`: user intent category.
- `user_messages`: single-turn or multi-turn input messages.
- `expectations`: deterministic and judge-backed checks.

## Reports

Reports include summary counts, per-case scores, failed checks, evidence quotes, and aggregate metrics used by gates. Save them under `reports/`; generated reports and autoresearch archives should be treated as run artifacts unless intentionally promoted as baselines.

## Troubleshooting

API connection failures:

- Confirm the API is running and that `--api-url` includes the `/v1` prefix only when the command expects the full API base.
- Check auth with `--auth-bearer` if the target endpoint requires it.

LLM provider failures:

- For core evals, set the provider-specific key for the configured judge.
- For autoresearch, set `GEMINI_API_KEY` or `DEEPSEEK_API_KEY`; transient 429s are retried by `autoresearch/llm-retry.ts`.

Autoresearch produces no accepted branches:

- Inspect `autoresearch/experiments/*.json` for skipped reasons.
- In non-proposal mode, rejected patches are expected when subset cases do not improve or full regression gates fail.
- In proposal mode, confirm the patched files are listed in `repairable/manifest.json` and that git can create local branches.

Secret Manager or email failures:

- Confirm `GOOGLE_CLOUD_PROJECT` is set.
- Grant the runtime identity `roles/secretmanager.secretAccessor` for `gemini-api-key` and `SMTP_PASS`.

## Development Checks

```bash
npm run typecheck
npm run build
```

