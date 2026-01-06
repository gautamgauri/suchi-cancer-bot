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
    
    if (config.llmProvider === "deepseek" && config.deepseekConfig?.apiKey) {
      this.deepseekClient = new OpenAI({
        apiKey: config.deepseekConfig.apiKey,
        baseURL: config.deepseekConfig.baseURL || "https://api.deepseek.com/v1",
      });
    }
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
    }
  ): Promise<LLMJudgeResult[]> {
    try {
      const prompt = this.buildPrompt(responseText, judgeConfig, checks, testCaseContext);
      const response = await this.callLLM(prompt, judgeConfig);
      return this.parseResponse(response, checks);
    } catch (error: any) {
      // Return failed results for all checks
      return checks.map((check) => ({
        checkId: check.id,
        passed: false,
        error: error.message,
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
    }
  ): string {
    let prompt = `You are evaluating a medical chatbot response. Analyze the following response and return JSON-only output.\n\n`;
    
    if (testCaseContext?.cancer) {
      prompt += `Context: The user asked about ${testCaseContext.cancer} cancer.\n`;
    }
    
    if (testCaseContext?.intent) {
      prompt += `Intent: ${testCaseContext.intent}\n`;
    }

    prompt += `\nResponse to evaluate:\n${responseText}\n\n`;

    prompt += `Evaluation Criteria:\n`;
    for (const check of checks) {
      prompt += `\n- ${check.id}: ${check.description}`;
      if (check.params?.min_count) {
        prompt += ` (minimum: ${check.params.min_count})`;
      }
    }

    if (testCaseContext?.mustMentionTests && testCaseContext.mustMentionTests.length > 0) {
      prompt += `\n\nIMPORTANT: The response MUST mention these tests: ${testCaseContext.mustMentionTests.join(", ")}`;
    }

    prompt += `\n\nRAG-Backed Content Validation:\n`;
    prompt += `- Check if medical claims, facts, symptoms, and diagnostic methods are supported by citations\n`;
    prompt += `- Verify that the response appears to be based on retrieved knowledge base content, not general knowledge\n`;
    prompt += `- Look for citation markers in the format [citation:docId:chunkId]\n`;
    prompt += `- Ensure that specific medical information (test names, procedures, timelines) are cited\n`;
    prompt += `- The response should demonstrate use of RAG (Retrieval-Augmented Generation) rather than pure LLM knowledge\n`;

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

