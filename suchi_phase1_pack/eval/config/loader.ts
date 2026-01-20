import { EvaluationConfig } from "../types";
import * as fs from "fs/promises";
import * as path from "path";
import { getSecrets, isSecretManagerAvailable } from "./secrets-manager";

export async function loadConfig(configPath?: string): Promise<EvaluationConfig> {
  const defaultPath = path.join(__dirname, "default.json");
  const configFile = configPath 
    ? (path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath))
    : defaultPath;

  let config: Partial<EvaluationConfig>;
  try {
    const content = await fs.readFile(configFile, "utf-8");
    config = JSON.parse(content);
  } catch (error) {
    // Use defaults if file doesn't exist
    config = {};
  }

  // Try to load secrets from Google Cloud Secret Manager
  let secrets: Record<string, string | null> = {};
  const useSecretManager = await isSecretManagerAvailable();
  
  // Check if environment variables are already set - if so, skip Secret Manager to avoid unnecessary warnings
  const hasEnvVars = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  
  if (useSecretManager && !hasEnvVars) {
    try {
      const secretNames = [
        "deepseek-api-key",
        "openai-api-key",
        "eval-llm-provider",
        "deepseek-model",
        "openai-model",
      ];
      secrets = await getSecrets(secretNames);
      console.log("✓ Loaded secrets from Google Cloud Secret Manager");
    } catch (error: any) {
      // Only warn if authentication failed AND no env vars are set
      // If env vars are set, Secret Manager failure is expected and not a problem
      if (!hasEnvVars) {
        console.warn(`⚠ Secret Manager unavailable (${error.message?.substring(0, 50) || 'authentication required'})`);
        console.warn("  Using environment variables instead (set DEEPSEEK_API_KEY or use gcloud secrets access)");
      }
      // Silently fall back to environment variables if they're already set
    }
  } else if (hasEnvVars) {
    // Environment variables are set, no need to try Secret Manager
    // This is the normal case when running locally with gcloud secrets access
  }

  // Override with environment variables (or secrets from Secret Manager)
  const envConfig: Partial<EvaluationConfig> = {
    apiBaseUrl: process.env.EVAL_API_BASE_URL || config.apiBaseUrl || "http://localhost:3001",
    authBearer: process.env.EVAL_AUTH_BEARER || config.authBearer, // Optional bearer token for API auth
    llmProvider: (process.env.EVAL_LLM_PROVIDER || secrets["eval-llm-provider"] || config.llmProvider || "openai") as "vertex_ai" | "openai" | "deepseek",
    timeoutMs: parseInt(process.env.EVAL_TIMEOUT_MS || String(config.timeoutMs || 60000), 10),
    retries: parseInt(process.env.EVAL_RETRIES || String(config.retries || 2), 10),
    parallel: process.env.EVAL_PARALLEL === "true" || config.parallel || false,
    maxConcurrency: parseInt(process.env.EVAL_MAX_CONCURRENCY || String(config.maxConcurrency || 5), 10),
  };

  // Vertex AI config
  if (envConfig.llmProvider === "vertex_ai" || config.llmProvider === "vertex_ai") {
    envConfig.vertexAiConfig = {
      project: process.env.GOOGLE_CLOUD_PROJECT || config.vertexAiConfig?.project || "",
      location: process.env.VERTEX_AI_LOCATION || config.vertexAiConfig?.location || "us-central1",
      model: process.env.VERTEX_AI_MODEL || config.vertexAiConfig?.model || "gemini-1.5-pro",
    };
  }

  // OpenAI config
  if (envConfig.llmProvider === "openai" || config.llmProvider === "openai") {
    envConfig.openAiConfig = {
      model: process.env.OPENAI_MODEL || secrets["openai-model"] || config.openAiConfig?.model || "gpt-4o",
      apiKey: process.env.OPENAI_API_KEY || secrets["openai-api-key"] || config.openAiConfig?.apiKey || "",
    };
  }

  // Deepseek config
  if (envConfig.llmProvider === "deepseek" || config.llmProvider === "deepseek") {
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY || secrets["deepseek-api-key"] || config.deepseekConfig?.apiKey || "";
    
    // Warn if API key is missing when using Deepseek
    if (!deepseekApiKey) {
      console.warn("⚠ WARNING: DEEPSEEK_API_KEY is not set. LLM judge checks will fail.");
      console.warn("  Set DEEPSEEK_API_KEY environment variable or ensure Secret Manager is accessible.");
    }
    
    envConfig.deepseekConfig = {
      model: process.env.DEEPSEEK_MODEL || secrets["deepseek-model"] || config.deepseekConfig?.model || "deepseek-chat",
      apiKey: deepseekApiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || config.deepseekConfig?.baseURL || "https://api.deepseek.com/v1",
    };
  }

  return envConfig as EvaluationConfig;
}

