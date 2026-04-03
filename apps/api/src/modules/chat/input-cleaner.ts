/**
 * Cleans up voice input text before classification.
 *
 * The Web Speech API often produces stuttered or duplicated text when
 * interim results concatenate (e.g. "telltell me about").  This utility
 * normalises such artefacts so downstream intent classification and RAG
 * retrieval see clean input.
 */

// ============= MEDICAL SPELL CORRECTIONS =============
// Common misspellings of medical terms → correct spelling.
// Applied as whole-word replacements (case-insensitive) before
// classification or RAG retrieval.
const MEDICAL_SPELL_CORRECTIONS: Record<string, string> = {
  // Chemotherapy
  'keemo': 'chemo',
  'kemo': 'chemo',
  'kemotherapy': 'chemotherapy',
  'keemotherapy': 'chemotherapy',
  'chemotheraphy': 'chemotherapy',
  'chemo therapy': 'chemotherapy',
  // Mammogram
  'mamogram': 'mammogram',
  'mamography': 'mammography',
  'mamogramm': 'mammogram',
  'mamagram': 'mammogram',
  // Breast
  'brest': 'breast',
  'breat': 'breast',
  // Biopsy
  'biopsi': 'biopsy',
  'biposy': 'biopsy',
  // Symptoms
  'simptoms': 'symptoms',
  'symtoms': 'symptoms',
  'symptomes': 'symptoms',
  'symtpoms': 'symptoms',
  // Cancer
  'canser': 'cancer',
  'cancr': 'cancer',
  'cnacer': 'cancer',
  // Colonoscopy
  'colnoscopy': 'colonoscopy',
  'colonscopy': 'colonoscopy',
  'colonsocopy': 'colonoscopy',
  // Oncologist
  'onkologist': 'oncologist',
  'oncologst': 'oncologist',
  'oncolojist': 'oncologist',
  // Ultrasound
  'ultrasond': 'ultrasound',
  'ultrasund': 'ultrasound',
  // Radiation
  'radation': 'radiation',
  'radition': 'radiation',
  // Leukemia
  'lukemia': 'leukemia',
  'leukaemia': 'leukemia',
  'lukimia': 'leukemia',
  // Cervical
  'cervial': 'cervical',
  'cervikal': 'cervical',
  // Pancreatic
  'pancretic': 'pancreatic',
  'pancriatic': 'pancreatic',
  // Tumor
  'tumour': 'tumor',
  'tumer': 'tumor',
  // Lymphoma
  'limfoma': 'lymphoma',
  'lymfoma': 'lymphoma',
  // Diagnosis
  'dignosis': 'diagnosis',
  'diagnoisis': 'diagnosis',
  // Metastasis
  'metastatis': 'metastasis',
  'metastisis': 'metastasis',
};

/**
 * Correct common medical misspellings in user input.
 * Uses whole-word matching to avoid false positives.
 */
export function correctMedicalSpelling(text: string): string {
  let corrected = text;
  for (const [misspelling, correct] of Object.entries(MEDICAL_SPELL_CORRECTIONS)) {
    const regex = new RegExp(`\\b${misspelling}\\b`, 'gi');
    corrected = corrected.replace(regex, correct);
  }
  return corrected;
}

export function cleanVoiceInput(text: string): string {
  let cleaned = text;

  // Fix stuttered word starts: "telltell me" → "tell me"
  // Pattern: a word fragment (2+ chars) immediately repeated without space
  cleaned = cleaned.replace(/\b(\w{2,})\1\b/gi, '$1');

  // Remove filler words (surrounded by whitespace or at boundaries)
  cleaned = cleaned.replace(/\s+\b(uh|um|uhh|umm|like|you know)\b\s+/gi, ' ');
  // Also handle filler words at the very start of the string
  cleaned = cleaned.replace(/^\s*\b(uh|um|uhh|umm|like|you know)\b\s+/gi, '');

  // Collapse repeated words: "symptoms symptoms" → "symptoms"
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, '$1');

  // Correct common medical misspellings (e.g. keemo → chemo, mamogram → mammogram)
  cleaned = correctMedicalSpelling(cleaned);

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');

  return cleaned.trim();
}
