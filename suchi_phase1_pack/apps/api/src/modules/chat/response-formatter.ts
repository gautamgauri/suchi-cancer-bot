/**
 * Response Formatter - UX rules for response structure
 * Implements rules E1, E2, E3 from spec
 */

export class ResponseFormatter {
  /**
   * Rule E1: One closure only (question OR "what I can do next", not both)
   * Rule E2: No "Is there anything else..." on every turn
   * Rule E3: Conditional "Next steps" section
   */
  static formatResponse(
    responseText: string,
    mode: "explain" | "navigate",
    hasResolvedAnswer: boolean = false,
    isMultiStepInteraction: boolean = false
  ): string {
    let formatted = responseText;

    // Rule E2: Remove "Is there anything else..." unless conditions are met
    const hasAnythingElse = /\b(Is there anything else|anything else you'd like|anything else)\b/i.test(formatted);
    if (hasAnythingElse && !hasResolvedAnswer && !isMultiStepInteraction) {
      // Remove the "Is there anything else..." part
      formatted = formatted.replace(/\n\nIs there anything else[^.]*[.!?]/i, "");
      formatted = formatted.replace(/\n\nAnything else[^.]*[.!?]/i, "");
    }

    // Rule E1: Check for duplicate closures
    const hasQuestion = /[?]\s*$/.test(formatted.trim());
    const hasNextSteps = /\*\*Next steps?\*\*/.test(formatted);
    const hasWhatICanDo = /\b(What I can (do|help)|What would you like)\b/i.test(formatted);

    // If we have both a question and "what I can do", remove one
    if (hasQuestion && hasWhatICanDo) {
      // Keep the question, remove "what I can do"
      formatted = formatted.replace(/\n\n\*\*What I can (do|help)[^*]*\*\*/i, "");
    }

    // Rule E3: Conditional "Next steps" section
    // Only add if:
    // - Template doesn't already have one
    // - Navigate Mode OR after multi-turn clarification
    const alreadyHasNextSteps = /\*\*Next steps?\*\*/.test(formatted);
    if (!alreadyHasNextSteps && (mode === "navigate" || isMultiStepInteraction)) {
      // Don't add here - let templates handle it
      // This is just validation
    }

    return formatted.trim();
  }

  /**
   * Check if response needs closure removal
   */
  static needsClosureCleanup(responseText: string): boolean {
    const hasAnythingElse = /\b(Is there anything else|anything else you'd like)\b/i.test(responseText);
    const hasQuestion = /[?]\s*$/.test(responseText.trim());
    const hasWhatICanDo = /\b(What I can (do|help))\b/i.test(responseText);
    
    // Needs cleanup if we have both question and "what I can do"
    return hasQuestion && hasWhatICanDo;
  }

  /**
   * Remove repetitive closers (Rule E2)
   */
  static removeRepetitiveClosers(responseText: string, hasResolvedAnswer: boolean, isMultiStepInteraction: boolean): string {
    if (hasResolvedAnswer || isMultiStepInteraction) {
      return responseText; // Keep closers for resolved answers or multi-step
    }

    // Remove "Is there anything else..." if conditions not met
    let cleaned = responseText.replace(/\n\nIs there anything else[^.]*[.!?]/i, "");
    cleaned = cleaned.replace(/\n\nAnything else[^.]*[.!?]/i, "");
    
    return cleaned.trim();
  }
}









