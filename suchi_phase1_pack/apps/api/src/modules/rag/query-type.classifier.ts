import { QueryType } from "../../config/trusted-sources.config";

/**
 * Simple query type classifier
 * Classifies user queries to determine evidence thresholds
 */
export class QueryTypeClassifier {
  static classify(query: string): QueryType {
    const lowerQuery = query.toLowerCase();

    // Treatment-related queries
    if (/\b(treatment|treat|therapy|chemotherapy|radiation|surgery|medication|drug)\b/i.test(lowerQuery)) {
      return "treatment";
    }

    // Canonical precedence for side effects vs symptoms:
    // 1) Side effects if treatment context is present (highest priority)
    // 2) Explicit side effects language
    // 3) Symptoms language (lowest priority)
    const hasTreatmentContext = /\b(chemotherapy|chemo|radiation|radiotherapy|immunotherapy|after treatment|during treatment|treatment side|of treatment|of chemo|of radiation)\b/i.test(lowerQuery);
    const hasSideEffectLanguage = /\b(side effect|adverse effect|adverse reaction|complication)\b/i.test(lowerQuery);
    const hasSymptomLanguage = /\b(symptom|signs|warning sign|early sign|common sign|identify|recognize|detect)\b/i.test(lowerQuery);
    
    // 1) Side effects with treatment context (highest priority)
    if (hasTreatmentContext && (hasSideEffectLanguage || hasSymptomLanguage)) {
      return "sideEffects";
    }
    
    // 2) Explicit side effects language
    if (hasSideEffectLanguage) {
      return "sideEffects";
    }
    
    // 3) Symptoms language (only if no treatment context or explicit side effects)
    if (hasSymptomLanguage) {
      return "symptoms";
    }

    // Screening
    if (/\b(screening|screen|mammogram|pap test|colonoscopy|early detection)\b/i.test(lowerQuery)) {
      return "screening";
    }

    // Prevention
    if (/\b(prevent|prevention|risk factor|lifestyle|diet|exercise|smoking|alcohol)\b/i.test(lowerQuery)) {
      return "prevention";
    }

    // Caregiver
    if (/\b(caregiver|caregiver|family|support|how to help|assist)\b/i.test(lowerQuery)) {
      return "caregiver";
    }

    // Navigation
    if (/\b(help|helpline|hospital|doctor|where|find|resource|support group)\b/i.test(lowerQuery)) {
      return "navigation";
    }

    // Default to general
    return "general";
  }
}





















