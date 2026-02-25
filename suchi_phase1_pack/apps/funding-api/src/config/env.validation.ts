import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().optional(),
  NODE_ENV: z.string().optional(),
  FUNDING_OPENAI_API_KEY: z.string().min(1),
  FUNDING_OPENAI_BASE_URL: z.string().url().optional(),
  FUNDING_MODEL_DRAFT: z.string().optional().default("deepseek-chat"),
  FUNDING_MODEL_EVAL: z.string().optional(),
  FUNDING_LLM_TIMEOUT_MS: z.coerce.number().optional().default(45000),
  FUNDING_LLM_MAX_RETRIES: z.coerce.number().min(0).max(5).optional().default(2),
  FUNDING_LLM_RETRY_DELAY_MS: z.coerce.number().min(100).max(30000).optional().default(1500),
  // DB-first pipeline (required for pipeline/activity)
  DATABASE_URL: z.string().min(1),
  // Google Sheets export-only (optional; for one-way export from DB)
  FUNDING_SHEETS_SPREADSHEET_ID: z.string().optional(),
  FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FUNDING_SHEETS_PIPELINE_TAB: z.string().optional().default("Pipeline"),
  FUNDING_SHEETS_ACTIVITIES_TAB: z.string().optional().default("Activities"),
  FUNDING_EXPORT_TOKEN: z.string().optional(),
  FUNDING_WRITE_APPROVAL_TOKEN: z.string().optional(),
  // Evidence library (Phase 1) — optional; required only when running ingestion
  EVIDENCE_DRIVE_FOLDER_ID: z.string().optional(),
  FUNDING_DRIVE_ARCHIVE_ROOT_ID: z.string().optional(),
  EVIDENCE_CUTOFF_IST: z.string().optional(),
  EVIDENCE_MIME_ALLOWLIST: z.string().optional(),
  EVIDENCE_STORAGE_DIR: z.string().optional(), // local temp dir for raw files; if unset uses os.tmpdir()/evidence
  // Phase 2: embeddings (optional; required for embedding pipeline)
  // Split provider: embeddings can use different API than LLM (e.g., Google Gemini for embeddings, Deepseek for generation)
  FUNDING_EMBEDDING_PROVIDER: z.enum(["google", "openai"]).optional().default("google"), // "google" = Gemini, "openai" = OpenAI
  FUNDING_EMBEDDINGS_API_KEY: z.string().optional(), // Falls back to FUNDING_OPENAI_API_KEY if not set
  FUNDING_EMBEDDINGS_BASE_URL: z.string().url().optional(), // Falls back to OpenAI default if not set (only for openai provider)
  EVIDENCE_EMBEDDING_MODEL: z.string().optional().default("gemini-embedding-001"), // Google: gemini-embedding-001, OpenAI: text-embedding-3-small
  EVIDENCE_EMBEDDING_RATE_LIMIT_PER_MIN: z.coerce.number().min(1).max(1000).optional().default(60),
  // Funding Bot: Gmail intake (optional; required when running email ingestion)
  FUNDING_GMAIL_USER: z.string().email().optional(),
  FUNDING_GMAIL_TOPIC: z.string().optional(),
  FUNDING_GMAIL_SUBSCRIPTION: z.string().optional(),
  // Funding Bot: Default owner/reviewer config (optional; prevents hardcoded PII)
  // Format for owner: "Name|email@domain.com|Role"
  // Format for reviewers: "Name1|email1|Role1,Name2|email2|Role2"
  FUNDING_ORG_NAME: z.string().optional(),
  FUNDING_DEFAULT_OWNER: z.string().optional(),
  FUNDING_DEFAULT_REVIEWERS: z.string().optional(),
  // Funding Bot: Slack notifications (optional; for proposal generation alerts)
  FUNDING_SLACK_WEBHOOK_URL: z.string().url().optional(),
  FUNDING_SLACK_CHANNEL: z.string().optional().default("#funding-bot"),
  // Delivery guard contracts (comma-separated allowlists; optional for backward compatibility)
  FUNDING_ALLOWED_SLACK_CHANNEL_IDS: z.string().optional().default("*"),
  FUNDING_ALLOWED_EMAIL_RECIPIENTS: z.string().optional().default(""),
  FUNDING_ALLOWED_EMAIL_DOMAINS: z.string().optional().default("dikshafoundation.org"),
  FUNDING_BLOCK_EXTERNAL_DELIVERY: z.string().optional().default("true"),
  FUNDING_STALLED_PROSPECT_DAYS: z.coerce.number().min(1).max(180).optional().default(30),
  FUNDING_STALLED_NUDGE_ENABLED: z.string().optional().default("false"),
  // Funder scraper (TFIx / BDC): SerpAPI + HTML scraping
  FUNDING_SERPAPI_KEY: z.string().optional(),
  FUNDING_FUNDER_SCRAPER_ENABLED: z.string().optional(), // "true" to enable
  FUNDING_FUNDER_SCRAPER_MAX_ORGS_PER_RUN: z.coerce.number().min(1).max(5).optional().default(2),
});
