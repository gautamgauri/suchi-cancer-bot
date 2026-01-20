import { Injectable } from "@nestjs/common";
import { AbstentionReason } from "../evidence/evidence-gate.service";
import { QueryType } from "../../config/trusted-sources.config";

@Injectable()
export class AbstentionService {
  /**
   * Generate appropriate abstention message when evidence is insufficient
   * Follows Safe-but-Helpful structure from PRD
   */
  generateAbstentionMessage(
    reason: AbstentionReason,
    queryType: QueryType,
    userMessage?: string
  ): string {
    const hasUrgency = userMessage ? this.hasUrgencyIndicators(userMessage) : false;

    // Build the message following Safe-but-Helpful structure
    let message = "";

    // 1. Safety boundary (one sentence)
    message += this.getSafetyBoundary(reason, queryType);

    // 2. What Suchi can do (max 3 bullets)
    message += "\n\nWhat I can do right now:\n";
    message += this.getActionableHelp(queryType);

    // 3. Urgent red flags (only when appropriate)
    if (hasUrgency) {
      message += "\n\nIf this is urgent: seek medical care immediately if you have severe chest pain, trouble breathing, heavy bleeding, confusion, fainting, or rapidly worsening symptoms.";
    }

    // 4. Invite context
    message += "\n\n" + this.getContextInvitation(reason, queryType);

    return message;
  }

  /**
   * Check if user message contains urgency indicators
   * Public method for use in chat service priority routing
   */
  hasUrgencyIndicators(userText: string): boolean {
    const urgencyPatterns = [
      /\b(severe|severe\s+chest\s+pain|severe\s+breathlessness)\b/i,
      /\b(trouble\s+breathing|can't\s+breathe|difficulty\s+breathing|breathless)\b/i,
      /\b(heavy\s+bleeding|bleeding\s+heavily|excessive\s+bleeding)\b/i,
      /\b(confusion|confused|altered\s+sensorium|disoriented)\b/i,
      /\b(fainting|fainted|passed\s+out|unconscious)\b/i,
      /\b(rapidly\s+worsening|getting\s+worse\s+quickly|suddenly\s+worse)\b/i,
      /\b(emergency|urgent|immediate|right\s+now)\b/i,
      /\b(chest\s+pain|heart\s+attack|stroke)\b/i
    ];

    return urgencyPatterns.some(pattern => pattern.test(userText));
  }

  /**
   * Get safety boundary statement (one sentence)
   */
  private getSafetyBoundary(reason: AbstentionReason, queryType: QueryType): string {
    switch (reason) {
      case "no_evidence":
        return "I want to be careful here: I can't confidently verify enough information to answer this accurately.";

      case "insufficient_passages":
      case "insufficient_sources":
        return "I want to be careful here: I found some information, but not enough to provide a comprehensive and reliable answer.";

      case "untrusted_sources":
        return "I want to be careful here: the information I found isn't from sources I'm authorized to use.";

      case "outdated_content":
        return "I want to be careful here: the information I have may be outdated, and medical guidelines change over time.";

      case "conflicting_evidence":
        return "I want to be careful here: I found information from multiple sources that present different perspectives.";

      case "citation_validation_failed":
        return "I want to be careful here: I generated a response, but I couldn't properly verify all the sources.";

      default:
        return "I want to be careful here: I can't confidently verify enough information to answer this accurately.";
    }
  }

  /**
   * Get actionable help bullets (max 3)
   */
  private getActionableHelp(queryType: QueryType): string {
    const helpItems = [
      "• Help you prepare questions for your oncologist based on your situation",
      "• Explain any medical terms in plain language",
      "• Help you organize symptoms, reports, and timelines for a clearer consultation"
    ];

    // Add query-type specific help if relevant
    if (queryType === "treatment" || queryType === "sideEffects") {
      return helpItems.join("\n");
    } else if (queryType === "navigation") {
      return "• Help you find appropriate healthcare resources and support services\n" + helpItems.slice(1).join("\n");
    } else {
      return helpItems.join("\n");
    }
  }

  /**
   * Get context invitation (ask for minimum additional details)
   */
  private getContextInvitation(reason: AbstentionReason, queryType: QueryType): string {
    const baseInvitation = "If you share what the question was about (and any relevant details like diagnosis, treatment, and reports), I'll help you frame the next best steps and questions.";

    switch (reason) {
      case "no_evidence":
        return "If you can rephrase your question or share more context about what you're looking for, I may be able to help better.";

      case "untrusted_sources":
        return "If you share what you're looking for, I can help you prepare questions to discuss with your healthcare provider.";

      default:
        return baseInvitation;
    }
  }

  /**
   * Generate clarifying question for weak evidence (Rule B2)
   * Ask ONE question before abstaining
   */
  generateClarifyingQuestion(userText: string, queryType: QueryType): string {
    const lowerText = userText.toLowerCase();
    
    // Detect what type of question this is
    if (lowerText.includes("symptom")) {
      return "To provide more accurate information, could you specify which symptoms you're asking about, or are you asking about symptoms in general?";
    }
    if (lowerText.includes("treatment") || lowerText.includes("therapy")) {
      return "To help you better, could you share the cancer type or stage (if known), or are you asking about treatments in general?";
    }
    if (lowerText.includes("report") || lowerText.includes("scan") || lowerText.includes("test")) {
      return "To provide more relevant guidance, could you share the type of report or test you're asking about?";
    }
    if (lowerText.includes("lymphoma") || lowerText.includes("cancer type")) {
      return "To provide more specific information, could you clarify what aspect of this you'd like to know about (symptoms, treatment, diagnosis, etc.)?";
    }
    
    // Generic clarifying question
    return "To provide a more accurate answer, could you provide a bit more context about what specifically you'd like to know?";
  }

  private getQueryTypeDescription(queryType: QueryType): string {
    const descriptions: Record<QueryType, string> = {
      treatment: "treatment",
      sideEffects: "side effects",
      symptoms: "symptoms",
      prevention: "prevention",
      screening: "screening",
      caregiver: "caregiver support",
      navigation: "navigation",
      general: "general cancer information"
    };
    return descriptions[queryType] || "cancer-related";
  }

  /**
   * Generate SafeFallbackResponse with NO medical content
   * Purely navigational + clinician referral
   * Used when evidence gate blocks LLM call or citation enforcement fails
   */
  generateSafeFallbackResponse(
    reasonCode: string,
    queryType: string
  ): string {
    const baseMessage = 
      "I don't have enough specific information in my knowledge base to answer this accurately.\n\n" +
      "For personalized medical guidance, please consult with your healthcare provider or oncology team.";
    
    const resources = 
      "\n\nYou may also find general information at:\n" +
      "- National Cancer Institute: https://www.cancer.gov\n" +
      "- WHO Cancer Resources: https://www.who.int/health-topics/cancer";
    
    // Optional: Add reason-specific guidance
    let additionalGuidance = "";
    if (reasonCode === 'NO_RESULTS') {
      additionalGuidance = "\n\nThis topic may require more specialized medical knowledge than I currently have access to.";
    } else if (reasonCode === 'LOW_TRUST') {
      additionalGuidance = "\n\nI can only provide information from verified medical sources, and I don't have sufficient trusted sources for this query.";
    } else if (reasonCode === 'INSUFFICIENT_CITATIONS') {
      additionalGuidance = "\n\nI couldn't verify the information with reliable source citations.";
    } else if (reasonCode === 'LOW_SCORE') {
      additionalGuidance = "\n\nThe information I found doesn't meet my confidence threshold for medical guidance.";
    }
    
    return baseMessage + additionalGuidance + resources;
  }
}







