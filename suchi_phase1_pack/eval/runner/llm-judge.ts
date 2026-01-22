import { LLMCheck, LLMJudgeConfig, LLMJudgeResult, LLMJudgeResponse, EvaluationConfig } from "../types";
import OpenAI from "openai";

export class LLMJudge {
  private config: EvaluationConfig;
  private openaiClient?: OpenAI;
  private deepseekClient?: OpenAI;

  constructor(config: EvaluationConfig) {
    this.config = config;
    
    if (config.llmProvider === "openai" && config.openAiConfig?.apiKey) {
      this.openaiClient = new OpenAI({
        apiKey: config.openAiConfig.apiKey,
      });
    }
    
    if (config.llmProvider === "deepseek") {
      if (config.deepseekConfig?.apiKey && config.deepseekConfig.apiKey.trim().length > 0) {
        this.deepseekClient = new OpenAI({
          apiKey: config.deepseekConfig.apiKey,
          baseURL: config.deepseekConfig.baseURL || "https://api.deepseek.com/v1",
        });
      } else {
        console.warn("⚠ Deepseek client not initialized: DEEPSEEK_API_KEY is missing or empty in config.");
        console.warn("  Set DEEPSEEK_API_KEY environment variable or ensure Secret Manager is accessible.");
      }
    }
  }

  /**
   * Check if the LLM judge is available (client initialized)
   */
  isAvailable(): boolean {
    if (this.config.llmProvider === "openai") {
      return !!this.openaiClient;
    } else if (this.config.llmProvider === "deepseek") {
      return !!this.deepseekClient;
    } else if (this.config.llmProvider === "vertex_ai") {
      return !!this.config.vertexAiConfig;
    }
    return false;
  }

  /**
   * Judge a response using LLM
   */
  async judge(
    responseText: string,
    judgeConfig: LLMJudgeConfig,
    checks: LLMCheck[],
    testCaseContext?: {
      cancer?: string;
      intent?: string;
      mustMentionTests?: string[];
      retrievedChunks?: Array<{ docId: string; chunkId: string; content: string }>;
    }
  ): Promise<LLMJudgeResult[]> {
    // PHASE 2.5+: If LLM judge is not available, return skipped results
    // These are excluded from scoring (not counted in numerator OR denominator)
    if (!this.isAvailable()) {
      console.warn(`⚠ LLM Judge skipped: ${this.config.llmProvider} client not initialized`);
      return checks.map((check) => ({
        checkId: check.id,
        passed: false, // Not passed, but skipped - excluded from scoring
        skipped: true,
        error: `LLM Judge not available: ${this.config.llmProvider} client not initialized. Check excluded from scoring.`,
      }));
    }

    try {
      const prompt = this.buildPrompt(responseText, judgeConfig, checks, testCaseContext);
      const response = await this.callLLM(prompt, judgeConfig);
      return this.parseResponse(response, checks);
    } catch (error: any) {
      // Classify error type for clear reporting
      const statusCode = error.status || error.response?.status;
      const errorMsg = error.message?.toLowerCase() || '';

      let errorType: 'auth_failed' | 'rate_limited' | 'provider_error' | 'network_error' | 'unknown';
      let shouldSkip = false;

      if (statusCode === 401 || statusCode === 403 || errorMsg.includes('unauthorized') || errorMsg.includes('forbidden')) {
        errorType = 'auth_failed';
        shouldSkip = true; // Auth issues are skippable (key problem, not code problem)
      } else if (statusCode === 429 || errorMsg.includes('rate limit')) {
        errorType = 'rate_limited';
        shouldSkip = true;
      } else if (statusCode >= 500 || errorMsg.includes('internal server error')) {
        errorType = 'provider_error';
        shouldSkip = true;
      } else if (
        errorMsg.includes('econnrefused') ||
        errorMsg.includes('etimedout') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('network') ||
        errorMsg.includes('dns') ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT'
      ) {
        errorType = 'network_error';
        shouldSkip = true;
      } else {
        errorType = 'unknown';
        shouldSkip = false; // Unknown errors should fail (might be code bug)
      }

      const errorLabel = `${errorType}${statusCode ? ` (HTTP ${statusCode})` : ''}`;

      if (shouldSkip) {
        console.warn(`⚠ LLM Judge skipped: ${errorLabel} - ${error.message}`);
        return checks.map((check) => ({
          checkId: check.id,
          passed: false,
          skipped: true,
          error: `${errorLabel}: ${error.message}`,
        }));
      }

      // Non-skippable errors (unknown/parsing issues)
      console.error(`❌ LLM Judge failed: ${errorLabel} - ${error.message}`);
      return checks.map((check) => ({
        checkId: check.id,
        passed: false,
        error: `${errorLabel}: ${error.message}`,
      }));
    }
  }

  /**
   * Build the judge prompt
   */
  private buildPrompt(
    responseText: string,
    judgeConfig: LLMJudgeConfig,
    checks: LLMCheck[],
    testCaseContext?: {
      cancer?: string;
      intent?: string;
      mustMentionTests?: string[];
      retrievedChunks?: Array<{ docId: string; chunkId: string; content: string }>;
    }
  ): string {
    let prompt = `You are evaluating a medical chatbot response. Analyze the following response and return JSON-only output.\n\n`;
    
    if (testCaseContext?.cancer) {
      prompt += `Context: The user asked about ${testCaseContext.cancer} cancer.\n`;
    }
    
    if (testCaseContext?.intent) {
      prompt += `Intent: ${testCaseContext.intent}\n`;
    }

    // Include retrieved chunks content if available
    if (testCaseContext?.retrievedChunks && testCaseContext.retrievedChunks.length > 0) {
      prompt += `\nRetrieved Knowledge Base Content (what the bot had access to):\n`;
      testCaseContext.retrievedChunks.forEach((chunk, index) => {
        prompt += `\n[${index + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}\n`;
        prompt += `Content: ${chunk.content.substring(0, 500)}${chunk.content.length > 500 ? "..." : ""}\n`;
      });
    }

    prompt += `\nResponse to evaluate:\n${responseText}\n\n`;

    prompt += `Evaluation Criteria:\n`;
    for (const check of checks) {
      prompt += `\n- ${check.id}: ${check.description}`;
      if (check.params?.min_count) {
        prompt += ` (minimum: ${check.params.min_count})`;
      }
    }

    // Update mustMentionTests to be conditional on retrieval
    if (testCaseContext?.mustMentionTests && testCaseContext.mustMentionTests.length > 0) {
      if (testCaseContext.retrievedChunks && testCaseContext.retrievedChunks.length > 0) {
        // Check which tests are actually in retrieval
        const allRetrievedContent = testCaseContext.retrievedChunks.map(c => c.content.toLowerCase()).join(" ");
        const testsInRetrieval = testCaseContext.mustMentionTests.filter(test => {
          const testLower = test.toLowerCase();
          return allRetrievedContent.includes(testLower) || 
                 allRetrievedContent.includes(testLower.replace(/\s+/g, " "));
        });
        
        if (testsInRetrieval.length > 0) {
          prompt += `\n\nIMPORTANT: The response SHOULD mention these tests IF they appear in the retrieved content: ${testsInRetrieval.join(", ")}`;
          const testsNotInRetrieval = testCaseContext.mustMentionTests.filter(t => !testsInRetrieval.includes(t));
          if (testsNotInRetrieval.length > 0) {
            prompt += `\nNOTE: These tests are NOT in the retrieved content, so the response should NOT be penalized for omitting them: ${testsNotInRetrieval.join(", ")}`;
          }
        } else {
          prompt += `\n\nNOTE: None of the expected tests (${testCaseContext.mustMentionTests.join(", ")}) appear in the retrieved content. The response should NOT be penalized for omitting them.`;
        }
      } else {
        prompt += `\n\nNOTE: Expected tests: ${testCaseContext.mustMentionTests.join(", ")}, but no retrieved content available to verify.`;
      }
    }

    prompt += `\n\nRAG-Backed Content Validation:\n`;
    prompt += `- Check if medical claims, facts, symptoms, and diagnostic methods are supported by citations\n`;
    prompt += `- Verify that the response appears to be based on retrieved knowledge base content, not general knowledge\n`;
    prompt += `- Look for citation markers in the format [citation:docId:chunkId]\n`;
    prompt += `- Ensure that specific medical information (test names, procedures, timelines) are cited\n`;
    prompt += `- The response should demonstrate use of RAG (Retrieval-Augmented Generation) rather than pure LLM knowledge\n`;
    
    // Add specific instruction for no_unsupported_medical_claims check
    const hasUnsupportedClaimsCheck = checks.some(c => c.id === "no_unsupported_medical_claims");
    if (hasUnsupportedClaimsCheck && testCaseContext?.retrievedChunks) {
      prompt += `\n\nCRITICAL: For "no_unsupported_medical_claims" check:\n`;
      prompt += `- Check if EVERY medical claim (test, treatment, procedure, prognosis) in the response appears in the retrieved content above\n`;
      prompt += `- If ANY claim is not present in retrieved content, this check MUST FAIL\n`;
      prompt += `- The response should only state facts that are directly supported by the retrieved chunks\n`;
    }
    
    // Add instruction for conditional tests_coverage
    const hasTestsCoverageCheck = checks.some(c => c.id === "tests_coverage");
    if (hasTestsCoverageCheck && testCaseContext?.retrievedChunks) {
      prompt += `\n\nFor "tests_coverage" check:\n`;
      prompt += `- Only require tests that are actually mentioned in the retrieved content above\n`;
      prompt += `- If retrieval contains fewer than 3 test mentions, the response should either:\n`;
      prompt += `  * List the tests that ARE in retrieval (even if < 3), OR\n`;
      prompt += `  * State "I don't have enough information in my NCI sources" - both are acceptable\n`;
      prompt += `- Do NOT penalize for omitting tests that are not in the retrieved content\n`;
    }

    prompt += `\n\nReturn JSON-only in this exact format:\n`;
    prompt += JSON.stringify({
      pass: true,
      score: 0.95,
      checks: {
        [checks[0].id]: {
          ok: true,
          count: 5,
          evidence: "Quote from response (max 30 words)"
        }
      },
      fail_reasons: []
    }, null, 2);

    prompt += `\n\nFor each check:\n`;
    prompt += `- "ok": true if the check passes, false otherwise\n`;
    prompt += `- "count": number of items found (for count-based checks)\n`;
    prompt += `- "evidence": quote from the response (max ${judgeConfig.prompt_contract.max_quote_words_per_field} words) that supports your judgment\n`;
    prompt += `- "pass": true if all required checks pass\n`;
    prompt += `- "score": overall score 0.0-1.0\n`;
    prompt += `- "fail_reasons": array of strings explaining any failures\n\n`;
    prompt += `Return ONLY valid JSON, no other text.`;

    return prompt;
  }

  /**
   * Call the appropriate LLM provider
   */
  private async callLLM(prompt: string, judgeConfig: LLMJudgeConfig): Promise<string> {
    if (this.config.llmProvider === "openai") {
      return this.callOpenAI(prompt, judgeConfig);
    } else if (this.config.llmProvider === "deepseek") {
      return this.callDeepseek(prompt, judgeConfig);
    } else if (this.config.llmProvider === "vertex_ai") {
      return this.callVertexAI(prompt, judgeConfig);
    } else {
      throw new Error(`Unsupported LLM provider: ${this.config.llmProvider}`);
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(prompt: string, _judgeConfig: LLMJudgeConfig): Promise<string> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized. Provide OPENAI_API_KEY in config.");
    }

    const model = this.config.openAiConfig?.model || "gpt-4o";
    
    const response = await this.openaiClient.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a medical response evaluator. Return only valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    return response.choices[0]?.message?.content || "{}";
  }

  /**
   * Call Deepseek API (OpenAI-compatible)
   */
  private async callDeepseek(prompt: string, _judgeConfig: LLMJudgeConfig): Promise<string> {
    if (!this.deepseekClient) {
      throw new Error("Deepseek client not initialized. Provide DEEPSEEK_API_KEY in config.");
    }

    const model = this.config.deepseekConfig?.model || "deepseek-chat";
    
    const response = await this.deepseekClient.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a medical response evaluator. Return only valid JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    return response.choices[0]?.message?.content || "{}";
  }

  /**
   * Call Vertex AI API
   */
  private async callVertexAI(prompt: string, _judgeConfig: LLMJudgeConfig): Promise<string> {
    // Vertex AI implementation
    // Note: Requires @google-cloud/vertexai package
    const vertexAiConfig = this.config.vertexAiConfig;
    if (!vertexAiConfig) {
      throw new Error("Vertex AI config not provided");
    }

    try {
      // Dynamic import to avoid requiring the package if not using Vertex AI
      const { VertexAI } = await import("@google-cloud/vertexai");
      
      const vertexAI = new VertexAI({
        project: vertexAiConfig.project,
        location: vertexAiConfig.location,
      });

      const model = vertexAiConfig.model || "gemini-1.5-pro";
      const generativeModel = vertexAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      });

      const result = await generativeModel.generateContent(prompt);
      const response = result.response;
      // Vertex AI returns text via getText() method
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return text || "{}";
    } catch (error: any) {
      if (error.message?.includes("Cannot find module")) {
        throw new Error(
          "Vertex AI SDK not installed. Run: npm install @google-cloud/vertexai"
        );
      }
      throw error;
    }
  }

  /**
   * Parse LLM response and extract check results
   */
  private parseResponse(response: string, checks: LLMCheck[]): LLMJudgeResult[] {
    try {
      // Try to extract JSON from response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonText = jsonMatch ? jsonMatch[0] : response;
      
      const parsed: LLMJudgeResponse = JSON.parse(jsonText);

      return checks.map((check) => {
        const checkResult = parsed.checks?.[check.id];
        if (!checkResult) {
          return {
            checkId: check.id,
            passed: false,
            error: "Check result not found in LLM response",
          };
        }

        const passed = checkResult.ok === true;
        let score: number | undefined;
        
        // Calculate score based on count if applicable
        if (check.type === "llm_scored_boolean_with_count" && check.params?.min_count) {
          const count = checkResult.count || 0;
          const minCount = check.params.min_count;
          score = Math.min(1.0, count / minCount);
        }

        return {
          checkId: check.id,
          passed,
          score,
          evidence: checkResult.evidence,
          count: checkResult.count,
        };
      });
    } catch (error: any) {
      // If parsing fails, return failed results
      return checks.map((check) => ({
        checkId: check.id,
        passed: false,
        error: `Failed to parse LLM response: ${error.message}`,
      }));
    }
  }
}

