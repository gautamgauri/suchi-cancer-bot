import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmotionalTone } from "./empathy-detector";
import { detectCancerType } from "./utils/cancer-type-detector";
import { hasGeneralIntentSignal } from "./utils/general-intent";

export type UserContext = "general" | "patient" | "caregiver" | "post_diagnosis";

export interface ContextExtractionResult {
  context?: UserContext;
  cancerType?: string;
  confidence: number;
}

/**
 * Silent, rule-based session context extraction.
 *
 * Every non-emergency turn runs extractContextFromMessage() and persists what it
 * finds (userContext, cancerType, emotionalState) via updateSessionContext().
 * Those Session columns feed IntentClassifier, the query decomposer and the
 * execution planner on later turns.
 *
 * The file keeps its historical name: it used to also host an interactive
 * two-step greeting questionnaire, which never ran in production and was
 * removed.
 */
@Injectable()
export class GreetingFlowService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extract context and cancer type from a user message (rule-based only —
   * no LLM call, so no hidden latency before the main flow).
   */
  async extractContextFromMessage(userText: string): Promise<ContextExtractionResult> {
    return this.extractContextWithRules(userText);
  }

  /**
   * Rule-based context extraction
   */
  private extractContextWithRules(userText: string): ContextExtractionResult {
    const textLower = userText.toLowerCase();
    let context: UserContext | undefined;
    let confidence = 0.3;

    // Check for general intent signals (highest priority for evaluation compatibility)
    if (hasGeneralIntentSignal(userText)) {
      context = "general";
      confidence = 0.95; // Very high confidence for "just generally asking"
    }
    // Check for patient signals
    else if (
      /\b(I have|I'm experiencing|my symptoms|I feel|I'm worried about|I'm concerned about)\b/i.test(userText) ||
      /\b(I found|I noticed|I've had)\b/i.test(userText)
    ) {
      context = "patient";
      confidence = 0.85;
    }
    // Check for caregiver signals
    else if (
      /\b(my (father|mother|parent|sister|brother|uncle|aunt|husband|wife|partner|son|daughter|friend|someone))\b/i.test(userText) ||
      /\b(helping|supporting|taking care of)\b/i.test(userText)
    ) {
      context = "caregiver";
      confidence = 0.85;
    }
    // Check for post-diagnosis signals
    else if (
      /\b(diagnosed|diagnosis|report says|biopsy shows|scan shows|test results|treatment|chemo|radiation)\b/i.test(userText) ||
      /\b(BIRADS|PI-RADS|stage|staging|grade)\b/i.test(userText)
    ) {
      context = "post_diagnosis";
      confidence = 0.85;
    }

    // Extract cancer type
    const cancerType = detectCancerType(userText);

    return {
      context,
      cancerType: cancerType || undefined,
      confidence,
    };
  }

  /**
   * Update session context using raw SQL to avoid schema drift issues
   */
  async updateSessionContext(
    sessionId: string,
    context: {
      userContext?: UserContext;
      cancerType?: string;
      emotionalState?: EmotionalTone;
    }
  ): Promise<void> {
    // Build SET clause dynamically based on what fields are provided
    const updates: string[] = [];
    const values: any[] = [];

    if (context.userContext !== undefined) {
      updates.push(`"userContext" = $${values.length + 1}`);
      values.push(context.userContext);
    }
    if (context.cancerType !== undefined) {
      updates.push(`"cancerType" = $${values.length + 1}`);
      values.push(context.cancerType);
    }
    if (context.emotionalState !== undefined) {
      updates.push(`"emotionalState" = $${values.length + 1}`);
      values.push(context.emotionalState);
    }

    if (updates.length === 0) return; // Nothing to update

    await this.prisma.$executeRawUnsafe(
      `UPDATE "Session" SET ${updates.join(', ')} WHERE id = $${values.length + 1}`,
      ...values, sessionId
    );
  }
}
