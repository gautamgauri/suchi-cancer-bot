# Suchi Cancer Bot

Cancer information assistant with safety guardrails, KB-backed RAG responses, voice input, a WhatsApp channel and feedback collection.

**This repository is public.** Never commit secrets, personal names, email addresses, phone numbers, conversation text or user data. Never paste them into issues or pull requests.

Read these before changing anything.

- `AGENTS.md` holds the binding rules for agents. It covers safety boundaries, conventions and scope.
- `docs/OPERATIONS.md` is the runbook. It covers deploy, rollback, outages, secrets, migrations and evaluation.

## Project Structure

```
apps/api/          NestJS backend (the main codebase)
  src/modules/     Feature modules (chat, voice, voice-ws, rag, safety, llm, whatsapp, admin, ...)
  src/config/      Env validation, app config
  src/common/      Shared utilities, guards, filters
  prisma/          Schema and migrations (PostgreSQL + pgvector)
apps/web/          React + Vite chat UI
apps/landing/      Astro site with articles and the hospital directory (hospitals.json lives here)
eval/              Evaluation framework (cases, runner, rubrics, autoresearch); entry point cli.ts
evals/             Older eval dataset used by /eval-loop
kb/                Knowledge base manifest. Most article files are gitignored.
navigator/         Hospital directory research pipeline
content/           Article pipeline and drafts for the landing site
distribution/      Social post pipeline
repairable/        Chat prompts open to autoresearch patches
docs/              Architecture, operations, requirements, clinical policy
scripts/           Ingestion pipelines, CI checks, operational scripts
```

## Key Commands

```bash
# API
cd apps/api && npm run dev                         # API on :3001, routes under /v1
cd apps/api && npm run build
cd apps/api && npx jest                            # full unit suite, no database needed
cd apps/api && npx jest --testPathPatterns=<name>  # jest 30 flag (plural)
cd apps/api && npx prisma generate

# Web
cd apps/web && npm run dev                         # UI on :3000

# Eval
cd eval && npx ts-node cli.ts --help               # lists subcommands; no subcommand runs nothing
cd eval && npm test                                # unit tests, no network
cd eval && npm run eval:tier1                      # sends real requests to an API; read docs/OPERATIONS.md section 8 first

# CI checks
python3 scripts/check_deploy_config_parity.py
python3 scripts/check_no_secret_literals.py
```

Migrations. `prisma migrate dev` fails against the production database. Follow `docs/OPERATIONS.md` section 6.

Deploys. Cloud Build with `cloudbuild.yaml` is the only deployer of the API, and a deploy is the maintainer's decision. Follow `docs/OPERATIONS.md` section 4.

## Conventions

- API modules follow the NestJS pattern of `*.module.ts`, `*.service.ts` and `*.controller.ts`
- Tests use Jest and live beside source files as `*.spec.ts`
- Environment validation is in `apps/api/src/config/env.validation.ts`
- All API endpoints are prefixed with `/v1`, set once in `apps/api/src/main.ts`
- Gemini is the only live LLM provider
- Never bypass the safety module. Never return medical advice without KB backing.

## Git safety (mandatory preflight)

Before ANY destructive git command (`reset --hard`, `clean -f/-fd`, `checkout`/`restore` that discards changes, `branch -D`, `stash drop`, force-push) you MUST:

1. Run `git status --short`.
2. If there are uncommitted or untracked changes, **preserve them first**. Commit to a temporary WIP branch, use `git stash`, or save a patch (`git diff > /tmp/wip.patch`).
3. Only then run the destructive command.

Never run a destructive git command on a dirty working tree without preserving the work first. This rule was added after uncommitted work was lost to an unguarded `git reset --hard`.

## GCP Project

- Project: `gen-lang-client-0202543132`
- Service account: `suchi-scheduler@gen-lang-client-0202543132.iam.gserviceaccount.com`
- Cloud Run service: `suchi-api`
