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
    }
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        userContext: context.userContext || undefined,
        cancerType: context.cancerType || undefined,
        emotionalState: context.emotionalState || undefined,
        greetingCompleted: context.greetingCompleted !== undefined ? context.greetingCompleted : undefined,
      },
    });
  }

  /**
   * Get current greeting step for session
   */
  async getGreetingStep(sessionId: string): Promise<number> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.greetingCompleted) {
      return 0; // No greeting flow needed
    }

    // Check message history to determine step
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });

    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const userMessages = messages.filter((m) => m.role === "user");

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
  }
}
