/**
 * Mode Detection System
 * Distinguishes between Explain Mode (information-first) and Navigate Mode (personal symptom support)
 */

export type InteractionMode = "explain" | "navigate";

export class ModeDetector {
  /**
   * Detect interaction mode based on user text patterns
   * @param userText User's message
   * @returns "explain" for general informational questions, "navigate" for personal symptom support
   */
  static detectMode(userText: string): InteractionMode {
    const text = userText.trim();
    const lowerText = text.toLowerCase();

    // Identify patterns - check these first to gate properly
    const identifyPatterns = [
      /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i
    ];

    // Check for identify patterns first - if found, gate by personal signals
    const hasIdentifyPattern = identifyPatterns.some(pattern => pattern.test(text));
    if (hasIdentifyPattern) {
      // If identify pattern + personal signal → NAVIGATE mode
      if (ModeDetector.hasPersonalDiagnosisSignal(text)) {
        return "navigate";
      }
      // If identify pattern + no personal signal → EXPLAIN mode
      return "explain";
    }

    // Navigate Mode patterns - personal references
    const navigatePatterns = [
      // First-person pronouns with medical context
      /\b(I|my|me|myself)\b/i,
      // Personal experience statements
      /\b(I am|I'm|I have|I've been|I feel|I notice|I've noticed)\b/i,
      // Possessive medical references
      /\b(my|my own)\s+(symptom|symptoms|report|scan|test|diagnosis|treatment|condition|pain|ache)\b/i,
      // Personal context with medical keywords
      /\b(me|myself|personally)\b.*\b(symptom|symptom|report|scan|test|diagnosis|treatment|cancer|tumor)\b/i,
      // Direct personal statements
      /\b(I'm experiencing|I am experiencing|I have been experiencing)\b/i,
      // Personal questions about self
      /\b(should I|do I have|am I|is my|my doctor|my treatment|my symptoms)\b/i
    ];

    // Check for Navigate Mode patterns
    const hasPersonalReference = navigatePatterns.some(pattern => pattern.test(text));

    // Explain Mode patterns - general informational questions
    const explainPatterns = [
      // General question starters
      /\b(what are|what is|what do|how do|tell me about|explain|describe|list)\b/i,
      // General information requests
      /\b(common|typical|general|usually|often|typically)\b/i,
      // Educational intent
      /\b(information about|learn about|understand|know about)\b/i,
      // "How to identify" patterns - general informational questions about symptoms/signs
      /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i
    ];

    // If we have personal references, it's Navigate Mode
    if (hasPersonalReference) {
      return "navigate";
    }

    // If we have general question patterns and NO personal references, it's Explain Mode
    const hasGeneralQuestion = explainPatterns.some(pattern => pattern.test(text));
    if (hasGeneralQuestion && !hasPersonalReference) {
      return "explain";
    }

    // Default: if text is short and unclear, check for medical keywords
    // If it has medical keywords but no personal reference, assume Explain Mode
    const hasMedicalKeywords = /\b(cancer|tumor|symptom|treatment|diagnosis|lymphoma|breast|lung|colon)\b/i.test(text);
    if (hasMedicalKeywords && !hasPersonalReference) {
      return "explain";
    }

    // Default to Explain Mode for ambiguous cases (better to answer than to assume personal)
    return "explain";
  }

  /**
   * Check if text contains personal references
   */
  static hasPersonalReference(text: string): boolean {
    const navigatePatterns = [
      /\b(I|my|me|myself)\b/i,
      /\b(I am|I'm|I have|I've been|I feel|I notice)\b/i,
      /\b(my|my own)\s+(symptom|symptoms|report|scan|test|diagnosis|treatment)\b/i
    ];
    return navigatePatterns.some(pattern => pattern.test(text));
  }

  /**
   * Check if text contains personal diagnosis-style signals
   * Used to distinguish "how to identify X" (general) from "identify if I have X" (personal)
   * Patterns:
   * - First-person: I, I'm, me, my, mine
   * - Second-person direct: do I, can I, should I, am I
   * - Someone-specific: my mother, my father, my wife, my husband, my child, my friend, he has, she has
   * - Symptom framing: I have, I got, I feel, experiencing, suffering from
   */
  static hasPersonalDiagnosisSignal(text: string): boolean {
    const personalSignals = [
      // First-person pronouns
      /\b(i|i'm|im|me|my|mine)\b/i,
      // Second-person direct questions
      /\b(do i|can i|should i|am i)\b/i,
      // Someone-specific references
      /\b(my mother|my father|my wife|my husband|my child|my friend|he has|she has)\b/i,
      // Symptom framing
      /\b(i have|i got|i feel|experiencing|suffering from)\b/i
    ];
    return personalSignals.some(pattern => pattern.test(text));
  }

  /**
   * Check if text is a general informational question
   */
  static isGeneralQuestion(text: string): boolean {
    const explainPatterns = [
      /\b(what are|what is|what do|how do|tell me about|explain|describe|list)\b/i,
      /\b(common|typical|general|usually|often|typically)\b/i,
      // "How to identify" patterns - general informational questions about symptoms/signs
      /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i
    ];
    return explainPatterns.some(pattern => pattern.test(text));
  }
}



