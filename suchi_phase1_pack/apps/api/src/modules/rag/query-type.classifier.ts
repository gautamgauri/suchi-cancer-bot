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

    // Side effects
    if (/\b(side effect|adverse|complication|symptom|pain|nausea|fatigue|hair loss)\b/i.test(lowerQuery)) {
      return "sideEffects";
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





















