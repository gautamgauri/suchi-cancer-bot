/**
 * Plan Executor — Phase 3
 *
 * Takes an ExecutionPlan and runs each step sequentially:
 *  1. Retrieval steps → call RetrievalToolService
 *  2. Template steps → fill structured templates with retrieval results
 *  3. Generate steps → call LLM with evidence
 *  4. Verify steps → run output verifier
 *
 * The executor accumulates results in a StepResults map,
 * where each step can reference previous step outputs.
 *
 * Design principles:
 *  - Steps run in dependency order (retrieval before template/generate)
 *  - Parallel retrieval when steps are independent
 *  - Bounded: max 1 LLM call, max 5 retrieval calls
 *  - Graceful degradation: if a step fails, continue with available data
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  ExecutionPlan,
  HospitalSearchResult,
  PlanStep,
  RetrievalStep,
  TemplateStep,
  GenerateStep,
  VerifyStep,
} from "./execution-planner.service";
import {
  TEMPLATE_REGISTRY,
  renderTemplate,
} from "./structured-output-templates";
import { RetrievalToolService } from "../rag/retrieval-tool.service";
import { OutputVerifierService, VerificationResult } from "./output-verifier.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

// ─── Step Results ──────────────────────────────────────────────

export interface RetrievalStepResult {
  type: "retrieve";
  stepId: string;
  chunks: EvidenceChunk[];
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface TemplateStepResult {
  type: "template";
  stepId: string;
  renderedContent: string;
  filledSections: string[];
  success: boolean;
}

export interface GenerateStepResult {
  type: "generate";
  stepId: string;
  /** Generated content (to be filled by ChatService since it owns LLM) */
  pendingGeneration: true;
  evidenceChunks: EvidenceChunk[];
  success: boolean;
}

export interface VerifyStepResult {
  type: "verify";
  stepId: string;
  verification: VerificationResult;
  success: boolean;
}

export type StepResult =
  | RetrievalStepResult
  | TemplateStepResult
  | GenerateStepResult
  | VerifyStepResult;

// ─── Execution Result ──────────────────────────────────────────

export interface PlanExecutionResult {
  /** The plan that was executed */
  planId: string;
  /** Results by step ID */
  stepResults: Map<string, StepResult>;
  /** The final response text (from template or pending LLM) */
  responseText: string | null;
  /** Merged evidence chunks from all retrieval steps */
  mergedChunks: EvidenceChunk[];
  /** Whether a structured template was used */
  usedTemplate: boolean;
  /** Whether the response needs LLM generation (non-template path) */
  needsLlmGeneration: boolean;
  /** Verification result (if verify step ran) */
  verification: VerificationResult | null;
  /** Total execution time */
  totalLatencyMs: number;
  /** Errors encountered */
  errors: string[];
  /** Structured hospital results from HospitalDirectoryService (when hospital_search detected) */
  structuredHospitalResults?: HospitalSearchResult[] | null;
}

// ─── Service ───────────────────────────────────────────────────

@Injectable()
export class PlanExecutorService {
  private readonly logger = new Logger(PlanExecutorService.name);

  constructor(
    private readonly retrievalTool: RetrievalToolService,
    private readonly outputVerifier: OutputVerifierService
  ) {}

  /**
   * Execute a plan step by step.
   * Retrieval steps that are independent run in parallel.
   * Template/Generate steps run after their dependencies.
   */
  async execute(
    plan: ExecutionPlan,
    userText: string,
    locale: string = "en"
  ): Promise<PlanExecutionResult> {
    const started = Date.now();
    const stepResults = new Map<string, StepResult>();
    const errors: string[] = [];

    // 1. Execute all retrieval steps in parallel
    const retrievalSteps = plan.steps.filter(
      (s): s is RetrievalStep => s.type === "retrieve"
    );

    if (retrievalSteps.length > 0) {
      const retrievalResults = await Promise.allSettled(
        retrievalSteps.map((step) => this.executeRetrievalStep(step))
      );

      for (let i = 0; i < retrievalSteps.length; i++) {
        const result = retrievalResults[i];
        if (result.status === "fulfilled") {
          stepResults.set(retrievalSteps[i].stepId, result.value);
        } else {
          const errorResult: RetrievalStepResult = {
            type: "retrieve",
            stepId: retrievalSteps[i].stepId,
            chunks: [],
            latencyMs: 0,
            success: false,
            error: result.reason?.message || "Unknown retrieval error",
          };
          stepResults.set(retrievalSteps[i].stepId, errorResult);
          errors.push(
            `Retrieval step ${retrievalSteps[i].stepId} failed: ${result.reason?.message}`
          );
        }
      }
    }

    // 2. Merge all retrieved chunks (deduplicated by chunkId)
    const mergedChunks = this.mergeChunks(stepResults);

    // 3. Execute template or generate steps
    let responseText: string | null = null;
    let needsLlmGeneration = false;

    const templateSteps = plan.steps.filter(
      (s): s is TemplateStep => s.type === "template"
    );
    const generateSteps = plan.steps.filter(
      (s): s is GenerateStep => s.type === "generate"
    );

    if (templateSteps.length > 0) {
      // Template path: fill template with retrieval results
      const templateStep = templateSteps[0]; // Only use first template
      const result = this.executeTemplateStep(
        templateStep,
        stepResults,
        mergedChunks,
        locale
      );
      stepResults.set(templateStep.stepId, result);
      responseText = result.renderedContent;
    }

    if (generateSteps.length > 0 && !responseText) {
      // Generate path: signal that LLM generation is needed
      const generateStep = generateSteps[0];
      const result: GenerateStepResult = {
        type: "generate",
        stepId: generateStep.stepId,
        pendingGeneration: true,
        evidenceChunks: mergedChunks,
        success: true,
      };
      stepResults.set(generateStep.stepId, result);
      needsLlmGeneration = true;
    }

    // 4. Execute verification step (if template produced content)
    let verification: VerificationResult | null = null;
    const verifySteps = plan.steps.filter(
      (s): s is VerifyStep => s.type === "verify"
    );

    if (verifySteps.length > 0 && responseText) {
      const verifyStep = verifySteps[0];
      verification = this.outputVerifier.verify(
        responseText,
        mergedChunks,
        verifyStep.checks,
        userText
      );

      const verifyResult: VerifyStepResult = {
        type: "verify",
        stepId: verifyStep.stepId,
        verification,
        success: verification.passed,
      };
      stepResults.set(verifyStep.stepId, verifyResult);

      // Apply verification fixes if needed
      if (!verification.passed && verification.fixedContent) {
        responseText = verification.fixedContent;
        this.logger.log({
          event: "verification_auto_fixed",
          planId: plan.planId,
          violations: verification.violations.map((v) => v.check),
        });
      }
    }

    const totalLatencyMs = Date.now() - started;

    this.logger.log({
      event: "plan_execution_complete",
      planId: plan.planId,
      totalSteps: plan.steps.length,
      completedSteps: stepResults.size,
      retrievalChunks: mergedChunks.length,
      usedTemplate: plan.usesStructuredTemplate,
      needsLlmGeneration,
      verificationPassed: verification?.passed ?? null,
      totalLatencyMs,
      errors: errors.length > 0 ? errors : undefined,
    });

    return {
      planId: plan.planId,
      stepResults,
      responseText,
      mergedChunks,
      usedTemplate: plan.usesStructuredTemplate,
      needsLlmGeneration,
      verification,
      totalLatencyMs,
      errors,
      structuredHospitalResults: plan.structuredHospitalResults ?? null,
    };
  }

  /**
   * Execute a single retrieval step.
   */
  private async executeRetrievalStep(
    step: RetrievalStep
  ): Promise<RetrievalStepResult> {
    const started = Date.now();
    try {
      const result = await this.retrievalTool.retrieve({
        query: step.query,
        intent: step.intent as any,
        sourceFilter: step.sourceFilter,
        topK: step.topK || 5,
        cancerType: step.cancerType,
      });

      return {
        type: "retrieve",
        stepId: step.stepId,
        chunks: result.chunks,
        latencyMs: Date.now() - started,
        success: true,
      };
    } catch (error: any) {
      this.logger.warn({
        event: "retrieval_step_failed",
        stepId: step.stepId,
        error: error.message,
      });
      return {
        type: "retrieve",
        stepId: step.stepId,
        chunks: [],
        latencyMs: Date.now() - started,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute a template step: fill sections with retrieval content.
   */
  private executeTemplateStep(
    step: TemplateStep,
    stepResults: Map<string, StepResult>,
    mergedChunks: EvidenceChunk[],
    locale: string
  ): TemplateStepResult {
    const template = TEMPLATE_REGISTRY[step.templateId];
    if (!template) {
      return {
        type: "template",
        stepId: step.stepId,
        renderedContent: "",
        filledSections: [],
        success: false,
      };
    }

    const filledSections = new Map<string, string>();
    const filledIds: string[] = [];

    for (const section of template.sections) {
      if (section.source === "template" && section.staticContent) {
        // Static content — use as-is
        filledSections.set(section.id, section.staticContent);
        filledIds.push(section.id);
      } else if (section.source === "retrieval") {
        // Fill from retrieval results
        const intent = section.retrievalIntent || "education";
        // Find chunks that match this intent (from any retrieval step)
        const relevantChunks = this.findChunksForIntent(
          intent,
          mergedChunks,
          stepResults
        );

        if (relevantChunks.length > 0) {
          const maxItems = section.maxItems || 5;
          const content = this.formatChunksAsContent(
            relevantChunks.slice(0, maxItems)
          );
          filledSections.set(section.id, content);
          filledIds.push(section.id);
        }
        // If no chunks found, section stays empty (renderTemplate handles this)
      }
    }

    const renderedContent = renderTemplate(template, filledSections, locale);

    return {
      type: "template",
      stepId: step.stepId,
      renderedContent,
      filledSections: filledIds,
      success: true,
    };
  }

  /**
   * Merge chunks from all retrieval step results, deduplicating by chunkId.
   */
  private mergeChunks(
    stepResults: Map<string, StepResult>
  ): EvidenceChunk[] {
    const seen = new Set<string>();
    const merged: EvidenceChunk[] = [];

    for (const [, result] of stepResults) {
      if (result.type === "retrieve" && result.success) {
        for (const chunk of result.chunks) {
          if (!seen.has(chunk.chunkId)) {
            seen.add(chunk.chunkId);
            merged.push(chunk);
          }
        }
      }
    }

    // Sort by similarity (highest first)
    merged.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    return merged;
  }

  /**
   * Find chunks relevant to a specific retrieval intent.
   */
  private findChunksForIntent(
    intent: string,
    allChunks: EvidenceChunk[],
    stepResults: Map<string, StepResult>
  ): EvidenceChunk[] {
    // First, try to find a retrieval step that matches this intent
    for (const [stepId, result] of stepResults) {
      if (
        result.type === "retrieve" &&
        result.success &&
        stepId.includes(intent)
      ) {
        return result.chunks;
      }
    }

    // Fallback: return all chunks (the template will use what's available)
    return allChunks;
  }

  /**
   * Format evidence chunks as readable content for template sections.
   * Extracts key information and formats with citations.
   *
   * Chunks whose summary is textually identical to one already emitted are
   * dropped. Retrieval dedupes by chunkId, which does NOT catch two distinct
   * chunk rows carrying the same text (e.g. stale chunk rows left behind by an
   * earlier ingest run) — those reached the reader as the same sentence printed
   * twice in a row. See issue #67.
   */
  private formatChunksAsContent(chunks: EvidenceChunk[]): string {
    if (chunks.length === 0) return "";

    const lines: string[] = [];
    const seenSummaries = new Set<string>();
    for (const chunk of chunks) {
      // Extract a clean summary from the chunk content
      const summary = this.extractSummary(chunk.content);
      if (!summary) continue;

      const fingerprint = summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seenSummaries.has(fingerprint)) {
        this.logger.debug({
          event: "duplicate_chunk_summary_skipped",
          chunkId: chunk.chunkId,
          docId: chunk.docId,
          summary: summary.substring(0, 80),
        });
        continue;
      }
      seenSummaries.add(fingerprint);

      const citation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
      lines.push(`- ${summary} ${citation}`);
    }

    return lines.join("\n");
  }

  /**
   * Extract a clean summary from chunk content (first ~100 chars of meaningful text).
   *
   * A chunk usually opens with its markdown heading. Stripping the heading markers
   * along with the newline that followed them ran the heading straight into the
   * body ("Chemotherapy can cause side effects Chemotherapy not only kills…"), so
   * the heading is separated out and re-attached with a colon. See issue #67.
   */
  private extractSummary(content: string): string {
    // Strip heading markers and bold, but keep the line structure so a heading
    // stays a distinct line rather than colliding with the paragraph beneath it.
    const lines = content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/^\s*#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) return "";

    // A short opening line with no terminal punctuation is a heading, not prose.
    const looksLikeHeading =
      lines.length > 1 && lines[0].length <= 100 && !/[.!?:]$/.test(lines[0]);
    const heading = looksLikeHeading ? lines[0] : null;
    const body = (looksLikeHeading ? lines.slice(1) : lines).join(" ").replace(/\s+/g, " ").trim();

    const prefix = heading ? `${heading}: ` : "";
    const summary = this.firstSentenceOrTruncate(body);
    return summary ? `${prefix}${summary}` : heading || "";
  }

  /** First sentence of `text`, or a word-boundary truncation when there is none. */
  private firstSentenceOrTruncate(text: string): string {
    if (!text) return "";

    // Take first sentence or first 150 chars
    const firstSentenceMatch = text.match(/^[^.!?]+[.!?]/);
    if (firstSentenceMatch && firstSentenceMatch[0].length <= 200) {
      return firstSentenceMatch[0].trim();
    }

    // Truncate at word boundary
    if (text.length > 150) {
      const truncated = text.substring(0, 150);
      const lastSpace = truncated.lastIndexOf(" ");
      return truncated.substring(0, lastSpace > 80 ? lastSpace : 150) + "...";
    }

    return text;
  }
}
