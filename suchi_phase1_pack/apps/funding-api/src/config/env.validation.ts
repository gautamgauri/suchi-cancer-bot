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
  // Evidence library (Phase 1) — optional; required only when running ingestion
  EVIDENCE_DRIVE_FOLDER_ID: z.string().optional(),
  EVIDENCE_CUTOFF_IST: z.string().optional(),
  EVIDENCE_MIME_ALLOWLIST: z.string().optional(),
  EVIDENCE_STORAGE_DIR: z.string().optional(), // local temp dir for raw files; if unset uses os.tmpdir()/evidence
  // Phase 2: embeddings (optional; required for embedding pipeline)
  EVIDENCE_EMBEDDING_MODEL: z.string().optional().default("text-embedding-3-small"),
  EVIDENCE_EMBEDDING_RATE_LIMIT_PER_MIN: z.coerce.number().min(1).max(1000).optional().default(60),
});
