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
  
  if (useSecretManager) {
    try {
      const secretNames = [
        "deepseek-api-key",
        "openai-api-key",
        "eval-llm-provider",
        "deepseek-model",
        "openai-model",
      ];
      secrets = await getSecrets(secretNames);
      console.log("Loaded secrets from Google Cloud Secret Manager");
    } catch (error: any) {
      console.warn(`Failed to load secrets from Secret Manager: ${error.message}`);
      console.warn("Falling back to environment variables");
    }
  }

  // Override with environment variables (or secrets from Secret Manager)
  const envConfig: Partial<EvaluationConfig> = {
    apiBaseUrl: process.env.EVAL_API_BASE_URL || config.apiBaseUrl || "http://localhost:3001",
    llmProvider: (process.env.EVAL_LLM_PROVIDER || secrets["eval-llm-provider"] || config.llmProvider || "openai") as "vertex_ai" | "openai" | "deepseek",
    timeoutMs: parseInt(process.env.EVAL_TIMEOUT_MS || "30000", 10),
    retries: parseInt(process.env.EVAL_RETRIES || "2", 10),
    parallel: process.env.EVAL_PARALLEL === "true",
    maxConcurrency: parseInt(process.env.EVAL_MAX_CONCURRENCY || "5", 10),
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
    envConfig.deepseekConfig = {
      model: process.env.DEEPSEEK_MODEL || secrets["deepseek-model"] || config.deepseekConfig?.model || "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY || secrets["deepseek-api-key"] || config.deepseekConfig?.apiKey || "",
      baseURL: process.env.DEEPSEEK_BASE_URL || config.deepseekConfig?.baseURL || "https://api.deepseek.com/v1",
    };
  }

  return envConfig as EvaluationConfig;
}

