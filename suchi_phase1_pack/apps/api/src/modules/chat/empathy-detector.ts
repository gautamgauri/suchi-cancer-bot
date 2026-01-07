import { Injectable } from "@nestjs/common";
import { LlmService } from "../llm/llm.service";

export type EmotionalTone = "anxious" | "calm" | "urgent" | "sad" | "neutral";

export interface EmotionalToneResult {
  tone: EmotionalTone;
  confidence: number;
  keywords: string[];
}

@Injectable()
export class EmpathyDetector {
  // Rule-based patterns for emotional tone detection
  private static readonly ANXIOUS_PATTERNS = [
    /\b(scared|worried|anxious|fear|nervous|panic|afraid|frightened|terrified)\b/i,
    /\b(concerned|apprehensive|uneasy|stressed)\b/i,
    /\b(I'm scared|I'm worried|I'm afraid|I'm nervous)\b/i,
  ];

  private static readonly URGENT_PATTERNS = [
    /\b(right now|immediately|urgent|emergency|severe|critical)\b/i,
    /\b(asap|as soon as possible|right away)\b/i,
    /\b(can't wait|need help now|urgent help)\b/i,
  ];

  private static readonly SAD_PATTERNS = [
    /\b(sad|depressed|hopeless|difficult|struggling|overwhelmed)\b/i,
    /\b(devastated|heartbroken|down|low|feeling down)\b/i,
    /\b(can't cope|too much|exhausted emotionally)\b/i,
  ];

  private static readonly CALM_PATTERNS = [
    /\b(just asking|curious|wondering|information|learning)\b/i,
    /\b(general question|educational|informational)\b/i,
    /\b(just want to know|seeking information)\b/i,
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
   * Rule-based emotional tone detection
   */
  private detectWithRules(text: string): EmotionalToneResult {
    const matchedKeywords: string[] = [];
    let tone: EmotionalTone = "neutral";
    let maxMatches = 0;

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
