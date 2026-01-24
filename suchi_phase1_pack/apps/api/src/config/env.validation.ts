import { z } from "zod";
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_BASIC_USER: z.string().min(1),
  ADMIN_BASIC_PASS: z.string().min(1),
  // LLM Provider configuration - Deepseek is default (cost-effective)
  LLM_PROVIDER: z.enum(["deepseek", "openai"]).optional().default("deepseek"),
  OPENAI_API_KEY: z.string().min(1).optional(), // Required if LLM_PROVIDER=openai
  DEEPSEEK_API_KEY: z.string().min(1).optional(), // Required if LLM_PROVIDER=deepseek (default)
  DEEPSEEK_BASE_URL: z.string().optional().default("https://api.deepseek.com/v1"),
  DEEPSEEK_MODEL: z.string().optional().default("deepseek-chat"),
  EMBEDDING_API_KEY: z.string().min(1).optional(), // For Google embeddings
  EMBEDDING_MODEL: z.string().optional().default("google-text-embedding-004"),
  PORT: z.coerce.number().optional(),
  RATE_LIMIT_TTL_SEC: z.coerce.number().optional(),
  RATE_LIMIT_REQ_PER_TTL: z.coerce.number().optional(),
  NODE_ENV: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().optional().default(15000)
}).refine(
  (data) => {
    // Validate that the required API key is present based on provider
    if (data.LLM_PROVIDER === "openai") {
      return !!data.OPENAI_API_KEY;
    }
    // Default is deepseek
    return !!data.DEEPSEEK_API_KEY;
  },
  {
    message: "API key required: Set DEEPSEEK_API_KEY (default provider) or OPENAI_API_KEY with LLM_PROVIDER=openai",
  }
);
