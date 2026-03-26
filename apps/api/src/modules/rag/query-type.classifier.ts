import { QueryType } from "../../config/trusted-sources.config";

/**
 * Simple query type classifier
 * Classifies user queries to determine evidence thresholds
 *
 * NOTE: Classification patterns here are NOT part of the repairable surface.
 * They are tightly coupled to the evidence gate and safety modules.
 * The repairable surface covers routing *thresholds* (repairable/config/routing.json),
 * not the classification logic itself.
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
    // 4) Raw symptom descriptions (patient describing their own symptoms)
    const hasTreatmentContext = /\b(chemotherapy|chemo|radiation|radiotherapy|immunotherapy|after treatment|during treatment|treatment side|of treatment|of chemo|of radiation)\b/i.test(lowerQuery);
    const hasSideEffectLanguage = /\b(side effect|adverse effect|adverse reaction|complication)\b/i.test(lowerQuery);
    const hasSymptomLanguage = /\b(symptom|signs|warning sign|early sign|common sign|identify|recognize|detect)\b/i.test(lowerQuery);

    // Detect raw symptom descriptions: patient describing their own symptoms
    // e.g., "I've had a persistent cough for 8 weeks", "I have blood in my stool"
    const hasRawSymptomDescription = (
      // Duration patterns: "for X weeks/months/days", "persistent", "ongoing", "chronic"
      /\b(persistent|ongoing|chronic|constant|recurring|for \d+ (week|month|day|year)s?)\b/i.test(lowerQuery) &&
      // Combined with body symptom terms (not treatment terms)
      /\b(cough|pain|lump|bleeding|blood|swelling|fatigue|tired|weight loss|numbness|headache|fever|night sweats|discharge|sore|ache|nausea|vomiting|bloating|difficulty swallowing|shortness of breath|wheezing)\b/i.test(lowerQuery) &&
      // Exclude treatment context
      !hasTreatmentContext
    ) || (
      // First-person symptom reports: "I have/had/noticed/found..."
      /\b(i('ve| have| had| am having| noticed| found| feel| been having| keep having| experience))\b/i.test(lowerQuery) &&
      /\b(cough|pain|lump|bump|bleeding|blood|swelling|fatigue|tired|weight loss|numbness|headache|fever|night sweats|discharge|sore|ache|nausea|vomiting|bloating|difficulty swallowing|shortness of breath|wheezing|mole)\b/i.test(lowerQuery) &&
      !hasTreatmentContext
    ) || (
      // "What should I do" + symptom context (seeking evaluation advice)
      /\b(what should i do|should i (see|visit|go|worry|be concerned)|is this (serious|normal|cancer|dangerous))\b/i.test(lowerQuery) &&
      /\b(cough|pain|lump|bump|bleeding|blood|swelling|fatigue|tired|weight loss|numbness|headache|fever|night sweats|discharge|sore|ache|nausea|vomiting|bloating)\b/i.test(lowerQuery) &&
      !hasTreatmentContext
    );

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

    // 4) Raw symptom descriptions (patient reporting their own symptoms)
    if (hasRawSymptomDescription) {
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

    // Navigation - expanded to catch India-specific navigation queries
    if (/\b(help|helpline|hospital|doctor|where|find|resource|support group|scheme|pmjay|ayushman|government|financial|cost|expense|afford|insurance|ngo|assistance|centre|center|clinic)\b/i.test(lowerQuery)) {
      return "navigation";
    }

    // Navigation - location-specific queries (city/state names + care context)
    if (/\b(patna|bihar|delhi|mumbai|kolkata|chennai|bangalore|hyderabad|lucknow|varanasi|jaipur)\b/i.test(lowerQuery) &&
        /\b(cancer|treatment|hospital|doctor|care|oncolog)/i.test(lowerQuery)) {
      return "navigation";
    }

    // Default to general
    return "general";
  }
}





















