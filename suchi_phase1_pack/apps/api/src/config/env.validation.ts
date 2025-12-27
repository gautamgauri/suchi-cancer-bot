import { z } from "zod";
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ADMIN_BASIC_USER: z.string().min(1),
  ADMIN_BASIC_PASS: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  EMBEDDING_API_KEY: z.string().min(1).optional(), // For Google embeddings (can use GEMINI_API_KEY)
  EMBEDDING_MODEL: z.string().optional().default("google-text-embedding-004"),
  PORT: z.coerce.number().optional(),
  RATE_LIMIT_TTL_SEC: z.coerce.number().optional(),
  RATE_LIMIT_REQ_PER_TTL: z.coerce.number().optional(),
  NODE_ENV: z.string().optional()
});
