/**
 * Greeting detector utility
 * Detects simple greetings and distinguishes them from medical queries
 */
export class GreetingDetector {
  // Greeting patterns (case-insensitive)
  private static readonly GREETING_PATTERNS = [
    /^(hi|hello|hey|namaste|namaskar|greetings|good morning|good afternoon|good evening)$/i,
    /^(hi|hello|hey)\s*[!.]*$/i,
    /^👋\s*$/,
    /^🙏\s*$/
  ];

  // Medical keywords that indicate this is NOT a simple greeting
  private static readonly MEDICAL_KEYWORDS = [
    // Symptoms and conditions
    /\b(pain|ache|hurt|sore|discomfort)\b/i,
    /\b(bleeding|blood|hemorrhage)\b/i,
    /\b(fever|temperature|chills)\b/i,
    /\b(cough|coughing|breath|breathing|breathless)\b/i,
    /\b(nausea|vomit|dizzy|dizziness|faint|fainting)\b/i,
    /\b(confusion|confused|altered|sensorium)\b/i,
    /\b(symptom|symptoms|sign|signs)\b/i,
    
    // Medical procedures and tests
    /\b(biopsy|biopsies)\b/i,
    /\b(pet|ct|mri|scan|scans|imaging)\b/i,
    /\b(test|tests|testing|lab|labs|laboratory)\b/i,
    /\b(report|reports|result|results)\b/i,
    
    // Cancer-related terms
    /\b(cancer|carcinoma|tumor|tumour|malignancy|malignant)\b/i,
    /\b(chemo|chemotherapy|radiation|radiotherapy)\b/i,
    /\b(stage|staging|grade|grading)\b/i,
    /\b(metastasis|metastatic|spread)\b/i,
    
    // Treatment and medication
    /\b(treatment|treat|therapy|therapies)\b/i,
    /\b(medication|medicine|drug|drugs|prescription|dose|dosage)\b/i,
    /\b(diagnosis|diagnose|diagnostic)\b/i,
    
    // Medical professionals and facilities
    /\b(doctor|physician|oncologist|surgeon|nurse)\b/i,
    /\b(hospital|clinic|medical|healthcare)\b/i
  ];

  /**
   * Check if a message is a simple greeting (not a medical query)
   * @param message User message text
   * @returns true if this is a simple greeting, false otherwise
   */
  static isGreeting(message: string): boolean {
    const trimmed = message.trim();
    
    // Empty or very short messages might be greetings
    if (trimmed.length === 0) {
      return false; // Don't treat empty as greeting
    }
    
    // Check if it matches greeting patterns
    const isGreetingPattern = this.GREETING_PATTERNS.some(pattern => pattern.test(trimmed));
    
    if (!isGreetingPattern) {
      return false;
    }
    
    // If it matches greeting pattern, check for medical keywords
    // If medical keywords are present, it's NOT a simple greeting
    const hasMedicalKeywords = this.MEDICAL_KEYWORDS.some(pattern => pattern.test(trimmed));
    
    return !hasMedicalKeywords;
  }
}







