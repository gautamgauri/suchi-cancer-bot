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
  LLM_TIMEOUT_MS: z.coerce.number().optional().default(15000),
  // Voice module
  GCS_BUCKET_TTS: z.string().optional(),
  GCS_SIGNED_URL_EXPIRY_MIN: z.coerce.number().optional().default(60),
  STT_LANGUAGE_CODE: z.string().optional().default("hi-IN"),
  STT_MODEL: z.string().optional().default("latest_short"),
  STT_CONFIDENCE_THRESHOLD: z.coerce.number().optional().default(0.6),
  TTS_VOICE_NAME: z.string().optional().default("hi-IN-Neural2-D"),
  TTS_SPEAKING_RATE: z.coerce.number().optional().default(0.9),
  TTS_PROVIDER: z.enum(['google', 'sarvam']).optional().default('google'),
  // Sarvam AI TTS (optional — used when TTS_PROVIDER=sarvam)
  SARVAM_API_KEY: z.string().min(1).optional(),
  SARVAM_TTS_SPEAKER: z.string().optional().default('meera'),
  SARVAM_TTS_MODEL: z.string().optional().default('bulbul:v2'),
  VOICE_MAX_AUDIO_SIZE_BYTES: z.coerce.number().optional().default(2097152),
  VOICE_MAX_AUDIO_DURATION_SEC: z.coerce.number().optional().default(60),
  // STT version: v2 uses phrase adaptation for better accuracy
  STT_VERSION: z.enum(['v1', 'v2']).optional().default('v2'),
  // WebSocket voice streaming (opt-in)
  VOICE_WS_ENABLED: z.string().optional().default('false'),
  VOICE_WS_IDLE_TIMEOUT_MS: z.coerce.number().optional().default(30000),
  VOICE_WS_MAX_SESSION_MS: z.coerce.number().optional().default(60000),
  // Review Copilot
  REVIEW_COPILOT_MODE: z.enum(['off', 'shadow', 'active']).optional().default('off')
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
