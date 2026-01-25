import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmpathyDetector, EmotionalTone } from "./empathy-detector";
import { detectCancerType } from "./utils/cancer-type-detector";
import { hasGeneralIntentSignal } from "./utils/general-intent";
import { LlmService } from "../llm/llm.service";

export type UserContext = "general" | "patient" | "caregiver" | "post_diagnosis";

export interface ContextExtractionResult {
  context?: UserContext;
  cancerType?: string;
  confidence: number;
}

export interface GreetingResponseParseResult {
  context?: UserContext;
  cancerType?: string;
  nextStep?: number;
  emotionalTone?: EmotionalTone;
}

@Injectable()
export class GreetingFlowService {
  private readonly logger = new Logger(GreetingFlowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly empathyDetector: EmpathyDetector,
    private readonly llmService?: LlmService
  ) {}

  /**
   * Check if greeting flow is needed for this session
   */
  async needsGreetingFlow(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return false;
    }

    // If greeting already completed, no need for flow
    if (session.greetingCompleted) {
      return false;
    }

    // Check message count - if first message, might need greeting
    const messageCount = await this.prisma.message.count({
      where: { sessionId },
    });

    // If no messages yet, greeting flow might be needed
    // But we'll check in chat service if it's actually a greeting
    return messageCount === 0;
  }

  /**
   * Extract context from user message (hybrid: rules first, LLM fallback)
   * This is called even when greeting flow is bypassed to extract context silently
   */
  async extractContextFromMessage(userText: string): Promise<ContextExtractionResult> {
    // Rule-based extraction first
    const ruleBasedResult = this.extractContextWithRules(userText);

    // If confidence is high enough, return rule-based result
    if (ruleBasedResult.confidence >= 0.7) {
      return ruleBasedResult;
    }

    // LLM fallback for ambiguous cases
    if (this.llmService) {
      try {
        const llmResult = await this.extractContextWithLLM(userText);
        // Combine results, preferring LLM if it has higher confidence
        return {
          context: llmResult.context || ruleBasedResult.context,
          cancerType: llmResult.cancerType || ruleBasedResult.cancerType,
          confidence: Math.max(ruleBasedResult.confidence, llmResult.confidence || 0.5),
        };
      } catch (error) {
        this.logger.warn(`LLM context extraction failed: ${error.message}`);
        return ruleBasedResult;
      }
    }

    return ruleBasedResult;
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
   * LLM-based context extraction (fallback for ambiguous cases)
   */
  private async extractContextWithLLM(userText: string): Promise<ContextExtractionResult> {
    if (!this.llmService) {
      throw new Error("LLM service not available");
    }

    const systemPrompt = `You are analyzing user messages to determine their context. Return ONLY a JSON object with this exact structure:
{
  "context": "general" | "patient" | "caregiver" | "post_diagnosis" | null,
  "cancerType": "breast" | "lung" | "prostate" | etc. | null,
  "confidence": 0.0-1.0
}

Context definitions:
- "general": User is seeking general/educational information, not personal
- "patient": User is describing their own symptoms or concerns
- "caregiver": User is supporting someone else (mentions "my father", "my mother", etc.)
- "post_diagnosis": User mentions diagnosis, reports, treatment, staging

Return only the JSON object, no other text.`;

    const userPrompt = `Analyze this user message and extract context and cancer type:

"${userText}"

Return the JSON object with context, cancerType, and confidence.`;

    try {
      const response = await this.llmService.generate(systemPrompt, "", userPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          context: result.context || undefined,
          cancerType: result.cancerType || undefined,
          confidence: result.confidence || 0.5,
        };
      }
      return { confidence: 0.3 };
    } catch (error) {
      this.logger.warn(`LLM context extraction failed: ${error.message}`);
      return { confidence: 0.3 };
    }
  }

  /**
   * Parse user response to greeting questions
   */
  async parseGreetingResponse(
    userText: string,
    currentStep: number
  ): Promise<GreetingResponseParseResult> {
    // Extract context and emotional tone
    const contextResult = await this.extractContextFromMessage(userText);
    const emotionalToneResult = await this.empathyDetector.detectEmotionalTone(userText);

    let nextStep: number | undefined;

    // Step 1: User selects context type
    if (currentStep === 1) {
      if (contextResult.context) {
        // If context is patient, caregiver, or post_diagnosis, ask for cancer type
        if (["patient", "caregiver", "post_diagnosis"].includes(contextResult.context)) {
          nextStep = 2;
        } else {
          // General context, no need for cancer type
          nextStep = 3; // Complete
        }
      } else {
        // Couldn't determine context, ask again
        nextStep = 1;
      }
    }
    // Step 2: User provides cancer type
    else if (currentStep === 2) {
      if (contextResult.cancerType) {
        nextStep = 3; // Complete
      } else {
        // Couldn't determine cancer type, ask again or allow "not sure"
        if (/\b(not sure|don't know|unsure|general|any)\b/i.test(userText)) {
          nextStep = 3; // Complete without specific cancer type
        } else {
          nextStep = 2; // Ask again
        }
      }
    }

    return {
      context: contextResult.context,
      cancerType: contextResult.cancerType,
      nextStep,
      emotionalTone: emotionalToneResult.tone,
    };
  }

  /**
   * Update session context
   */
  async updateSessionContext(
    sessionId: string,
    context: {
      userContext?: UserContext;
      cancerType?: string;
      emotionalState?: EmotionalTone;
      greetingCompleted?: boolean;
      currentGreetingStep?: number;
    }
  ): Promise<void> {
    try {
      const updateData: any = {
        userContext: context.userContext || undefined,
        cancerType: context.cancerType || undefined,
        emotionalState: context.emotionalState || undefined,
        greetingCompleted: context.greetingCompleted !== undefined ? context.greetingCompleted : undefined,
      };
      
      // Only include currentGreetingStep if migration has been applied
      if (context.currentGreetingStep !== undefined) {
        updateData.currentGreetingStep = context.currentGreetingStep;
      }

      await this.prisma.session.update({
        where: { id: sessionId },
        data: updateData,
      });
    } catch (error: any) {
      // If currentGreetingStep column doesn't exist, try update without it
      if (error.message?.includes('currentGreetingStep') || error.code === 'P2021' || error.message?.includes('Unknown column') || error.message?.includes('column') && error.message?.includes('does not exist')) {
        this.logger.warn(`currentGreetingStep column may not exist, updating without it: ${error.message}`);
        await this.prisma.session.update({
          where: { id: sessionId },
          data: {
            userContext: context.userContext || undefined,
            cancerType: context.cancerType || undefined,
            emotionalState: context.emotionalState || undefined,
            greetingCompleted: context.greetingCompleted !== undefined ? context.greetingCompleted : undefined,
          },
        });
      } else {
        throw error; // Re-throw if it's a different error
      }
    }
  }

  /**
   * Get current greeting step for session
   * Uses explicit currentGreetingStep if available, otherwise infers from state
   */
  async getGreetingStep(sessionId: string): Promise<number> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
      });

      if (!session || session.greetingCompleted) {
        return 0; // No greeting flow needed
      }

      // Use explicit step if available (preferred)
      // Handle case where currentGreetingStep column might not exist (migration not applied)
      const step = (session as any).currentGreetingStep;
      if (step !== null && step !== undefined) {
        return step;
      }

      // Fallback: Infer from message history and session state (for backward compatibility)
      const messages = await this.prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
      });

      const assistantMessages = messages.filter((m) => m.role === "assistant");

      // If no assistant messages yet, we're at step 1
      if (assistantMessages.length === 0) {
        return 1;
      }

      // If we have context but no cancer type, we're at step 2
      if (session.userContext && !session.cancerType) {
        if (["patient", "caregiver", "post_diagnosis"].includes(session.userContext)) {
          return 2;
        }
      }

      // Otherwise, greeting should be complete
      return 3;
    } catch (error: any) {
      // If column doesn't exist, fall through to inference logic
      this.logger.warn(`Error getting greeting step (column may not exist): ${error.message}`);
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { greetingCompleted: true, userContext: true, cancerType: true },
      });
      if (!session || session.greetingCompleted) {
        return 0;
      }

      // Infer from message history
      const messages = await this.prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
      });

      const assistantMessages = messages.filter((m) => m.role === "assistant");
      if (assistantMessages.length === 0) {
        return 1;
      }

      if (session.userContext && !session.cancerType) {
        if (["patient", "caregiver", "post_diagnosis"].includes(session.userContext)) {
          return 2;
        }
      }

      return 3;
    }
  }

  /**
   * Check if greeting flow is in progress (not completed but has started)
   */
  async isGreetingFlowInProgress(sessionId: string): Promise<boolean> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { greetingCompleted: true, currentGreetingStep: true },
      });

      if (!session) {
        return false;
      }

      // Flow is in progress if not completed and step > 0
      // Handle case where currentGreetingStep column might not exist (migration not applied)
      const step = (session as any).currentGreetingStep;
      return !session.greetingCompleted && (step ?? 0) > 0;
    } catch (error: any) {
      // If column doesn't exist (migration not applied), fall back to checking message count
      this.logger.warn(`Error checking greeting flow progress (column may not exist): ${error.message}`);
      const messageCount = await this.prisma.message.count({
        where: { sessionId, role: "assistant" },
      });
      // If there are assistant messages but greeting not completed, flow might be in progress
      return messageCount > 0;
    }
  }

  /**
   * Handle greeting flow interruption - complete flow silently using extracted context
   */
  async handleGreetingFlowInterruption(
    sessionId: string,
    contextResult: ContextExtractionResult,
    emotionalTone?: EmotionalTone
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.greetingCompleted) {
      return; // Not in greeting flow
    }

    // Complete the greeting flow silently
    await this.updateSessionContext(sessionId, {
      userContext: contextResult.context || session.userContext || "general",
      cancerType: contextResult.cancerType || session.cancerType,
      emotionalState: emotionalTone || (session.emotionalState as EmotionalTone),
      greetingCompleted: true,
      currentGreetingStep: 3,
    });

    this.logger.log(`Greeting flow completed silently due to interruption for session ${sessionId}`);
  }
}
