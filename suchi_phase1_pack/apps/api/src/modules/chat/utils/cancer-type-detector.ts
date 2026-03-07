/**
 * Cancer type detector - extracts cancer type from user queries
 * Used to make identify question responses cancer-type-specific
 * @param userText User message text
 * @param sessionCancerType Optional cancer type from session (checked first)
 */
export function detectCancerType(userText: string, sessionCancerType?: string | null): string | null {
  // Check session first if available
  if (sessionCancerType) {
    return sessionCancerType;
  }

  const textLower = userText.toLowerCase();
  
  const cancerKeywords: Record<string, string> = {
    'breast': 'breast',
    'lung': 'lung',
    'prostate': 'prostate',
    'colorectal': 'colorectal',
    'colon': 'colorectal',
    'rectal': 'colorectal',
    'pancreatic': 'pancreatic',
    'ovarian': 'ovarian',
    'leukemia': 'leukemia',
    'lymphoma': 'lymphoma',
    'melanoma': 'skin',
    'skin cancer': 'skin',
    'thyroid': 'thyroid',
    'liver': 'liver',
    'kidney': 'kidney',
    'stomach': 'stomach',
    'bladder': 'bladder',
    'cervical': 'cervical',
    'uterine': 'uterine',
    'endometrial': 'endometrial',
    'brain': 'brain',
    'esophageal': 'esophageal',
    'head and neck': 'head and neck',
    'oral': 'oral',
    'mouth': 'oral',
    'sarcoma': 'sarcoma'
  };

  // Check for exact matches first (longer phrases)
  for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
    if (textLower.includes(keyword)) {
      return cancerType;
    }
  }

  // Symptom-based inference: map characteristic symptoms to likely cancer type
  // This helps when users describe symptoms without naming the cancer
  const symptomInference: Array<{ pattern: RegExp; cancerType: string }> = [
    { pattern: /\b(blood|bleeding)\b.*\b(stool|bowel|rectal|rectum)\b/i, cancerType: 'colorectal' },
    { pattern: /\b(stool|bowel)\b.*\b(blood|bleeding)\b/i, cancerType: 'colorectal' },
    { pattern: /\blump\b.*\bbreast\b/i, cancerType: 'breast' },
    { pattern: /\bbreast\b.*\blump\b/i, cancerType: 'breast' },
  ];

  for (const { pattern, cancerType } of symptomInference) {
    if (pattern.test(textLower)) {
      return cancerType;
    }
  }

  return null; // No specific cancer type detected
}










