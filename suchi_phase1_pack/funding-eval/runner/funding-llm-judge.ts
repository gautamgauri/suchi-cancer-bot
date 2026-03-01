/**
 * LLM Judge for Funding Bot proposal quality evaluation.
 * Ported from Cancer Bot's LLM judge with funding-specific prompt engineering.
 *
 * Supports: Deepseek (primary, cheapest), OpenAI (fallback), Vertex AI / Gemini (optional fallback).
 * Uses consensus voting (2x runs, majority wins) to reduce flakiness.
 *
 * Cost reference (per 1M tokens):
 *   Deepseek-chat:      $0.14 input / $0.28 output  — primary, cheapest
 *   Gemini 2.0 Flash:   $0.10 input / $0.40 output  — optional, requires GCP project
 *   OpenAI GPT-4o:      $2.50 input / $10.00 output  — fallback, most expensive
 */
import OpenAI from "openai";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FundingLLMCheck {
  id: string;
  description: string;
  required: boolean;
  type: "llm_scored_boolean" | "llm_scored_boolean_with_count";
  params?: { min_count?: number };
}

export interface FundingLLMJudgeConfig {
  model: string;
  prompt_contract: {
    format: string;
    require_evidence_quotes: boolean;
    max_quote_words_per_field: number;
  };
  checks: FundingLLMCheck[];
}

export interface FundingLLMJudgeResult {
  checkId: string;
  passed: boolean;
  skipped?: boolean;
  score?: number;
  count?: number;
  evidence?: string;
  error?: string;
  consensus?: string;
}

interface LLMJudgeResponse {
  pass: boolean;
  score: number;
  checks: Record<string, { ok: boolean; count?: number; evidence?: string }>;
  fail_reasons: string[];
}

export interface FundingJudgeEvalConfig {
  llmProvider: "deepseek" | "openai" | "vertex_ai";
  fallbackLlmProvider?: "deepseek" | "openai" | "vertex_ai";
  deepseekConfig?: { apiKey: string; baseURL?: string; model?: string };
  openAiConfig?: { apiKey: string; model?: string };
  /** Optional — only needed when vertex_ai is configured as provider or fallback. Requires @google-cloud/vertexai SDK. */
  vertexAiConfig?: { project: string; location: string; model?: string };
}

interface CostEntry {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

// Deepseek pricing
const DEEPSEEK_PRICING: Record<string, { input: number; output: number }> = {
  "deepseek-chat": { input: 0.00000014, output: 0.00000028 },
  "deepseek-reasoner": { input: 0.00000055, output: 0.0000022 },
};

// ── Judge class ──────────────────────────────────────────────────────────────

export class FundingLLMJudge {
  private config: FundingJudgeEvalConfig;
  private openaiClient?: OpenAI;
  private deepseekClient?: OpenAI;
  private costLog: CostEntry[] = [];
  private totalCost = 0;
  private fallbackUsedCount = 0;

  constructor(config: FundingJudgeEvalConfig) {
    this.config = config;

    if (config.llmProvider === "openai" && config.openAiConfig?.apiKey) {
      this.openaiClient = new OpenAI({ apiKey: config.openAiConfig.apiKey });
    }

    if (config.llmProvider === "deepseek" && config.deepseekConfig?.apiKey) {
      this.deepseekClient = new OpenAI({
        apiKey: config.deepseekConfig.apiKey,
        baseURL: config.deepseekConfig.baseURL || "https://api.deepseek.com/v1",
      });
    }

    // Fallback provider initialization
    if (config.fallbackLlmProvider === "openai" && config.openAiConfig?.apiKey && !this.openaiClient) {
      this.openaiClient = new OpenAI({ apiKey: config.openAiConfig.apiKey });
    }
    if (config.fallbackLlmProvider === "deepseek" && config.deepseekConfig?.apiKey && !this.deepseekClient) {
      this.deepseekClient = new OpenAI({
        apiKey: config.deepseekConfig.apiKey,
        baseURL: config.deepseekConfig.baseURL || "https://api.deepseek.com/v1",
      });
    }
  }

  isAvailable(): boolean {
    if (this.config.llmProvider === "openai") return !!this.openaiClient;
    if (this.config.llmProvider === "deepseek") return !!this.deepseekClient;
    if (this.config.llmProvider === "vertex_ai") return !!this.config.vertexAiConfig?.project;
    return false;
  }

  private isFallbackAvailable(): boolean {
    if (!this.config.fallbackLlmProvider) return false;
    if (this.config.fallbackLlmProvider === "openai") return !!this.openaiClient;
    if (this.config.fallbackLlmProvider === "deepseek") return !!this.deepseekClient;
    if (this.config.fallbackLlmProvider === "vertex_ai") return !!this.config.vertexAiConfig?.project;
    return false;
  }

  getCostSummary() {
    return {
      totalCost: this.totalCost,
      totalTokens: this.costLog.reduce((s, e) => s + e.totalTokens, 0),
      callCount: this.costLog.length,
      fallbackUsedCount: this.fallbackUsedCount,
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Judge a proposal section using LLM with funding-specific prompt.
   */
  async judge(
    sectionText: string,
    judgeConfig: FundingLLMJudgeConfig,
    checks: FundingLLMCheck[],
    context?: {
      sectionType?: string;
      funderName?: string;
      orgName?: string;
      retrievedChunks?: Array<{ docId: string; chunkId: string; content: string }>;
    },
  ): Promise<FundingLLMJudgeResult[]> {
    if (!this.isAvailable()) {
      return checks.map((c) => ({
        checkId: c.id,
        passed: false,
        skipped: true,
        error: `LLM Judge not available: ${this.config.llmProvider} client not initialized`,
      }));
    }

    try {
      const prompt = this.buildPrompt(sectionText, judgeConfig, checks, context);
      const response = await this.callLLM(prompt);
      return this.parseResponse(response, checks);
    } catch (error: any) {
      const statusCode = error.status || error.response?.status;
      const msg = (error.message || "").toLowerCase();
      const isRecoverable =
        statusCode === 401 || statusCode === 403 || statusCode === 429 ||
        statusCode >= 500 || msg.includes("timeout") || msg.includes("econnrefused");

      if (isRecoverable && this.isFallbackAvailable()) {
        try {
          const prompt = this.buildPrompt(sectionText, judgeConfig, checks, context);
          const response = await this.callFallbackLLM(prompt);
          this.fallbackUsedCount++;
          return this.parseResponse(response, checks);
        } catch {
          // both failed — skip
        }
      }

      if (isRecoverable) {
        return checks.map((c) => ({
          checkId: c.id,
          passed: false,
          skipped: true,
          error: `LLM error (HTTP ${statusCode || "?"}): ${error.message}`,
        }));
      }

      return checks.map((c) => ({
        checkId: c.id,
        passed: false,
        error: `LLM Judge failed: ${error.message}`,
      }));
    }
  }

  /**
   * Consensus judging — run 2x, majority wins per-check.
   */
  async judgeWithConsensus(
    sectionText: string,
    judgeConfig: FundingLLMJudgeConfig,
    checks: FundingLLMCheck[],
    context?: {
      sectionType?: string;
      funderName?: string;
      orgName?: string;
      retrievedChunks?: Array<{ docId: string; chunkId: string; content: string }>;
    },
    retries = 1,
  ): Promise<FundingLLMJudgeResult[]> {
    const allResults: FundingLLMJudgeResult[][] = [];

    for (let i = 0; i <= retries; i++) {
      const result = await this.judge(sectionText, judgeConfig, checks, context);
      allResults.push(result);
      if (i === 0 && result.every((r) => r.skipped)) return result;
    }

    return this.consensusResults(allResults, checks);
  }

  // ── Prompt construction ────────────────────────────────────────────────────

  private buildPrompt(
    sectionText: string,
    judgeConfig: FundingLLMJudgeConfig,
    checks: FundingLLMCheck[],
    context?: {
      sectionType?: string;
      funderName?: string;
      orgName?: string;
      retrievedChunks?: Array<{ docId: string; chunkId: string; content: string }>;
    },
  ): string {
    let prompt = `You are evaluating a section of a funding proposal generated by an AI assistant for an Indian non-profit. Analyze the following section and return JSON-only output.\n\n`;

    if (context?.sectionType) {
      prompt += `Section type: ${context.sectionType}\n`;
    }
    if (context?.orgName) {
      prompt += `Organization: ${context.orgName}\n`;
    }
    if (context?.funderName) {
      prompt += `Target funder: ${context.funderName}\n`;
    }

    // Include retrieved evidence if available
    const hasContent = context?.retrievedChunks?.some((c) => c.content?.trim().length > 0);
    if (context?.retrievedChunks && context.retrievedChunks.length > 0) {
      if (hasContent) {
        prompt += `\nRetrieved Evidence (what the AI had access to):\n`;
        context.retrievedChunks.forEach((chunk, i) => {
          prompt += `\n[${i + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}\n`;
          prompt += `Content: ${chunk.content.substring(0, 500)}${chunk.content.length > 500 ? "..." : ""}\n`;
        });
      } else {
        prompt += `\nRetrieved chunks (metadata only):\n`;
        context.retrievedChunks.forEach((chunk, i) => {
          prompt += `- [${i + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}\n`;
        });
        prompt += `\nChunk content not available. If citations [citation:docId:chunkId] are present, assume claims are RAG-backed.\n`;
      }
    }

    prompt += `\nSection text to evaluate:\n${sectionText}\n\n`;

    prompt += `Evaluation Criteria:\n`;
    for (const check of checks) {
      prompt += `\n- ${check.id}: ${check.description}`;
      if (check.params?.min_count) {
        prompt += ` (minimum: ${check.params.min_count})`;
      }
    }

    // Funding-specific evaluation guidance
    prompt += `\n\nFunding Proposal Quality Rules:\n`;
    prompt += `- Voice: Must use first-person plural ("We", "Our team"). Third-person impersonal ("The organization") is a FAIL.\n`;
    prompt += `- Hollow phrases: "holistic approach", "sustainable impact", "transformative change" WITHOUT specific details are a FAIL.\n`;
    prompt += `- Indian formatting: Currency should use ₹ or INR. Large numbers should use lakhs/crores.\n`;
    prompt += `- Bihar-specificity: References to Bihar geography, NEP 2020, or local context are preferred.\n`;
    prompt += `- Citations: Claims about org data, outcomes, or methodology should have [citation:docId:chunkId] markers.\n`;
    prompt += `- Funder naming: The funder should be named explicitly, not referred to as "the funder" or "the donor".\n`;

    // Output format
    prompt += `\n\nReturn JSON-only in this exact format:\n`;
    prompt += JSON.stringify(
      {
        pass: true,
        score: 0.95,
        checks: {
          [checks[0]?.id || "example_check"]: {
            ok: true,
            count: 5,
            evidence: "Quote from section (max 30 words)",
          },
        },
        fail_reasons: [],
      },
      null,
      2,
    );

    prompt += `\n\nFor each check:\n`;
    prompt += `- "ok": true if the check passes, false otherwise\n`;
    prompt += `- "count": number of items found (for count-based checks)\n`;
    prompt += `- "evidence": quote from the section (max ${judgeConfig.prompt_contract.max_quote_words_per_field} words) that supports your judgment\n`;
    prompt += `- "pass": true if ALL required checks pass\n`;
    prompt += `- "score": overall score 0.0-1.0\n`;
    prompt += `- "fail_reasons": array of strings explaining any failures\n\n`;
    prompt += `Return ONLY valid JSON, no other text.`;

    return prompt;
  }

  // ── LLM calls ──────────────────────────────────────────────────────────────

  private async callLLM(prompt: string): Promise<string> {
    if (this.config.llmProvider === "openai") return this.callOpenAI(prompt);
    if (this.config.llmProvider === "deepseek") return this.callDeepseek(prompt);
    if (this.config.llmProvider === "vertex_ai") return this.callVertexAI(prompt);
    throw new Error(`Unsupported LLM provider: ${this.config.llmProvider}`);
  }

  private async callFallbackLLM(prompt: string): Promise<string> {
    const fb = this.config.fallbackLlmProvider;
    if (!fb) throw new Error("No fallback configured");
    if (fb === "openai") return this.callOpenAI(prompt);
    if (fb === "deepseek") return this.callDeepseek(prompt);
    if (fb === "vertex_ai") return this.callVertexAI(prompt);
    throw new Error(`Unsupported fallback: ${fb}`);
  }

  private async callOpenAI(prompt: string): Promise<string> {
    if (!this.openaiClient) throw new Error("OpenAI client not initialized");
    const model = this.config.openAiConfig?.model || "gpt-4o";
    const response = await this.openaiClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a funding proposal evaluator. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    return response.choices[0]?.message?.content || "{}";
  }

  private async callDeepseek(prompt: string): Promise<string> {
    if (!this.deepseekClient) throw new Error("Deepseek client not initialized");
    const model = this.config.deepseekConfig?.model || "deepseek-chat";
    const response = await this.deepseekClient.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a funding proposal evaluator. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    // Track cost
    const usage = response.usage;
    if (usage) {
      const pricing = DEEPSEEK_PRICING[model] || DEEPSEEK_PRICING["deepseek-chat"];
      const estimatedCost = usage.prompt_tokens * pricing.input + usage.completion_tokens * pricing.output;
      this.costLog.push({
        timestamp: new Date().toISOString(),
        model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        estimatedCost,
      });
      this.totalCost += estimatedCost;
    }

    return response.choices[0]?.message?.content || "{}";
  }

  /**
   * Vertex AI / Gemini — optional provider. Requires:
   *   npm install @google-cloud/vertexai
   *   GCP project with Vertex AI API enabled
   *   Application Default Credentials (ADC) configured
   */
  private async callVertexAI(prompt: string): Promise<string> {
    const cfg = this.config.vertexAiConfig;
    if (!cfg) throw new Error("Vertex AI config not provided");
    try {
      // @ts-ignore — optional peer dependency; only loaded when vertex_ai provider is configured
      const { VertexAI } = await import("@google-cloud/vertexai");
      const vertexAI = new VertexAI({ project: cfg.project, location: cfg.location });
      const model = cfg.model || "gemini-2.0-flash-001";
      const generativeModel = vertexAI.getGenerativeModel({
        model,
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      });
      const result = await generativeModel.generateContent(prompt);
      return result.response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    } catch (error: any) {
      if (error.message?.includes("Cannot find module")) {
        throw new Error(
          "Vertex AI SDK not installed. Run: npm install @google-cloud/vertexai\n" +
          "This is an optional dependency — only needed when vertex_ai is configured as llmProvider or fallbackLlmProvider.",
        );
      }
      throw error;
    }
  }

  // ── Response parsing ───────────────────────────────────────────────────────

  private parseResponse(response: string, checks: FundingLLMCheck[]): FundingLLMJudgeResult[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const parsed: LLMJudgeResponse = JSON.parse(jsonMatch ? jsonMatch[0] : response);

      return checks.map((check) => {
        const cr = parsed.checks?.[check.id];
        if (!cr) {
          return { checkId: check.id, passed: false, error: "Check result not found in LLM response" };
        }

        const passed = cr.ok === true;
        let score: number | undefined;
        if (check.type === "llm_scored_boolean_with_count" && check.params?.min_count) {
          score = passed ? 1.0 : Math.min(1.0, (cr.count || 0) / check.params.min_count);
        }

        return {
          checkId: check.id,
          passed,
          score,
          evidence: cr.evidence,
          count: cr.count,
        };
      });
    } catch (error: any) {
      return checks.map((c) => ({
        checkId: c.id,
        passed: false,
        error: `Failed to parse LLM response: ${error.message}`,
      }));
    }
  }

  // ── Consensus ──────────────────────────────────────────────────────────────

  private consensusResults(
    allResults: FundingLLMJudgeResult[][],
    checks: FundingLLMCheck[],
  ): FundingLLMJudgeResult[] {
    return checks.map((check) => {
      const results = allResults
        .map((r) => r.find((x) => x.checkId === check.id))
        .filter((r): r is FundingLLMJudgeResult => r !== undefined);

      if (results.length === 0) {
        return { checkId: check.id, passed: false, error: "No results" };
      }

      const skipped = results.find((r) => r.skipped);
      if (skipped) return skipped;

      const errored = results.find((r) => r.error);
      if (errored && results.every((r) => r.error)) return errored;

      const valid = results.filter((r) => !r.error);
      const passCount = valid.filter((r) => r.passed).length;
      const majority = passCount > valid.length / 2;
      const avgCount = valid.reduce((s, r) => s + (r.count || 0), 0) / valid.length;
      const avgScore = valid.reduce((s, r) => s + (r.score || 0), 0) / valid.length;
      const evidenceResult = valid.find((r) => r.passed === majority);

      return {
        checkId: check.id,
        passed: majority,
        count: Math.round(avgCount),
        score: avgScore > 0 ? avgScore : undefined,
        evidence: evidenceResult?.evidence,
        consensus: `${passCount}/${valid.length} passed`,
      };
    });
  }
}
