/**
 * Execution Planner — Phase 3
 *
 * Takes a user query + session context and produces a JSON execution plan.
 * The plan is a sequence of steps that the executor will run:
 *   1. Retrieve (with specific intent + params)
 *   2. Template (fill a structured output template)
 *   3. Generate (LLM call with context)
 *   4. Verify (policy check on output)
 *
 * Design principles:
 *  - Zero LLM cost (pure rule-based planning)
 *  - Deterministic: same input → same plan
 *  - Bounded: max 5 retrieval calls, max 1 LLM call
 *  - Plans are JSON-serializable for logging/debugging
 */

import { Injectable, Logger } from "@nestjs/common";
import { AgenticCategory } from "./agentic-intent-router";
import { SessionContext } from "../rag/query-decomposer.service";
import {
  OutputTemplate,
  selectOutputTemplate,
  TEMPLATE_REGISTRY,
} from "./structured-output-templates";

// ─── Plan Step Types ───────────────────────────────────────────

export interface RetrievalStep {
  type: "retrieve";
  intent: string;
  query: string;
  sourceFilter?: string[];
  topK?: number;
  cancerType?: string | null;
  /** Step ID for referencing in later steps */
  stepId: string;
}

export interface TemplateStep {
  type: "template";
  templateId: string;
  /** Which retrieval step IDs feed into this template */
  retrievalStepIds: string[];
  locale: string;
  stepId: string;
}

export interface GenerateStep {
  type: "generate";
  mode: "explain" | "navigate";
  /** Which retrieval step IDs provide evidence */
  retrievalStepIds: string[];
  /** Additional context for the LLM */
  context: {
    cancerType?: string | null;
    emotionalState?: string | null;
    userContext?: string | null;
    intent?: string;
    hasGenerallyAsking?: boolean;
  };
  stepId: string;
}

export interface VerifyStep {
  type: "verify";
  /** Which step ID produced the content to verify */
  contentStepId: string;
  /** Which retrieval step IDs provide the evidence for verification */
  evidenceStepIds: string[];
  checks: VerifyCheck[];
  stepId: string;
}

export type VerifyCheck =
  | "no_diagnosis"
  | "no_prognosis"
  | "no_dosage"
  | "has_disclaimer"
  | "has_citations"
  | "appropriate_tone"
  | "no_ungrounded_entities";

export type PlanStep = RetrievalStep | TemplateStep | GenerateStep | VerifyStep;

// ─── Execution Plan ────────────────────────────────────────────

export interface ExecutionPlan {
  /** Unique plan ID for tracing */
  planId: string;
  /** Steps to execute in order */
  steps: PlanStep[];
  /** The structured template to use (if any) */
  template: OutputTemplate | null;
  /** Planning reasoning (for debugging) */
  reasoning: string;
  /** Detected signals that influenced the plan */
  signals: string[];
  /** Estimated retrieval calls */
  estimatedRetrievalCalls: number;
  /** Whether this plan uses the structured template path */
  usesStructuredTemplate: boolean;
}

// ─── Signal Detection (reuses Phase 2 patterns) ────────────────

interface DetectedSignals {
  signals: string[];
  budgetConcern: boolean;
  locationMentioned: boolean;
  reportReceived: boolean;
  nextSteps: boolean;
  emotionalDistress: boolean;
  hospitalSearch: boolean;
  chemoPrepare: boolean;
  secondOpinion: boolean;
  schemeQuery: boolean;
}

function detectSignals(userText: string, sessionContext?: SessionContext): DetectedSignals {
  const lower = userText.toLowerCase();
  const signals: string[] = [];

  const budgetConcern =
    sessionContext?.budgetConcern ||
    /\b(budget|afford|cost|paisa|paise|kharcha|खर्च|पैसा|गरीब|free|muft|मुफ्त)\b/i.test(lower);
  if (budgetConcern) signals.push("budget_concern");

  const locationMentioned =
    /\b(patna|gaya|muzaffarpur|ranchi|delhi|mumbai|kolkata|lucknow|bihar|jharkhand|up|uttar pradesh)\b/i.test(lower) ||
    /\b(district|city|state|शहर|जिला|राज्य)\b/i.test(lower);
  if (locationMentioned) signals.push("location_mentioned");

  const reportReceived =
    /\b(report|biopsy|pathology|रिपोर्ट|बायोप्सी|result|aa gaya|आ गई|aaya|आया)\b/i.test(lower);
  if (reportReceived) signals.push("report_received");

  const nextSteps =
    /\b(next|aage|आगे|kya kare|क्या करें|what now|what should|kya karna)\b/i.test(lower);
  if (nextSteps) signals.push("next_steps");

  const emotionalDistress =
    /\b(scared|fear|afraid|darr|डर|anxious|worried|tension|चिंता|helpless|hopeless)\b/i.test(lower);
  if (emotionalDistress) signals.push("emotional_distress");

  const hospitalSearch =
    /\b(hospital|अस्पताल|clinic|centre|center|dispensary|kaun sa|कौन सा|best|acha|अच्छा)\b/i.test(lower);
  if (hospitalSearch) signals.push("hospital_search");

  const chemoPrepare =
    /\b(chemo|chemotherapy|कीमो)\b/i.test(lower) &&
    /\b(prepare|ready|day|first|pehla|पहला|तैयारी|tayari|kaise)\b/i.test(lower);
  if (chemoPrepare) signals.push("chemo_prepare");

  const secondOpinion =
    /\b(second opinion|दूसरी राय|dusri|another doctor|aur ek doctor)\b/i.test(lower);
  if (secondOpinion) signals.push("second_opinion");

  const schemeQuery =
    /\b(ayushman|scheme|योजना|आयुष्मान|PMJAY|government|सरकारी|sarkari|card kaise|कार्ड)\b/i.test(lower);
  if (schemeQuery) signals.push("scheme_query");

  return {
    signals,
    budgetConcern,
    locationMentioned,
    reportReceived,
    nextSteps,
    emotionalDistress,
    hospitalSearch,
    chemoPrepare,
    secondOpinion,
    schemeQuery,
  };
}

// ─── Service ───────────────────────────────────────────────────

@Injectable()
export class ExecutionPlannerService {
  private readonly logger = new Logger(ExecutionPlannerService.name);
  private planCounter = 0;

  /**
   * Generate an execution plan for a given query.
   *
   * @returns ExecutionPlan with ordered steps
   */
  plan(
    userText: string,
    category: AgenticCategory,
    sessionContext?: SessionContext,
    locale: string = "en",
    detailedIntent?: string
  ): ExecutionPlan {
    const planId = `plan_${++this.planCounter}_${Date.now()}`;
    const detected = detectSignals(userText, sessionContext);
    const steps: PlanStep[] = [];
    const reasoningParts: string[] = [];

    // 1. Select structured template (if applicable)
    const template = selectOutputTemplate(category, detected.signals, userText);
    const usesStructuredTemplate = template !== null;

    if (usesStructuredTemplate) {
      reasoningParts.push(`Selected template: ${template!.id}`);
    } else {
      reasoningParts.push(`No structured template matched; using LLM generation path`);
    }

    // 2. Plan retrieval steps based on template sections or category
    let retrievalStepIds: string[] = [];

    if (usesStructuredTemplate) {
      // Template-driven retrieval: one retrieval per retrieval-sourced section
      const retrievalSections = template!.sections.filter((s) => s.source === "retrieval");
      const seenIntents = new Set<string>();

      for (const section of retrievalSections) {
        const intent = section.retrievalIntent || "education";
        // Deduplicate retrieval calls with same intent
        if (seenIntents.has(intent)) continue;
        seenIntents.add(intent);

        const stepId = `retrieve_${intent}_${steps.length}`;
        steps.push({
          type: "retrieve",
          intent,
          query: userText,
          cancerType: sessionContext?.cancerType,
          topK: 5,
          stepId,
        });
        retrievalStepIds.push(stepId);
      }

      // Add budget-related retrieval if budget concern detected but no schemes section
      if (detected.budgetConcern && !seenIntents.has("schemes")) {
        const stepId = `retrieve_schemes_budget_${steps.length}`;
        steps.push({
          type: "retrieve",
          intent: "schemes",
          query: userText,
          topK: 4,
          stepId,
        });
        retrievalStepIds.push(stepId);
        reasoningParts.push("Added schemes retrieval for budget concern");
      }

      // Add template step
      steps.push({
        type: "template",
        templateId: template!.id,
        retrievalStepIds,
        locale,
        stepId: `template_${template!.id}`,
      });

      reasoningParts.push(
        `Planned ${retrievalStepIds.length} retrieval(s) for template sections`
      );
    } else {
      // Non-template path: plan retrieval based on category
      const primaryStepId = `retrieve_primary_${steps.length}`;
      const primaryIntent = this.categoryToRetrievalIntent(category);
      steps.push({
        type: "retrieve",
        intent: primaryIntent,
        query: userText,
        cancerType: sessionContext?.cancerType,
        topK: 6,
        stepId: primaryStepId,
      });
      retrievalStepIds.push(primaryStepId);

      // Add secondary retrievals based on signals
      if (detected.budgetConcern && primaryIntent !== "schemes") {
        const stepId = `retrieve_schemes_${steps.length}`;
        steps.push({
          type: "retrieve",
          intent: "schemes",
          query: userText,
          topK: 4,
          stepId,
        });
        retrievalStepIds.push(stepId);
        reasoningParts.push("Added schemes retrieval for budget concern");
      }

      if (detected.emotionalDistress && primaryIntent !== "psychosocial") {
        const stepId = `retrieve_psychosocial_${steps.length}`;
        steps.push({
          type: "retrieve",
          intent: "psychosocial",
          query: userText,
          topK: 3,
          stepId,
        });
        retrievalStepIds.push(stepId);
        reasoningParts.push("Added psychosocial retrieval for emotional distress");
      }

      // Add LLM generation step
      steps.push({
        type: "generate",
        mode: category === "NAVIGATION" ? "navigate" : "explain",
        retrievalStepIds,
        context: {
          cancerType: sessionContext?.cancerType,
          emotionalState: sessionContext?.emotionalState,
          userContext: sessionContext?.userContext,
          intent: detailedIntent,
        },
        stepId: `generate_response`,
      });

      reasoningParts.push(
        `Planned ${retrievalStepIds.length} retrieval(s) + LLM generation`
      );
    }

    // 3. Always add verification step
    const contentStepId = usesStructuredTemplate
      ? `template_${template!.id}`
      : "generate_response";

    steps.push({
      type: "verify",
      contentStepId,
      evidenceStepIds: retrievalStepIds,
      checks: this.getVerifyChecks(category),
      stepId: "verify_output",
    });

    // Cap retrieval calls at 5
    const retrievalCalls = steps.filter((s) => s.type === "retrieve");
    if (retrievalCalls.length > 5) {
      // Remove excess retrieval steps (keep first 5)
      const excessIds = new Set(
        retrievalCalls.slice(5).map((s) => s.stepId)
      );
      const trimmedSteps = steps.filter((s) => !excessIds.has(s.stepId));
      reasoningParts.push(
        `Trimmed ${retrievalCalls.length - 5} excess retrieval calls (max 5)`
      );
      return {
        planId,
        steps: trimmedSteps,
        template,
        reasoning: reasoningParts.join("; "),
        signals: detected.signals,
        estimatedRetrievalCalls: 5,
        usesStructuredTemplate,
      };
    }

    reasoningParts.push(`Signals: [${detected.signals.join(", ")}]`);

    this.logger.debug({
      event: "execution_plan_created",
      planId,
      stepCount: steps.length,
      retrievalCalls: retrievalCalls.length,
      template: template?.id || null,
      signals: detected.signals,
    });

    return {
      planId,
      steps,
      template,
      reasoning: reasoningParts.join("; "),
      signals: detected.signals,
      estimatedRetrievalCalls: retrievalCalls.length,
      usesStructuredTemplate,
    };
  }

  /**
   * Quick check: does this query benefit from Phase 3 planning?
   * Returns false for simple education queries that the existing flow handles well.
   */
  needsPlanning(
    userText: string,
    category: AgenticCategory,
    detailedIntent?: string
  ): boolean {
    // Emergency is handled by fast-path, never needs planning
    if (category === "EMERGENCY") return false;

    // Simple education queries don't need planning
    if (
      category === "EDUCATION" &&
      detailedIntent &&
      [
        "INFORMATIONAL_GENERAL",
        "INFORMATIONAL_SYMPTOMS",
        "GREETING_ONLY",
      ].includes(detailedIntent)
    ) {
      // Check if query has additional signals that warrant planning
      const detected = detectSignals(userText);
      if (detected.signals.length === 0) return false;
    }

    // Admin queries are template-only, no planning needed
    if (category === "ADMIN") return false;

    // Navigation, Schemes, Psychosocial always benefit from planning
    if (["NAVIGATION", "SCHEMES", "PSYCHOSOCIAL"].includes(category)) {
      return true;
    }

    // Education with multiple signals benefits from planning
    const detected = detectSignals(userText);
    return detected.signals.length >= 2;
  }

  /**
   * Map agentic category to primary retrieval intent.
   */
  private categoryToRetrievalIntent(category: AgenticCategory): string {
    const map: Record<string, string> = {
      NAVIGATION: "navigation",
      SCHEMES: "schemes",
      PSYCHOSOCIAL: "psychosocial",
      EDUCATION: "education",
      ADMIN: "education",
      EMERGENCY: "education",
    };
    return map[category] || "education";
  }

  /**
   * Get verification checks appropriate for the category.
   */
  private getVerifyChecks(category: AgenticCategory): VerifyCheck[] {
    const baseChecks: VerifyCheck[] = [
      "no_diagnosis",
      "no_prognosis",
      "no_dosage",
      "has_disclaimer",
      "appropriate_tone",
    ];

    // Citations required for education/navigation with retrieval
    if (["EDUCATION", "NAVIGATION"].includes(category)) {
      baseChecks.push("has_citations");
      baseChecks.push("no_ungrounded_entities");
    }

    return baseChecks;
  }
}
