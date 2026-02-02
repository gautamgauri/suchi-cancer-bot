import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().optional(),
  NODE_ENV: z.string().optional(),
  FUNDING_OPENAI_API_KEY: z.string().min(1),
  FUNDING_OPENAI_BASE_URL: z.string().url().optional(),
  FUNDING_MODEL_DRAFT: z.string().optional().default("deepseek-chat"),
  FUNDING_MODEL_EVAL: z.string().optional(),
  FUNDING_LLM_TIMEOUT_MS: z.coerce.number().optional().default(45000),
  // DB-first pipeline (required for pipeline/activity)
  FUNDING_DATABASE_URL: z.string().min(1),
  // Google Sheets export-only (optional; for one-way export from DB)
  FUNDING_SHEETS_SPREADSHEET_ID: z.string().optional(),
  FUNDING_GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FUNDING_SHEETS_PIPELINE_TAB: z.string().optional().default("Pipeline"),
  FUNDING_SHEETS_ACTIVITIES_TAB: z.string().optional().default("Activities"),
  FUNDING_EXPORT_TOKEN: z.string().optional(),
});
