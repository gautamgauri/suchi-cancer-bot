import { Injectable } from "@nestjs/common";
import { EvidenceChunk, EvidenceGateResult } from "../evidence/evidence-gate.service";
import { GreetingDetector } from "./greeting-detector";
import { AbstentionService } from "../abstention/abstention.service";
import { ModeDetector } from "./mode-detector";
import { hasGeneralIntentSignal } from "./utils/general-intent";

/**
 * Intent types - updated for RAG-first architecture
 */
export type IntentType =
  | "GREETING_ONLY"
  | "UNCLEAR_REQUEST"
  | "REPORT_REQUEST_NO_TEXT"
  | "REPORT_TEXT_PROVIDED"
  | "INFORMATIONAL_GENERAL" // General cancer information questions (Explain Mode)
  | "INFORMATIONAL_SYMPTOMS" // General symptom information, not personal (Explain Mode)
  | "PERSONAL_SYMPTOMS" // User describing their own symptoms (Navigate Mode)
  | "SYMPTOMS_URGENT_RED_FLAGS"
  | "SIDE_EFFECTS_GENERAL"
  | "SIDE_EFFECTS_POSSIBLY_URGENT"
  | "CARE_NAVIGATION_PROVIDER_CHOICE"
  | "CARE_NAVIGATION_SECOND_OPINION"
  | "PREVENTION_SCREENING_INFO"
  | "TREATMENT_OPTIONS_GENERAL"
  | "REQUEST_OUT_OF_SCOPE"
  | "INSUFFICIENT_EVIDENCE"
  | "MISSING_CONTEXT"
  | "CONFLICTING_INFO"
  | "TECHNICAL_FAILURE"
  | "SAFETY_RESTRICTED"
  | "ABSTENTION_WITH_RED_FLAGS";

export interface IntentClassificationResult {
  intent: IntentType;
  confidence: "high" | "medium" | "low";
  metadata?: Record<string, any>;
}

export interface SessionContext {
  userContext?: "general" | "patient" | "caregiver" | "post_diagnosis";
  emotionalState?: "anxious" | "calm" | "urgent" | "sad" | "neutral";
  cancerType?: string;
}

@Injectable()
export class IntentClassifier {
  constructor(private readonly abstention: AbstentionService) {}

  /**
   * Classify user intent based on message content, evidence, and gate results
   * Updated for RAG-first architecture with mode detection
   * @param sessionContext Optional session context (userContext, emotionalState, cancerType) to influence classification
   */
  classify(
    userText: string,
    evidenceChunks: EvidenceChunk[],
    gateResult: EvidenceGateResult,
    safetyClassification: string,
    conversationContext?: { hasGenerallyAsking?: boolean },
    sessionContext?: SessionContext
  ): IntentClassificationResult {
    const lowerText = userText.toLowerCase().trim();

    // Use session context to influence classification if available
    const userContext = sessionContext?.userContext;
    const emotionalState = sessionContext?.emotionalState;

    // Fast-path: if general intent detected, immediately return INFORMATIONAL_GENERAL
    if (conversationContext?.hasGenerallyAsking) {
      return {
        intent: "INFORMATIONAL_GENERAL",
        confidence: "high",
        metadata: { reason: "User signaled general/educational intent" }
      };
    }

    // If session has userContext, use it to influence intent classification
    if (userContext === "general") {
      // General information seeker - prioritize INFORMATIONAL_GENERAL
      if (this.hasCancerRelatedKeywords(lowerText)) {
        return {
          intent: "INFORMATIONAL_GENERAL",
          confidence: "high",
          metadata: { reason: "Session context: general information seeker" }
        };
      }
    } else if (userContext === "patient") {
      // Patient with symptoms - prioritize PERSONAL_SYMPTOMS
      if (this.hasSymptomKeywords(lowerText) && !this.abstention.hasUrgencyIndicators(userText)) {
        return {
          intent: "PERSONAL_SYMPTOMS",
          confidence: "high",
          metadata: { reason: "Session context: patient with symptoms" }
        };
      }
    } else if (userContext === "caregiver") {
      // Caregiver - prioritize CARE_NAVIGATION intents
      if (this.isProviderChoiceRequest(lowerText)) {
        return {
          intent: "CARE_NAVIGATION_PROVIDER_CHOICE",
          confidence: "high",
          metadata: { reason: "Session context: caregiver" }
        };
      }
      if (this.isSecondOpinionRequest(lowerText)) {
        return {
          intent: "CARE_NAVIGATION_SECOND_OPINION",
          confidence: "high",
          metadata: { reason: "Session context: caregiver" }
        };
      }
    } else if (userContext === "post_diagnosis") {
      // Post-diagnosis - prioritize TREATMENT_OPTIONS_GENERAL, SIDE_EFFECTS_*
      if (this.isTreatmentOptionsRequest(lowerText)) {
        return {
          intent: "TREATMENT_OPTIONS_GENERAL",
          confidence: "high",
          metadata: { reason: "Session context: post-diagnosis" }
        };
      }
      if (this.hasSideEffectKeywords(lowerText)) {
        return {
          intent: "SIDE_EFFECTS_GENERAL",
          confidence: "high",
          metadata: { reason: "Session context: post-diagnosis" }
        };
      }
    }

    // Priority 1: Crisis / urgent symptoms (S2) - checked before greeting
    if (this.abstention.hasUrgencyIndicators(userText)) {
      // Check if it's side effects with urgency
      if (this.hasSideEffectKeywords(lowerText)) {
        return {
          intent: "SIDE_EFFECTS_POSSIBLY_URGENT",
          confidence: "high"
        };
      }
      // Otherwise treat as urgent symptoms
      return {
        intent: "SYMPTOMS_URGENT_RED_FLAGS",
        confidence: "high"
      };
    }

    // Priority 2: Safety-restricted request (A4)
    if (safetyClassification !== "normal") {
      return {
        intent: "SAFETY_RESTRICTED",
        confidence: "high"
      };
    }

    // Priority 3: Greeting-only (G-series)
    if (GreetingDetector.isGreeting(userText)) {
      return {
        intent: "GREETING_ONLY",
        confidence: "high"
      };
    }

    // Optional: history-based detection if context not provided
    // (This is backup if conversationContext not passed)
    if (hasGeneralIntentSignal(userText)) {
      return {
        intent: "INFORMATIONAL_GENERAL",
        confidence: "high",
        metadata: { reason: "General intent detected in current message" }
      };
    }

    // Priority 4: Mode detection (NEW - check mode before intent classification)
    const mode = ModeDetector.detectMode(userText);

    // Priority 5: Clear primary intents

    // Report requests
    if (this.isReportRequest(lowerText)) {
      if (this.hasReportText(userText)) {
        return {
          intent: "REPORT_TEXT_PROVIDED",
          confidence: "high",
          metadata: { hasReportText: true }
        };
      } else {
        return {
          intent: "REPORT_REQUEST_NO_TEXT",
          confidence: "high"
        };
      }
    }

    // Symptoms - now mode-aware
    if (this.hasSymptomKeywords(lowerText) && !this.abstention.hasUrgencyIndicators(userText)) {
      if (mode === "navigate") {
        // Personal symptoms - Navigate Mode
        return {
          intent: "PERSONAL_SYMPTOMS",
          confidence: "high"
        };
      } else {
        // General symptom information - Explain Mode
        return {
          intent: "INFORMATIONAL_SYMPTOMS",
          confidence: "high"
        };
      }
    }

    // Side effects (general)
    if (this.hasSideEffectKeywords(lowerText)) {
      return {
        intent: "SIDE_EFFECTS_GENERAL",
        confidence: "high"
      };
    }

    // Navigation - provider choice
    if (this.isProviderChoiceRequest(lowerText)) {
      return {
        intent: "CARE_NAVIGATION_PROVIDER_CHOICE",
        confidence: "high"
      };
    }

    // Navigation - second opinion
    if (this.isSecondOpinionRequest(lowerText)) {
      return {
        intent: "CARE_NAVIGATION_SECOND_OPINION",
        confidence: "high"
      };
    }

    // Prevention/Screening - route to Explain Mode if general, Navigate if personal
    if (this.isPreventionScreeningRequest(lowerText)) {
      if (mode === "navigate") {
        return {
          intent: "PREVENTION_SCREENING_INFO", // Keep for Navigate Mode
          confidence: "high"
        };
      } else {
        return {
          intent: "INFORMATIONAL_GENERAL", // Route to RAG for general questions
          confidence: "high"
        };
      }
    }

    // Treatment options - route to Explain Mode if general
    if (this.isTreatmentOptionsRequest(lowerText)) {
      if (mode === "navigate") {
        return {
          intent: "TREATMENT_OPTIONS_GENERAL", // Keep for Navigate Mode
          confidence: "medium"
        };
      } else {
        return {
          intent: "INFORMATIONAL_GENERAL", // Route to RAG for general questions
          confidence: "high"
        };
      }
    }

    // General informational questions (Explain Mode) - catch-all for cancer-related questions
    if (mode === "explain" && this.hasCancerRelatedKeywords(lowerText)) {
      return {
        intent: "INFORMATIONAL_GENERAL",
        confidence: "medium"
      };
    }

    // Priority 5: Unclear ask (C-series)
    if (this.isUnclearRequest(lowerText)) {
      return {
        intent: "UNCLEAR_REQUEST",
        confidence: "medium"
      };
    }

    // Priority 6: Abstention cases

    // Abstention with red flags
    if (gateResult.shouldAbstain && this.abstention.hasUrgencyIndicators(userText)) {
      return {
        intent: "ABSTENTION_WITH_RED_FLAGS",
        confidence: "high"
      };
    }

    // Conflicting info
    if (gateResult.quality === "conflicting") {
      return {
        intent: "CONFLICTING_INFO",
        confidence: "high"
      };
    }

    // Missing context (user asked specific medical question but lacks details)
    // Only abstain if we truly have no evidence AND it's not a general question
    if (gateResult.shouldAbstain && this.hasMedicalQuestionKeywords(lowerText) && evidenceChunks.length === 0) {
      // If it's a general question in Explain Mode, don't abstain - ask clarifying question instead
      if (mode === "explain") {
        return {
          intent: "INFORMATIONAL_GENERAL", // Route to RAG with clarifying question
          confidence: "low"
        };
      }
      return {
        intent: "MISSING_CONTEXT",
        confidence: "medium"
      };
    }

    // Technical failure - only if truly no evidence and not a general question
    if (gateResult.shouldAbstain && evidenceChunks.length === 0 && !this.isUnclearRequest(lowerText)) {
      // If it's a general question, try to answer with what we have
      if (mode === "explain" && this.hasCancerRelatedKeywords(lowerText)) {
        return {
          intent: "INFORMATIONAL_GENERAL",
          confidence: "low"
        };
      }
      return {
        intent: "TECHNICAL_FAILURE",
        confidence: "medium"
      };
    }

    // Explicit check for "how to identify" questions - gate by personal signals
    // Identify general pattern: how to identify, signs of, indicators of, how to detect, etc.
    const identifyGeneralPattern = /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i;
    // Cancer keyword pattern
    const cancerKeywordPattern = /\b(cancer|lymphoma|tumou?r|symptom|sign|warning|breast|lung|colon|leukemia|melanoma)\b/i;
    
    // Check if this is an identify question with cancer keywords
    if (identifyGeneralPattern.test(lowerText) && cancerKeywordPattern.test(lowerText)) {
      // Gate by personal signals
      if (ModeDetector.hasPersonalDiagnosisSignal(userText)) {
        // Personal identify question → route to PERSONAL_SYMPTOMS or navigation intent
        return {
          intent: "PERSONAL_SYMPTOMS",
          confidence: "medium"
        };
      }
      // General identify question → route to INFORMATIONAL_GENERAL even with weak evidence
      return {
        intent: "INFORMATIONAL_GENERAL",
        confidence: "medium"
      };
    }

    // Insufficient evidence (default abstention)
    // For Explain Mode with cancer-related keywords, route to INFORMATIONAL_GENERAL instead
    if (gateResult.shouldAbstain) {
      if (mode === "explain" && this.hasCancerRelatedKeywords(lowerText)) {
        return {
          intent: "INFORMATIONAL_GENERAL", // Route to RAG even with weak evidence
          confidence: "low"
        };
      }
      return {
        intent: "INSUFFICIENT_EVIDENCE",
        confidence: "high"
      };
    }

    // Out of scope (fallback for non-cancer requests)
    if (!this.hasCancerRelatedKeywords(lowerText) && !this.isUnclearRequest(lowerText)) {
      return {
        intent: "REQUEST_OUT_OF_SCOPE",
        confidence: "low"
      };
    }

    // Default: unclear request if we can't classify
    return {
      intent: "UNCLEAR_REQUEST",
      confidence: "low"
    };
  }

  // Helper methods for pattern detection

  private isReportRequest(text: string): boolean {
    const reportPatterns = [
      /\b(explain|interpret|what does|mean|understand)\s+(my\s+)?(report|scan|biopsy|test|result|pathology|imaging|ct|mri|pet|ultrasound|x-ray)\b/i,
      /\b(report|scan|biopsy|test|result)\s+(says|shows|indicates|means)\b/i,
      /\b(help|can you)\s+(with|explain|interpret)\s+(my\s+)?(report|scan|biopsy|test)\b/i
    ];
    return reportPatterns.some(pattern => pattern.test(text));
  }

  private hasReportText(text: string): boolean {
    // Check for common report sections/patterns
    const reportIndicators = [
      /\b(impression|conclusion|findings|diagnosis|recommendation)\s*:/i,
      /\b(size|mm|cm|mass|lesion|nodule|lymph node)\b/i,
      /\b(grade|stage|tumor|malignancy)\b/i,
      /\b(biopsy|pathology|histology)\b/i,
      /\b(ct|mri|pet|scan|imaging)\s+(shows|reveals|demonstrates)\b/i
    ];
    return reportIndicators.some(pattern => pattern.test(text)) && text.length > 100;
  }

  private hasSymptomKeywords(text: string): boolean {
    const symptomPatterns = [
      /\b(symptom|symptoms|sign|signs|feeling|experiencing|having)\b/i,
      /\b(pain|ache|discomfort|sore|tender)\b/i,
      /\b(cough|coughing|breath|breathing|shortness)\b/i,
      /\b(nausea|vomit|dizzy|dizziness)\b/i,
      /\b(fatigue|tired|weakness|weak)\b/i,
      /\b(lump|swelling|mass|bump)\b/i,
      /\b(bleeding|blood|discharge)\b/i,
      /\b(fever|temperature|chills)\b/i
    ];
    return symptomPatterns.some(pattern => pattern.test(text));
  }

  private hasSideEffectKeywords(text: string): boolean {
    const sideEffectPatterns = [
      /\b(side effect|side effects|adverse|reaction|complication)\b/i,
      /\b(chemo|chemotherapy|radiation|radiotherapy|treatment)\s+(side|effect|symptom)\b/i,
      /\b(medication|medicine|drug)\s+(side|effect|reaction)\b/i,
      /\b(after|during|from)\s+(chemo|chemotherapy|radiation|treatment)\b/i
    ];
    return sideEffectPatterns.some(pattern => pattern.test(text));
  }

  private isProviderChoiceRequest(text: string): boolean {
    const patterns = [
      /\b(where|which|find|recommend|suggest)\s+(doctor|physician|oncologist|hospital|clinic|center|facility)\b/i,
      /\b(best|good|qualified)\s+(doctor|physician|oncologist|hospital|clinic)\b/i,
      /\b(need|looking for|searching for)\s+(doctor|hospital|clinic|treatment center)\b/i
    ];
    return patterns.some(pattern => pattern.test(text));
  }

  private isSecondOpinionRequest(text: string): boolean {
    const patterns = [
      /\b(second opinion|second\s+opinion|another opinion|different doctor)\b/i,
      /\b(should i get|do i need|considering)\s+(second|another)\s+opinion\b/i
    ];
    return patterns.some(pattern => pattern.test(text));
  }

  private isPreventionScreeningRequest(text: string): boolean {
    const patterns = [
      /\b(prevent|prevention|preventive|reduce risk)\b/i,
      /\b(screening|screen|early detection|mammogram|pap test|colonoscopy)\b/i,
      /\b(risk factor|risk factors|lifestyle|diet|exercise)\b/i
    ];
    return patterns.some(pattern => pattern.test(text));
  }

  private isTreatmentOptionsRequest(text: string): boolean {
    const patterns = [
      /\b(treatment option|treatment options|what treatments|available treatments)\b/i,
      /\b(what are|what's|options for|treatments for)\s+(cancer|treatment)\b/i,
      /\b(how to treat|how is.*treated|treatment approach)\b/i
    ];
    return patterns.some(pattern => pattern.test(text));
  }

  private isUnclearRequest(text: string): boolean {
    const unclearPatterns = [
      /^(help|can you help|guide me|assist|support)\s*[!?.]*$/i,
      /^(question|i have a question|i need help)\s*[!?.]*$/i,
      /^(what|how|why)\s+(can|do|should)\s+(you|i)\s+(help|do|know)\s*[!?.]*$/i
    ];
    return unclearPatterns.some(pattern => pattern.test(text)) || 
           (text.length < 20 && !this.hasMedicalQuestionKeywords(text));
  }

  private hasMedicalQuestionKeywords(text: string): boolean {
    const medicalKeywords = [
      /\b(cancer|tumor|tumour|malignancy|oncology)\b/i,
      /\b(treatment|therapy|chemo|radiation|surgery)\b/i,
      /\b(diagnosis|diagnose|stage|grade)\b/i,
      /\b(symptom|symptoms|sign|signs)\b/i,
      /\b(report|scan|test|biopsy|result)\b/i
    ];
    return medicalKeywords.some(pattern => pattern.test(text));
  }

  private hasCancerRelatedKeywords(text: string): boolean {
    const cancerKeywords = [
      /\b(cancer|carcinoma|tumor|tumour|malignancy|oncology|oncologist)\b/i,
      /\b(chemo|chemotherapy|radiation|radiotherapy)\b/i,
      /\b(biopsy|pathology|oncology|tumor)\b/i
    ];
    return cancerKeywords.some(pattern => pattern.test(text));
  }
}

