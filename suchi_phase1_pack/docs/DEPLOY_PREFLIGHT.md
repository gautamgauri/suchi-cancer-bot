# Funding Bot — Deployment Checklist

> Derived from 46 fix commits and 7 critical incidents across 75 recent deployments.
> Last updated: 2026-03-01

---

## How to use

Run through each section **before** merging to `main` / triggering Cloud Build.
Mark items ✅ as you go. If any item fails, **stop and fix before deploying**.

---

## 1. Environment Variables & Secrets

_Root cause of 3 deployment failures (commits `9103870`, `8d35559`, `e8cbea8`)._

| # | Check | Why |
|---|-------|-----|
| 1.1 | All env vars in `.env.example` have corresponding Cloud Run / Secret Manager entries | `9103870` — gated deploy failed because 15+ vars were missing |
| 1.2 | `FUNDING_OPENAI_BASE_URL` matches the LLM provider you intend to use | `0a14207` — crash from OpenAI→Gemini migration left stale base URL |
| 1.3 | `FUNDING_EMBEDDING_PROVIDER` matches the embedding API key you set | Provider defaulted to `google` while `.env` had OpenAI key |
| 1.4 | `EVIDENCE_EMBEDDING_MODEL` outputs vectors matching DB column width (768-dim) | `fe8fd94` — `gemini-embedding-001` outputs 3072-dim, pgvector column is 768 |
| 1.5 | `FUNDING_GMAIL_USER` is the correct email address | `e8cbea8` — wrong user (`gautam@` vs `gautamgauri@`) |
| 1.6 | No hardcoded secrets or API keys in source code | Grep for `sk-`, `AIza`, `Bearer` in committed files |
| 1.7 | `FUNDING_LLM_TIMEOUT_MS` ≥ 45000 (or matches your LLM's p99 latency) | `542d605` — 45s was too low for full pipeline |

---

## 2. Database & Migrations

_Root cause of 2 deployment failures (commits `6027bbd`, `1a5a0ba`)._

| # | Check | Why |
|---|-------|-----|
| 2.1 | `npx prisma migrate status` shows no pending or failed migrations | `6027bbd` — stuck migration blocked entire deploy |
| 2.2 | No entries in `_prisma_migrations` with `finished_at = NULL` | Stuck migrations must be cleaned up manually |
| 2.3 | Cloud Run Job flag is `--set-cloudsql-instances` (not `--add-cloudsql-instances`) | `1a5a0ba` — wrong flag for Cloud Run Jobs vs Services |
| 2.4 | If adding a pgvector column, verify `CREATE EXTENSION vector` exists in the target DB | Missing extension → silent migration failure |
| 2.5 | New migrations tested locally with `prisma migrate deploy` (not `dev`) | `dev` generates drift; `deploy` is what runs in prod |

---

## 3. Embedding & RAG Pipeline

_Root cause of 4 critical failures (commits `0a14207`, `fe8fd94`, `52a0463`, `1d65f14`)._

| # | Check | Why |
|---|-------|-----|
| 3.1 | Embedding model output dimensions = pgvector column width (768) | `fe8fd94` — dimension mismatch → all embeddings silently rejected |
| 3.2 | After model change: re-embed ALL chunks (old vectors are incompatible) | `8fd970c` — zero retrieval after migration because old embeddings remained |
| 3.3 | `embedPendingChunks` filters out empty/whitespace-only chunks before batching | `1d65f14` — one empty chunk poisons entire batch of 100 |
| 3.4 | `canonicalDocId` filter uses the same ID format as the ingest manifest | `52a0463` — manifest uses string IDs, filter expected UUIDs → 513 docs skipped |
| 3.5 | Run gold retrieval queries after embedding and verify top-5 recall ≥ 0.6 | Catches silent embedding failures before users hit zero-evidence proposals |
| 3.6 | If switching embedding provider: update provider, model, API key, AND base URL together | `0a14207` — partial migration left inconsistent config |

---

## 4. LLM & Prompt Behaviour

_Root cause of 3 failures (commits `b234e18`, `5eb565d`, `12775e1`)._

| # | Check | Why |
|---|-------|-----|
| 4.1 | Budget sections use deterministic rendering, not LLM generation | `b234e18` — LLM hallucinated ₹42L when envelope was ₹95L |
| 4.2 | No hardcoded example org/project names in prompts | `5eb565d` — "Gully Goal" leaked into unrelated proposals |
| 4.3 | LLM responses are post-processed to strip raw KB document titles | `12775e1` — LLM dumped internal doc titles verbatim |
| 4.4 | Citation markers are stripped from voice/audio responses | `79998b7` — `[citation:xxx]` tokens read aloud by TTS |
| 4.5 | If the LLM model changes, re-run the eval suite and compare section-level scores | Model changes affect voice, tone, instruction-following |

---

## 5. Budget Engine

_Root cause of 2 high-impact failures (commits `b4dd138`, `b234e18`)._

| # | Check | Why |
|---|-------|-----|
| 5.1 | Budget template line items include ALL cost categories (rent, digital, coaches, M&E) | `b4dd138` — KHEL budget was ₹11L/centre, should be ₹30L+ |
| 5.2 | Unit cost benchmarks are current (check salary bands vs market) | Stale benchmarks: Fellow Teacher was 12k, market is 18k |
| 5.3 | `minGrantAmountINR` floor is set on opportunity if applicable | Prevents the engine from producing unrealistically low budgets |
| 5.4 | Org ask ceiling + size mismatch gate is active for the opportunity | `fb08579` — pre-flight gate catches ask > org capacity |
| 5.5 | Generate a test proposal and verify budget total is within ±15% of manual estimate | Catches formula errors before donor sees the output |

---

## 6. Build & TypeScript

_Root cause of 2 failures (commits `933624c`, `6cae88a`)._

| # | Check | Why |
|---|-------|-----|
| 6.1 | `npm run build` succeeds locally before pushing | `933624c` — Playwright dynamic import caused TS errors in Cloud Build |
| 6.2 | Optional dependencies (Playwright, sharp, etc.) use dynamic `import()` with `@ts-ignore` | Static imports fail when the package isn't installed in the container |
| 6.3 | Prisma `InputJsonValue` casts are correct on all JSON column writes | `6cae88a`, `b57323f` — type casting errors in 2 consecutive fix commits |
| 6.4 | Docker build tested locally: `docker build -f apps/funding-api/Dockerfile .` | Catches dependency resolution issues before Cloud Build |

---

## 7. Routing & API Surface

_Root cause of 2 failures (commits `a22f794`, `5c39738`)._

| # | Check | Why |
|---|-------|-----|
| 7.1 | No doubled route prefixes (`/v1/v1/...`) | `a22f794` — orchestrator endpoints unreachable; `5c39738` — application module same issue |
| 7.2 | New controllers: verify `@Controller()` prefix + global prefix don't stack | NestJS global prefix + controller prefix = double prefix |
| 7.3 | Health endpoints (`/live`, `/ready`, `/v1/health`) respond 200 after local startup | Cloud Run health checks will restart the container if these fail |
| 7.4 | Smoke-test every new endpoint with `curl` before deploying | Catches routing + middleware issues early |

---

## 8. Security

_Root cause of 1 critical fix (commit `5c39738`)._

| # | Check | Why |
|---|-------|-----|
| 8.1 | External URL fetching validates HTTPS-only, rejects localhost/metadata endpoints | `5c39738` — SSRF vulnerability in `fetchPageContent` |
| 8.2 | Slack webhook endpoints verify HMAC-SHA256 signature | `5c39738` — no signature check → anyone could trigger actions |
| 8.3 | All user-facing inputs have DTO validation (`class-validator`) | `5c39738` — missing input validation on application endpoints |
| 8.4 | Browser/Playwright instances are closed in `finally` blocks | `5c39738` — browser only closed on error path → resource leak |
| 8.5 | `FUNDING_BLOCK_EXTERNAL_DELIVERY=true` in prod unless explicitly needed | Prevents accidental email/Slack to external parties |

---

## 9. CI/CD Pipeline

_Root cause of 3 failures (commits `9103870`, `86a6266`, `7ae2d25`)._

| # | Check | Why |
|---|-------|-----|
| 9.1 | Cloud Build source includes all directories referenced by the build | `86a6266` — `eval/` directory excluded from gated build source |
| 9.2 | Output/report directories exist before scripts write to them | `7ae2d25` — eval failed because `eval/reports/` didn't exist |
| 9.3 | `cloudbuild.funding.yaml` substitution variables match Secret Manager names | Mismatch → container starts with empty secrets |
| 9.4 | Build timeout ≥ 1200s (20 min) for full funding pipeline | API build + migration + deploy takes 10-15 min |
| 9.5 | If eval is gated: verify eval passes BEFORE merging (don't rely on post-merge gate alone) | Gated deploy can block prod for hours if eval fails |

---

## 10. Timeout & Performance

_Root cause of 3 failures (commits `542d605`, `a947b4d`, performance doc)._

| # | Check | Why |
|---|-------|-----|
| 10.1 | Cloud Run service timeout ≥ 300s | Proposal generation can take 2-4 min for complex RFPs |
| 10.2 | LLM timeout ≥ 45s (120s for proposal sections) | `542d605` — voice pipeline timed out at 45s |
| 10.3 | Overall request timeout wrapper exists (e.g., `Promise.race`) | Performance doc — second query hung for 15s+ with no timeout |
| 10.4 | Eval client timeout matches or exceeds service timeout | `a947b4d` — eval client timed out before service did |
| 10.5 | If Cloud Run `min-instances=0`: first request after cold start tested for latency | Cold starts add 5-15s; first proposal may timeout |

---

## Pre-deploy Summary Checklist (Quick Reference)

```
[ ] 1. npm run build succeeds
[ ] 2. npm run test passes
[ ] 3. docker build succeeds locally
[ ] 4. prisma migrate status clean (no stuck/pending)
[ ] 5. .env vars match cloudbuild.funding.yaml substitutions
[ ] 6. Embedding model dimensions = 768
[ ] 7. No hardcoded examples in prompts
[ ] 8. Budget template line items complete
[ ] 9. Route prefixes not doubled
[ ] 10. Health endpoints respond 200
[ ] 11. Generate one test proposal end-to-end
[ ] 12. Gold retrieval queries return relevant results
[ ] 13. Eval suite passes (if gated deploy)
```

---

## Incident Log (for reference)

| Date | Severity | Commit | Category | Issue |
|------|----------|--------|----------|-------|
| Feb 27 | HIGH | `b234e18` | LLM | Budget hallucination (₹42L vs ₹95L envelope) |
| Feb 27 | HIGH | `b4dd138` | Budget | KHEL underestimated 65% (₹11L vs ₹30L/centre) |
| Feb 26 | CRITICAL | `fe8fd94` | Embedding | Dimension mismatch (3072 vs 768) → zero retrieval |
| Feb 26 | HIGH | `52a0463` | Embedding | Canonical filter type mismatch → 513 docs skipped |
| Feb 26 | MEDIUM | `1d65f14` | Embedding | Empty chunk poisons batch of 100 |
| Feb 26 | CRITICAL | `5c39738` | Security | SSRF, missing auth, browser leak (9 issues) |
| Feb 25 | HIGH | `0a14207` | Embedding | OpenAI→Gemini migration crash |
| Feb 21 | CRITICAL | `9103870` | CI/CD | 15+ missing env vars in gated deploy |
| Feb 17 | MEDIUM | `6027bbd` | Migration | Stuck migration blocked deploy |
| Feb 17 | MEDIUM | `1a5a0ba` | CI/CD | Wrong Cloud Run Job flag |
