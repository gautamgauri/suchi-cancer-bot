import { Injectable } from "@nestjs/common";
import { LlmService } from "../llm/llm.service";

export type EmotionalTone = "anxious" | "calm" | "urgent" | "sad" | "neutral";

export interface EmotionalToneResult {
  tone: EmotionalTone;
  confidence: number;
  keywords: string[];
}

export type MentalHealthCategory = "crisis" | "depression" | "isolation" | "support-seeking" | null;

export interface MentalHealthNeedResult {
  needsSupport: boolean;
  isCrisis: boolean;
  category: MentalHealthCategory;
  keywords: string[];
}

@Injectable()
export class EmpathyDetector {
  // Rule-based patterns for emotional tone detection
  // Expanded to capture common cancer-related emotional expressions
  private static readonly ANXIOUS_PATTERNS = [
    /\b(scared|worried|anxious|fear|nervous|panic|afraid|frightened|terrified)\b/i,
    /\b(concerned|apprehensive|uneasy|stressed|freaking out)\b/i,
    /\b(I'm scared|I'm worried|I'm afraid|I'm nervous)\b/i,
    // Cancer-specific anxiety patterns
    /\b(scared to death|worried sick|can't sleep|keep thinking about)\b/i,
    /\b(what if it's cancer|could this be cancer|am I dying)\b/i,
    /\b(waiting for results|waiting to hear|don't know what to expect)\b/i,
    /\b(my mind is racing|can't stop worrying|so anxious)\b/i,
  ];

  private static readonly URGENT_PATTERNS = [
    /\b(right now|immediately|urgent|emergency|severe|critical)\b/i,
    /\b(asap|as soon as possible|right away)\b/i,
    /\b(can't wait|need help now|urgent help)\b/i,
    // Cancer-specific urgency patterns
    /\b(just found out|just diagnosed|just told me)\b/i,
    /\b(doctor said|oncologist said|results came back)\b/i,
    /\b(starting treatment|surgery scheduled|chemo starts)\b/i,
  ];

  private static readonly SAD_PATTERNS = [
    /\b(sad|depressed|hopeless|difficult|struggling|overwhelmed)\b/i,
    /\b(devastated|heartbroken|down|low|feeling down)\b/i,
    /\b(can't cope|too much|exhausted emotionally)\b/i,
    // Cancer-specific sadness/grief patterns
    /\b(lost my|passed away|terminal|end of life|hospice)\b/i,
    /\b(why me|why us|not fair|so hard)\b/i,
    /\b(don't know how to|feeling helpless|feeling lost)\b/i,
    /\b(crying|tears|grief|mourning|miss)\b/i,
  ];

  private static readonly CALM_PATTERNS = [
    /\b(just asking|curious|wondering|information|learning)\b/i,
    /\b(general question|educational|informational)\b/i,
    /\b(just want to know|seeking information)\b/i,
    // Research/educational patterns
    /\b(for a friend|for school|research|article|studying)\b/i,
    /\b(out of curiosity|hypothetically|in general)\b/i,
  ];

  // NEW: Caregiver-specific patterns (often anxious + supportive)
  private static readonly CAREGIVER_PATTERNS = [
    /\b(my (mom|mother|dad|father|wife|husband|spouse|partner|child|son|daughter|parent|sibling|brother|sister|grandma|grandpa|grandmother|grandfather))\b/i,
    /\b(loved one|family member|taking care of|caring for)\b/i,
    /\b(how can I help|what can I do|how do I support)\b/i,
  ];

  // Crisis indicators (highest priority - immediate resources needed)
  private static readonly CRISIS_PATTERNS = [
    /\b(want to die|end it all|kill myself|suicide|suicidal|no point in living)\b/i,
    /\b(can't go on|don't want to live|better off dead|harm myself)\b/i,
    /\b(ending my life|give up on life|nothing to live for)\b/i,
    /\b(want to hurt myself|self[- ]?harm|cut myself)\b/i,
  ];

  // Mental health support patterns (non-crisis)
  private static readonly MENTAL_HEALTH_PATTERNS = [
    /\b(depressed|depression|feeling hopeless|feel alone|so isolated)\b/i,
    /\b(can't cope anymore|overwhelmed|breaking down|falling apart)\b/i,
    /\b(need someone to talk to|need support|need help emotionally)\b/i,
    /\b(therapy|therapist|counselor|counselling|mental health)\b/i,
    /\b(anxiety|panic attacks|can't sleep|insomnia|nightmares)\b/i,
    /\b(support group|cancer support|emotional support)\b/i,
  ];

  // Loneliness/isolation patterns (common in cancer journey)
  private static readonly ISOLATION_PATTERNS = [
    /\b(feel so alone|no one understands|isolated|lonely)\b/i,
    /\b(friends don't understand|family doesn't get it)\b/i,
    /\b(going through this alone|nobody to talk to)\b/i,
    /\b(feel like a burden|don't want to bother)\b/i,
  ];

  constructor(private readonly llmService?: LlmService) {}

  /**
   * Detect emotional tone from user message
   * Hybrid approach: rule-based first, LLM fallback for ambiguous cases
   */
  async detectEmotionalTone(userText: string): Promise<EmotionalToneResult> {
    const textLower = userText.toLowerCase().trim();

    // Rule-based detection first
    const ruleBasedResult = this.detectWithRules(textLower);

    // If confidence is high enough, return rule-based result
    if (ruleBasedResult.confidence >= 0.6) {
      return ruleBasedResult;
    }

    // LLM fallback for ambiguous cases
    if (this.llmService) {
      try {
        const llmResult = await this.detectWithLLM(userText);
        // Combine rule-based and LLM results
        return {
          tone: llmResult.tone || ruleBasedResult.tone,
          confidence: Math.max(ruleBasedResult.confidence, llmResult.confidence || 0.5),
          keywords: [...ruleBasedResult.keywords, ...(llmResult.keywords || [])],
        };
      } catch (error) {
        // If LLM fails, return rule-based result
        return ruleBasedResult;
      }
    }

    // No LLM available, return rule-based result
    return ruleBasedResult;
  }

  /**
   * Detect if user needs mental health support
   * Returns crisis flag for immediate intervention, or support category for resources
   */
  detectMentalHealthNeed(userText: string): MentalHealthNeedResult {
    const text = userText.toLowerCase().trim();
    const matchedKeywords: string[] = [];

    // Check crisis patterns first (highest priority)
    const crisisMatches = EmpathyDetector.CRISIS_PATTERNS.filter((pattern) => pattern.test(text));
    if (crisisMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.CRISIS_PATTERNS));
      return {
        needsSupport: true,
        isCrisis: true,
        category: "crisis",
        keywords: matchedKeywords,
      };
    }

    // Check isolation patterns (often a sign of needing support)
    const isolationMatches = EmpathyDetector.ISOLATION_PATTERNS.filter((pattern) => pattern.test(text));
    if (isolationMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.ISOLATION_PATTERNS));
      return {
        needsSupport: true,
        isCrisis: false,
        category: "isolation",
        keywords: matchedKeywords,
      };
    }

    // Check general mental health support patterns
    const mhMatches = EmpathyDetector.MENTAL_HEALTH_PATTERNS.filter((pattern) => pattern.test(text));
    if (mhMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.MENTAL_HEALTH_PATTERNS));

      // Distinguish between depression and support-seeking
      const depressionIndicators = /\b(depressed|depression|hopeless|can't cope)\b/i.test(text);
      return {
        needsSupport: true,
        isCrisis: false,
        category: depressionIndicators ? "depression" : "support-seeking",
        keywords: matchedKeywords,
      };
    }

    // No mental health need detected
    return {
      needsSupport: false,
      isCrisis: false,
      category: null,
      keywords: [],
    };
  }

  /**
   * Rule-based emotional tone detection
   */
  private detectWithRules(text: string): EmotionalToneResult {
    const matchedKeywords: string[] = [];
    let tone: EmotionalTone = "neutral";
    let maxMatches = 0;

    // Check if this is a caregiver (affects how we interpret emotions)
    const isCaregiverContext = EmpathyDetector.CAREGIVER_PATTERNS.some((pattern) => pattern.test(text));
    if (isCaregiverContext) {
      matchedKeywords.push("caregiver");
    }

    // Check urgent first (highest priority)
    const urgentMatches = EmpathyDetector.URGENT_PATTERNS.filter((pattern) => pattern.test(text));
    if (urgentMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.URGENT_PATTERNS));
      if (urgentMatches.length > maxMatches) {
        maxMatches = urgentMatches.length;
        tone = "urgent";
      }
    }

    // Check anxious
    const anxiousMatches = EmpathyDetector.ANXIOUS_PATTERNS.filter((pattern) => pattern.test(text));
    if (anxiousMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.ANXIOUS_PATTERNS));
      if (anxiousMatches.length > maxMatches) {
        maxMatches = anxiousMatches.length;
        tone = "anxious";
      }
    }

    // Check sad
    const sadMatches = EmpathyDetector.SAD_PATTERNS.filter((pattern) => pattern.test(text));
    if (sadMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.SAD_PATTERNS));
      if (sadMatches.length > maxMatches) {
        maxMatches = sadMatches.length;
        tone = "sad";
      }
    }

    // Check calm
    const calmMatches = EmpathyDetector.CALM_PATTERNS.filter((pattern) => pattern.test(text));
    if (calmMatches.length > 0) {
      matchedKeywords.push(...this.extractKeywords(text, EmpathyDetector.CALM_PATTERNS));
      if (calmMatches.length > maxMatches) {
        maxMatches = calmMatches.length;
        tone = "calm";
      }
    }

    // Caregiver context with neutral tone -> assume mild anxiety (caring for someone with cancer is stressful)
    if (isCaregiverContext && tone === "neutral") {
      tone = "anxious";
      maxMatches = Math.max(maxMatches, 1);
    }

    // Calculate confidence based on number of matches
    // 1 match = 0.5, 2+ matches = 0.7+, 3+ matches = 0.9+
    const confidence = maxMatches === 0 ? 0.3 : Math.min(0.3 + maxMatches * 0.2, 0.95);

    return {
      tone,
      confidence,
      keywords: [...new Set(matchedKeywords)],
    };
  }

  /**
   * Extract keywords from text that match patterns
   */
  private extractKeywords(text: string, patterns: RegExp[]): string[] {
    const keywords: string[] = [];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        keywords.push(match[0].trim());
      }
    }
    return keywords;
  }

  /**
   * LLM-based emotional tone detection (fallback for ambiguous cases)
   */
  private async detectWithLLM(userText: string): Promise<EmotionalToneResult> {
    if (!this.llmService) {
      throw new Error("LLM service not available");
    }

    const systemPrompt = `You are analyzing the emotional tone of user messages. Return ONLY a JSON object with this exact structure:
{
  "tone": "anxious" | "calm" | "urgent" | "sad" | "neutral",
  "confidence": 0.0-1.0,
  "keywords": ["keyword1", "keyword2"]
}

Return only the JSON object, no other text.`;

    const userPrompt = `Analyze the emotional tone of this user message:

"${userText}"

Return the JSON object with tone, confidence, and keywords.`;

    try {
      const response = await this.llmService.generate(systemPrompt, "", userPrompt);
      // Extract JSON from response (might have extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          tone: result.tone || "neutral",
          confidence: result.confidence || 0.5,
          keywords: result.keywords || [],
        };
      }
      // If no JSON found, return neutral
      return {
        tone: "neutral",
        confidence: 0.3,
        keywords: [],
      };
    } catch (error) {
      // If parsing fails, return neutral
      return {
        tone: "neutral",
        confidence: 0.3,
        keywords: [],
      };
    }
  }
}
