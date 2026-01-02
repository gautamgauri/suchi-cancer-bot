import { Injectable } from "@nestjs/common";
import { EvidenceChunk, EvidenceGateResult } from "../evidence/evidence-gate.service";
import { GreetingDetector } from "./greeting-detector";
import { AbstentionService } from "../abstention/abstention.service";

/**
 * Intent types from the Intent → Template Mapping Table
 */
export type IntentType =
  | "GREETING_ONLY"
  | "UNCLEAR_REQUEST"
  | "REPORT_REQUEST_NO_TEXT"
  | "REPORT_TEXT_PROVIDED"
  | "SYMPTOMS_NON_URGENT"
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

@Injectable()
export class IntentClassifier {
  constructor(private readonly abstention: AbstentionService) {}

  /**
   * Classify user intent based on message content, evidence, and gate results
   * Follows priority order from mapping table
   */
  classify(
    userText: string,
    evidenceChunks: EvidenceChunk[],
    gateResult: EvidenceGateResult,
    safetyClassification: string
  ): IntentClassificationResult {
    const lowerText = userText.toLowerCase().trim();

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

    // Priority 4: Clear primary intents

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

    // Symptoms (non-urgent)
    if (this.hasSymptomKeywords(lowerText) && !this.abstention.hasUrgencyIndicators(userText)) {
      return {
        intent: "SYMPTOMS_NON_URGENT",
        confidence: "high"
      };
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

    // Prevention/Screening
    if (this.isPreventionScreeningRequest(lowerText)) {
      return {
        intent: "PREVENTION_SCREENING_INFO",
        confidence: "high"
      };
    }

    // Treatment options (general)
    if (this.isTreatmentOptionsRequest(lowerText)) {
      return {
        intent: "TREATMENT_OPTIONS_GENERAL",
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
    if (gateResult.shouldAbstain && this.hasMedicalQuestionKeywords(lowerText) && evidenceChunks.length === 0) {
      return {
        intent: "MISSING_CONTEXT",
        confidence: "medium"
      };
    }

    // Technical failure
    if (gateResult.shouldAbstain && evidenceChunks.length === 0 && !this.isUnclearRequest(lowerText)) {
      return {
        intent: "TECHNICAL_FAILURE",
        confidence: "medium"
      };
    }

    // Insufficient evidence (default abstention)
    if (gateResult.shouldAbstain) {
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

