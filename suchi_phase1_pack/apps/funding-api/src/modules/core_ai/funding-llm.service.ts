import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { logStructured } from "../../common/structured-logger";
import { EvidenceChunk, FundingConversationContext } from "./types";
import { buildFundingCitationInstructions } from "./funding-citation-instructions";

const MISSING_EVIDENCE_RESPONSE = `MISSING_EVIDENCE

No reference material was provided. I cannot draft or cite without evidence.

**Checklist:**
- [ ] Provide at least one reference chunk (id, source, text, and optional title/section/urlOrPath)
- [ ] Ensure chunks contain the evidence needed for the need statement
- [ ] Re-submit with chunks to generate a draft with citations`;

export interface EvaluateResult {
  score: number;
  dimensions?: Record<string, number>;
  weaknesses: string[];
}

function isTimeoutOrAbort(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e?.name === "AbortError" || (typeof e?.message === "string" && (e.message.includes("timeout") || e.message.includes("aborted")));
}

function isRetryableError(err: unknown): boolean {
  if (isTimeoutOrAbort(err)) return true;
  const e = err as { status?: number; code?: string; message?: string };
  if (typeof e?.status === "number") {
    if (e.status === 429) return true;
    if (e.status >= 500) return true;
    return false;
  }
  const code = e?.code as string | undefined;
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND") return true;
  return false;
}

/** Citation validation result */
interface CitationValidationResult {
  validCount: number;
  invalidCount: number;
  invalidCitations: string[];
}

/** Extract and validate citations against provided chunks */
function validateCitations(text: string, chunks: EvidenceChunk[]): CitationValidationResult {
  const citationPattern = /\[citation:([^:\]]+):([^\]]+)\]/g;
  const validChunkIds = new Set(chunks.map((c) => `${c.docId}:${c.chunkId}`));

  const citations: string[] = [];
  let match;
  while ((match = citationPattern.exec(text)) !== null) {
    citations.push(`${match[1]}:${match[2]}`);
  }

  const invalidCitations = citations.filter((c) => !validChunkIds.has(c));
  const validCount = citations.length - invalidCitations.length;

  return {
    validCount,
    invalidCount: invalidCitations.length,
    invalidCitations,
  };
}

@Injectable()
export class FundingLlmService {
  private readonly logger = new Logger(FundingLlmService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly evalModel: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("FUNDING_OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("FUNDING_OPENAI_API_KEY is required");
    }
    const baseURL = this.configService.get<string>("FUNDING_OPENAI_BASE_URL");
    this.client = new OpenAI({ apiKey, ...(baseURL && { baseURL }) });
    this.model = this.configService.get<string>("FUNDING_MODEL_DRAFT") ?? "deepseek-chat";
    this.evalModel = this.configService.get<string>("FUNDING_MODEL_EVAL") ?? this.model;
    this.timeoutMs = this.configService.get<number>("FUNDING_LLM_TIMEOUT_MS") ?? 45000;
    this.maxRetries = this.configService.get<number>("FUNDING_LLM_MAX_RETRIES") ?? 2;
    this.retryDelayMs = this.configService.get<number>("FUNDING_LLM_RETRY_DELAY_MS") ?? 1500;
    this.logger.log(
      `FundingLlmService initialized with model ${this.model}, eval model ${this.evalModel}, timeout ${this.timeoutMs}ms, maxRetries ${this.maxRetries}`
    );
  }

  private async withRetry<T>(fn: () => Promise<T>, opts?: { fallbackOnTimeout?: () => T }): Promise<T> {
    const maxAttempts = this.maxRetries + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) break;
        if (!isRetryableError(error)) throw error;
        const delay = this.retryDelayMs * (attempt === 1 ? 1 : 2);
        this.logger.warn(
          `LLM attempt ${attempt}/${maxAttempts} failed (retryable), retrying in ${delay}ms`,
          (error as Error)?.message
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (opts?.fallbackOnTimeout && isTimeoutOrAbort(lastError)) {
      return opts.fallbackOnTimeout();
    }
    throw lastError;
  }

  private async logLlmCall<T>(modelUsed: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    logStructured.log("LLM call start", { context: FundingLlmService.name, model: modelUsed });
    try {
      const out = await fn();
      logStructured.log("LLM call success", {
        context: FundingLlmService.name,
        model: modelUsed,
        durationMs: Date.now() - start,
      });
      return out;
    } catch (e) {
      const err = e as { status?: number; message?: string };
      logStructured.error("LLM call failed", {
        context: FundingLlmService.name,
        model: modelUsed,
        durationMs: Date.now() - start,
        message: err?.message,
        errorCode: err?.status,
      });
      throw e;
    }
  }

  private sanitizeUserInput(input: string): string {
    if (!input) return "";
    return input
      .replace(/```/g, "\\`\\`\\`")
      .replace(/\n(system|assistant|user):/gi, "\n[$1]:")
      .replace(/\[INST\]/gi, "[instruction]")
      .replace(/<\|.*?\|>/g, "")
      .replace(/<\/?system>/gi, "[system]")
      .replace(/<\/?instructions?>/gi, "[instructions]")
      .substring(0, 2000);
  }

  getEmailPrompt(): string {
    return `You are a fundraising outreach assistant. Write a donor-specific email based on the template type and context below. Use a professional, warm tone. Personalize using the pipeline and donor profile details when provided. When reference material (REFERENCE LIST) is provided, you may cite specific points using [citation:docId:chunkId]; otherwise write from the org narrative and context only. Keep the email concise (one short paragraph or a few short paragraphs). Do not invent facts not in the context or references.`;
  }

  getDefinitionalExplainPrompt(): string {
    return `You are a funding/grant specialist. Provide a clear, concise explanation using ONLY the evidence provided below.

INSTRUCTIONS:
1. Provide a brief (2-3 sentence) explanation based ONLY on the evidence chunks below
2. Include [citation:docId:chunkId] for EVERY factual statement - use the EXACT docId and chunkId from the reference list
3. Use plain language
4. If helpful, you may end with ONE optional clarifying question

CITATION FORMAT (CRITICAL):
- Use EXACTLY: [citation:docId:chunkId]
- Copy docId and chunkId EXACTLY from the reference list below
- DO NOT use numbered references like [1], [2]

Your response MUST include at least 2 citations or it will be rejected.`;
  }

  async generateWithCitations(
    systemPrompt: string | "explain" | "navigate" | "draft",
    context: string,
    userMessage: string,
    chunks: EvidenceChunk[],
    isIdentifyQuestion: boolean = false,
    conversationContext?: FundingConversationContext,
    isTimeoutRetry: boolean = false
  ): Promise<string> {
    if (chunks.length === 0) {
      return MISSING_EVIDENCE_RESPONSE;
    }

    const actualSystemPrompt =
      systemPrompt === "draft"
        ? "You are a funding draft assistant. Generate a complete response with all 6 required sections. Use ONLY the reference material provided. Cite every factual claim with [citation:docId:chunkId]. For missing facts use TODO:."
        : systemPrompt === "email"
          ? this.getEmailPrompt()
          : typeof systemPrompt === "string"
            ? systemPrompt
            : this.getDefinitionalExplainPrompt();

    const referenceList = chunks
      .map((chunk, index) => {
        const exampleCitation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        return `[${index + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}
   Example citation format: ${exampleCitation}
   Title: ${chunk.document.title}
   Content: ${chunk.content.substring(0, 300)}${chunk.content.length > 300 ? "..." : ""}`;
      })
      .join("\n\n");

    const sanitizedUserMessage = this.sanitizeUserInput(userMessage);
    const checklist = conversationContext?.checklist ?? "";

    const userContent =
      systemPrompt === "draft"
        ? buildFundingCitationInstructions({ referenceList, checklist, sanitizedUserMessage })
        : systemPrompt === "email"
          ? `REFERENCE LIST (optional - cite with [citation:docId:chunkId] when used):\n${referenceList}\n\n${checklist ? `Checklist: ${checklist}\n\n` : ""}Context and request: ${sanitizedUserMessage}\n\nGenerate the email body only (no subject line unless requested).`
          : `${context}\n\nUser question: ${sanitizedUserMessage}\n\nProvide a helpful response based on the reference information above. Use [citation:docId:chunkId] for every factual claim.`;

    return this.logLlmCall(this.model, () =>
      this.withRetry(
        async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
          try {
            const completion = await this.client.chat.completions.create(
              {
                model: this.model,
                messages: [
                  { role: "system", content: actualSystemPrompt },
                  { role: "user", content: userContent },
                ],
                temperature: 0.1, // Low temp for accurate citations
                max_tokens: 3000,
              },
              { signal: controller.signal as AbortSignal }
            );
            clearTimeout(timeoutId);
            const text = completion.choices[0]?.message?.content;
            if (!text || !text.trim()) {
              this.logger.warn("Empty response from LLM");
              return MISSING_EVIDENCE_RESPONSE;
            }

            // Validate citations against provided chunks
            const citationValidation = validateCitations(text, chunks);
            if (citationValidation.invalidCount > 0) {
              this.logger.warn(
                `Citation validation: ${citationValidation.validCount} valid, ${citationValidation.invalidCount} invalid`,
                { invalidCitations: citationValidation.invalidCitations.slice(0, 5) }
              );
            }
            logStructured.log("Citation validation", {
              context: FundingLlmService.name,
              validCitations: citationValidation.validCount,
              invalidCitations: citationValidation.invalidCount,
            });

            return text;
          } catch (error: unknown) {
            clearTimeout(timeoutId);
            const err = error as { name?: string; message?: string };
            if (err.name === "AbortError" || err.message?.includes("timeout") || err.message?.includes("aborted")) {
              this.logger.warn(`LLM timeout after ${this.timeoutMs}ms`);
              throw error;
            }
            this.logger.error(`LLM error: ${err.message}`, (error as Error).stack);
            throw error;
          }
        },
        { fallbackOnTimeout: () => MISSING_EVIDENCE_RESPONSE }
      )
    );
  }

  async generate(systemPrompt: string, context: string, userMessage: string): Promise<string> {
    return this.generateWithCitations(systemPrompt, context, userMessage, []);
  }

  /**
   * Generate text without evidence chunks (e.g. template-only email). Does not return MISSING_EVIDENCE.
   */
  async generatePlain(systemPrompt: string, context: string, userMessage: string, options?: { maxTokens?: number }): Promise<string> {
    const sanitized = this.sanitizeUserInput(userMessage);
    const userContent = `${context}\n\n${sanitized}`;
    const maxTokens = options?.maxTokens ?? 1500;
    return this.logLlmCall(this.model, () =>
      this.withRetry(
        async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const completion = await this.client.chat.completions.create(
            {
              model: this.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              temperature: 0.3,
              max_tokens: maxTokens,
            },
            { signal: controller.signal as AbortSignal }
          );
          clearTimeout(timeoutId);
          const text = completion.choices[0]?.message?.content;
          if (!text || !text.trim()) {
            this.logger.warn("Empty response from LLM (generatePlain)");
            return "";
          }
          return text;
        } catch (error: unknown) {
          clearTimeout(timeoutId);
          const err = error as { name?: string; message?: string };
          if (err.name === "AbortError" || err.message?.includes("timeout") || err.message?.includes("aborted")) {
            this.logger.warn(`LLM timeout after ${this.timeoutMs}ms (generatePlain)`);
            throw error;
          }
          throw error;
        }
      },
        { fallbackOnTimeout: () => "" }
      )
    );
  }

  async generateDefinitionalResponse(
    userMessage: string,
    chunks: EvidenceChunk[],
    conversationContext?: FundingConversationContext
  ): Promise<string> {
    if (chunks.length === 0) {
      return MISSING_EVIDENCE_RESPONSE;
    }
    const systemPrompt = this.getDefinitionalExplainPrompt();
    const referenceList = chunks
      .map((chunk, index) => {
        const exampleCitation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        return `[${index + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}
   Example citation format: ${exampleCitation}
   Title: ${chunk.document.title}
   Content: ${chunk.content.substring(0, 300)}${chunk.content.length > 300 ? "..." : ""}`;
      })
      .join("\n\n");
    const sanitized = this.sanitizeUserInput(userMessage);
    const userContent = `${systemPrompt}

REFERENCE LIST:
${referenceList}

User question: ${sanitized}

YOUR RESPONSE (2-3 sentences with citations):`;

    return this.logLlmCall(this.model, () =>
      this.withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const completion = await this.client.chat.completions.create(
            {
              model: this.model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              temperature: 0.2,
              max_tokens: 500,
            },
            { signal: controller.signal as AbortSignal }
          );
          clearTimeout(timeoutId);
          const text = completion.choices[0]?.message?.content;
          if (!text || !text.trim()) {
            return MISSING_EVIDENCE_RESPONSE;
          }

          // Validate citations
          const citationValidation = validateCitations(text, chunks);
          if (citationValidation.invalidCount > 0) {
            this.logger.warn(
              `Definitional citation validation: ${citationValidation.validCount} valid, ${citationValidation.invalidCount} invalid`
            );
          }

          return text;
        } catch (error: unknown) {
          clearTimeout(timeoutId);
          throw error;
        }
      })
    );
  }

  private async callEvalModel(systemPrompt: string, userContent: string, maxTokens: number = 1000): Promise<string> {
    return this.logLlmCall(this.evalModel, () =>
      this.withRetry(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const completion = await this.client.chat.completions.create(
            {
              model: this.evalModel,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              temperature: 0.2,
              max_tokens: maxTokens,
            },
            { signal: controller.signal as AbortSignal }
          );
          clearTimeout(timeoutId);
          const text = completion.choices[0]?.message?.content;
          return text?.trim() ?? "";
        } catch (error: unknown) {
          clearTimeout(timeoutId);
          throw error;
        }
      })
    );
  }

  async evaluateDraft(draftText: string): Promise<EvaluateResult> {
    const systemPrompt = `You are a proposal evaluator. Score the draft below on a scale of 1-5 for: clarity, fit, specificity, evidence, feasibility. Only comment on what is in the draft; do not hallucinate.

Respond with valid JSON only, in this exact shape:
{"score": <number 1-5>, "dimensions": {"clarity": <1-5>, "fit": <1-5>, "specificity": <1-5>, "evidence": <1-5>, "feasibility": <1-5>}, "weaknesses": ["<weakness 1>", "<weakness 2>", "<weakness 3>"]}
List up to 3 weaknesses. No other text.`;

    const userContent = `Draft to evaluate:\n\n${draftText.substring(0, 8000)}`;
    const text = await this.callEvalModel(systemPrompt, userContent, 500);
    try {
      const parsed = JSON.parse(text) as { score?: number; dimensions?: Record<string, number>; weaknesses?: string[] };
      const score = typeof parsed.score === "number" ? parsed.score : 3;
      const weaknesses = Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [];
      return { score, dimensions: parsed.dimensions, weaknesses };
    } catch {
      this.logger.warn("Failed to parse evaluate JSON, returning fallback");
      return { score: 3, weaknesses: ["Evaluation could not be parsed."] };
    }
  }

  async refineDraft(draftText: string, evaluationNotes: string): Promise<string> {
    const systemPrompt = `You are a proposal editor. Rewrite the draft below to address the improvement notes. Preserve citations in [citation:docId:chunkId] format and evidence. Do not add unsupported claims. Output only the revised draft.`;
    const userContent = `Improvement notes:\n${evaluationNotes}\n\nDraft to revise:\n\n${draftText.substring(0, 12000)}`;
    const text = await this.callEvalModel(systemPrompt, userContent, 4000);
    return text || draftText;
  }

  /** Donor profile generation: structured profile + evidence gaps. Chunks optional. */
  async generateDonorProfile(params: {
    orgName: string;
    urls?: string[];
    notes?: string;
    chunks?: Array<{ content: string; title?: string; url?: string }>;
  }): Promise<DonorProfileResult> {
    const systemPrompt = `You are a fundraising research assistant. Given an organization name and any provided URLs, notes, or reference text, produce a structured donor/funder profile. Do not invent facts not present in the inputs. For missing information, list it in evidenceGaps as TODO items.

Respond with valid JSON only, in this exact shape:
{"mission": "<1-2 sentence mission or focus>", "focusAreas": ["<area1>", "<area2>"], "geographicFocus": "<regions or 'global'>", "pastGrants": "<brief summary or 'unknown'>", "eligibilityNotes": "<who can apply>", "contactNotes": "<how to reach or 'unknown'>", "evidenceGaps": ["<TODO: missing item 1>", "<TODO: missing item 2>"]}
Keep evidenceGaps as a list of concrete next research steps. No other text.`;

    const parts: string[] = [`Organization: ${this.sanitizeUserInput(params.orgName)}`];
    if (params.urls?.length) parts.push(`URLs: ${params.urls.join(", ")}`);
    if (params.notes) parts.push(`Notes: ${this.sanitizeUserInput(params.notes)}`);
    if (params.chunks?.length) {
      parts.push(
        "Reference material:",
        ...params.chunks.map((c) => `[${c.title ?? c.url ?? "chunk"}]\n${c.content.substring(0, 800)}`)
      );
    }
    const userContent = parts.join("\n\n");
    const text = await this.callEvalModel(systemPrompt, userContent, 1500);
    try {
      const parsed = JSON.parse(text) as DonorProfileResult;
      return {
        mission: typeof parsed.mission === "string" ? parsed.mission : "",
        focusAreas: Array.isArray(parsed.focusAreas) ? parsed.focusAreas : [],
        geographicFocus: typeof parsed.geographicFocus === "string" ? parsed.geographicFocus : "",
        pastGrants: typeof parsed.pastGrants === "string" ? parsed.pastGrants : "",
        eligibilityNotes: typeof parsed.eligibilityNotes === "string" ? parsed.eligibilityNotes : "",
        contactNotes: typeof parsed.contactNotes === "string" ? parsed.contactNotes : "",
        evidenceGaps: Array.isArray(parsed.evidenceGaps) ? parsed.evidenceGaps : ["Profile could not be fully parsed."],
      };
    } catch {
      this.logger.warn("Failed to parse donor profile JSON, returning fallback");
      return {
        mission: "",
        focusAreas: [],
        geographicFocus: "",
        pastGrants: "",
        eligibilityNotes: "",
        contactNotes: "",
        evidenceGaps: ["Profile generation could not be parsed; check inputs and retry."],
      };
    }
  }
}

export interface DonorProfileResult {
  mission: string;
  focusAreas: string[];
  geographicFocus: string;
  pastGrants: string;
  eligibilityNotes: string;
  contactNotes: string;
  evidenceGaps: string[];
}
