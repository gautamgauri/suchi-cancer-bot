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
    'sarcoma': 'sarcoma'
  };

  // Check for exact matches first (longer phrases)
  for (const [keyword, cancerType] of Object.entries(cancerKeywords)) {
    if (textLower.includes(keyword)) {
      return cancerType;
    }
  }

  return null; // No specific cancer type detected
}










