import { z } from "zod";
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_BASIC_USER: z.string().min(1),
  ADMIN_BASIC_PASS: z.string().min(1),
  // LLM Provider configuration - Gemini is now default for better latency
  LLM_PROVIDER: z.enum(["deepseek", "openai", "gemini"]).optional().default("gemini"),
  OPENAI_API_KEY: z.string().min(1).optional(), // Required if LLM_PROVIDER=openai
  DEEPSEEK_API_KEY: z.string().min(1).optional(), // Required if LLM_PROVIDER=deepseek
  DEEPSEEK_BASE_URL: z.string().optional().default("https://api.deepseek.com/v1"),
  DEEPSEEK_MODEL: z.string().optional().default("deepseek-chat"),
  // Gemini via Vertex AI (uses Application Default Credentials, no API key needed)
  GOOGLE_CLOUD_PROJECT: z.string().optional(), // Auto-detected on Cloud Run
  VERTEX_AI_LOCATION: z.string().optional().default("us-central1"),
  GEMINI_MODEL: z.string().optional().default("gemini-2.0-flash-001"),
  EMBEDDING_API_KEY: z.string().min(1).optional(), // For Google embeddings
  EMBEDDING_MODEL: z.string().optional().default("text-embedding-004"),
  PORT: z.coerce.number().optional(),
  RATE_LIMIT_TTL_SEC: z.coerce.number().optional(),
  RATE_LIMIT_REQ_PER_TTL: z.coerce.number().optional(),
  NODE_ENV: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().optional().default(45000)
}).refine(
  (data) => {
    // Validate that the required API key is present based on provider
    if (data.LLM_PROVIDER === "openai") {
      return !!data.OPENAI_API_KEY;
    }
    if (data.LLM_PROVIDER === "deepseek") {
      return !!data.DEEPSEEK_API_KEY;
    }
    // Gemini uses Application Default Credentials (ADC) - no API key needed on Cloud Run
    return true;
  },
  {
    message: "API key required: Set DEEPSEEK_API_KEY for deepseek or OPENAI_API_KEY for openai provider",
  }
);
