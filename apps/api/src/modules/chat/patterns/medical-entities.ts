/**
 * Shared pattern registry for medical entity extraction
 * Single source of truth used by both ResponseValidatorService and StructuredExtractorService
 */

export type EntityCategory =
  | "diagnostic_test"
  | "warning_sign"
  | "timeline"
  | "treatment"
  | "staging_prognosis"
  | "procedure";

export interface PatternEntry {
  key: string;           // canonical key, e.g. "ct_scan"
  label: string;         // display label, e.g. "CT scan"
  regex: RegExp;         // detection pattern (global, case-insensitive)
  category: EntityCategory;
  synonyms?: string[];   // for normalized matching
}

// ============================================================================
// DIAGNOSTIC TEST PATTERNS (34 patterns)
// ============================================================================
export const DIAGNOSTIC_TEST_PATTERNS: PatternEntry[] = [
  // Imaging tests
  { key: "ct_scan", label: "CT scan", regex: /\b(CT|CAT)\s*(scan|scanning)?\b/gi, category: "diagnostic_test", synonyms: ["ct", "cat scan", "computed tomography"] },
  { key: "mri", label: "MRI", regex: /\bMRI\b/gi, category: "diagnostic_test", synonyms: ["magnetic resonance imaging"] },
  { key: "pet_scan", label: "PET scan", regex: /\bPET\s*(-\s*CT)?\s*(scan)?\b/gi, category: "diagnostic_test", synonyms: ["pet-ct", "positron emission tomography"] },
  { key: "xray", label: "X-ray", regex: /\bX-?ray\b/gi, category: "diagnostic_test", synonyms: ["x ray", "radiograph"] },
  { key: "chest_xray", label: "Chest X-ray", regex: /\bchest\s*X-?ray\b/gi, category: "diagnostic_test", synonyms: ["chest x ray"] },
  { key: "mammogram", label: "Mammogram", regex: /\bmammogram\b/gi, category: "diagnostic_test", synonyms: ["mammography"] },
  { key: "ultrasound", label: "Ultrasound", regex: /\bultrasound\b/gi, category: "diagnostic_test", synonyms: ["sonogram", "ultrasonography"] },

  // Scopy procedures
  { key: "bronchoscopy", label: "Bronchoscopy", regex: /\bbronchoscopy\b/gi, category: "diagnostic_test" },
  { key: "colonoscopy", label: "Colonoscopy", regex: /\bcolonoscopy\b/gi, category: "diagnostic_test" },
  { key: "endoscopy", label: "Endoscopy", regex: /\bendoscopy\b/gi, category: "diagnostic_test" },
  { key: "laryngoscopy", label: "Laryngoscopy", regex: /\blaryngoscopy\b/gi, category: "diagnostic_test" },
  { key: "colposcopy", label: "Colposcopy", regex: /\bcolposcopy\b/gi, category: "diagnostic_test" },
  { key: "cystoscopy", label: "Cystoscopy", regex: /\bcystoscopy\b/gi, category: "diagnostic_test" },
  { key: "eus", label: "Endoscopic ultrasound", regex: /\bEUS\b/gi, category: "diagnostic_test", synonyms: ["endoscopic ultrasound"] },

  // Biopsies
  { key: "biopsy", label: "Biopsy", regex: /\bbiopsy\b/gi, category: "diagnostic_test" },
  { key: "needle_biopsy", label: "Needle biopsy", regex: /\bneedle\s*biopsy\b/gi, category: "diagnostic_test", synonyms: ["core biopsy"] },
  { key: "surgical_biopsy", label: "Surgical biopsy", regex: /\bsurgical\s*biopsy\b/gi, category: "diagnostic_test", synonyms: ["excisional biopsy"] },
  { key: "fna", label: "Fine needle aspiration", regex: /\bFNA\b/gi, category: "diagnostic_test", synonyms: ["fine needle aspiration"] },

  // Blood tests / tumor markers
  { key: "psa", label: "PSA test", regex: /\bPSA\b/gi, category: "diagnostic_test", synonyms: ["prostate specific antigen"] },
  { key: "afp", label: "AFP test", regex: /\bAFP\b/gi, category: "diagnostic_test", synonyms: ["alpha-fetoprotein"] },
  { key: "ca125", label: "CA-125", regex: /\bCA\s*-?\s*125\b/gi, category: "diagnostic_test" },
  { key: "ca199", label: "CA 19-9", regex: /\bCA\s*-?\s*19-?9\b/gi, category: "diagnostic_test" },
  { key: "cea", label: "CEA", regex: /\bCEA\b/gi, category: "diagnostic_test", synonyms: ["carcinoembryonic antigen"] },
  { key: "tsh", label: "TSH", regex: /\bTSH\b/gi, category: "diagnostic_test", synonyms: ["thyroid stimulating hormone"] },
  { key: "tumor_markers", label: "Tumor markers", regex: /\btumor\s*markers?\b/gi, category: "diagnostic_test" },
  { key: "genetic_markers", label: "Genetic markers", regex: /\bgenetic\s*markers?\b/gi, category: "diagnostic_test" },

  // Screening tests
  { key: "pap_test", label: "Pap test", regex: /\bPap\s*(test|smear)?\b/gi, category: "diagnostic_test", synonyms: ["pap smear", "cervical smear"] },
  { key: "hpv_test", label: "HPV test", regex: /\bHPV\s*test\b/gi, category: "diagnostic_test" },
  { key: "fit", label: "FIT", regex: /\bFIT\b/gi, category: "diagnostic_test", synonyms: ["fecal immunochemical test"] },
  { key: "dre", label: "Digital rectal exam", regex: /\bDRE\b/gi, category: "diagnostic_test", synonyms: ["digital rectal exam"] },
  { key: "urinalysis", label: "Urinalysis", regex: /\burinalysis\b/gi, category: "diagnostic_test" },

  // Other tests
  { key: "sputum_test", label: "Sputum test", regex: /\bsputum\s*test\b/gi, category: "diagnostic_test", synonyms: ["sputum cytology"] },
  { key: "pulmonary_function", label: "Pulmonary function test", regex: /\bpulmonary\s*function\s*test\b/gi, category: "diagnostic_test", synonyms: ["pft", "lung function test"] },
  { key: "pathology", label: "Pathology", regex: /\bpathology\s*(test|report)?\b/gi, category: "diagnostic_test" },
  { key: "staging_workup", label: "Staging workup", regex: /\bstaging\s*(scan|test|workup)?\b/gi, category: "diagnostic_test" },
  { key: "receptor_testing", label: "Receptor testing", regex: /\breceptor\s*testing\b/gi, category: "diagnostic_test" },
];

// ============================================================================
// WARNING SIGN / SYMPTOM PATTERNS (20 patterns)
// ============================================================================
export const WARNING_SIGN_PATTERNS: PatternEntry[] = [
  // Physical signs
  { key: "lump", label: "Lump or mass", regex: /\b(lump|mass|nodule)\b/gi, category: "warning_sign", synonyms: ["growth", "swelling"] },
  { key: "swelling", label: "Swelling", regex: /\bswelling\b/gi, category: "warning_sign" },
  { key: "thickening", label: "Thickening", regex: /\bthickening\b/gi, category: "warning_sign" },
  { key: "skin_changes", label: "Skin changes", regex: /\bskin\s*(changes?|dimpling|puckering)\b/gi, category: "warning_sign" },
  { key: "redness", label: "Redness", regex: /\b(redness|red\s*skin|erythema)\b/gi, category: "warning_sign" },
  { key: "sore_not_healing", label: "Sore that doesn't heal", regex: /\bsore\s+(that\s+)?(won't|doesn't|does\s*not)\s*heal\b/gi, category: "warning_sign" },

  // Discharge and bleeding
  { key: "discharge", label: "Discharge", regex: /\b(discharge|secretion)\b/gi, category: "warning_sign" },
  { key: "nipple_changes", label: "Nipple changes", regex: /\bnipple\s*(inversion|retraction|changes?|discharge)\b/gi, category: "warning_sign" },
  { key: "bleeding", label: "Unusual bleeding", regex: /\b(bleeding|blood\s+in)\b/gi, category: "warning_sign" },

  // Systemic symptoms
  { key: "unexplained_weight_loss", label: "Unexplained weight loss", regex: /\b(unexplained\s+)?weight\s+loss\b/gi, category: "warning_sign" },
  { key: "fatigue", label: "Fatigue", regex: /\b(fatigue|extreme\s*tiredness|exhaustion)\b/gi, category: "warning_sign" },
  { key: "night_sweats", label: "Night sweats", regex: /\bnight\s*sweats\b/gi, category: "warning_sign" },
  { key: "fever", label: "Fever", regex: /\b(fever|fevers|elevated\s*temperature)\b/gi, category: "warning_sign" },
  { key: "pain", label: "Pain", regex: /\b(pain|ache|discomfort)\b/gi, category: "warning_sign" },

  // Functional symptoms
  { key: "persistent_cough", label: "Persistent cough", regex: /\b(persistent\s+)?(cough|coughing)\b/gi, category: "warning_sign" },
  { key: "hoarseness", label: "Hoarseness", regex: /\b(hoarseness|hoarse\s*voice)\b/gi, category: "warning_sign" },
  { key: "difficulty_swallowing", label: "Difficulty swallowing", regex: /\b(difficulty|trouble)\s*(swallowing|eating)\b/gi, category: "warning_sign", synonyms: ["dysphagia"] },
  { key: "difficulty_breathing", label: "Difficulty breathing", regex: /\b(difficulty|trouble|shortness\s*of)\s*breath(ing)?\b/gi, category: "warning_sign", synonyms: ["dyspnea"] },
  { key: "swollen_lymph_nodes", label: "Swollen lymph nodes", regex: /\bswollen\s*lymph\s*nodes?\b/gi, category: "warning_sign", synonyms: ["enlarged lymph nodes", "lymphadenopathy"] },

  // Changes in bowel/bladder
  { key: "bowel_changes", label: "Changes in bowel habits", regex: /\b(changes?\s*(in|to)\s*)?(bowel\s*habits?|bowel\s*movements?)\b/gi, category: "warning_sign" },
];

// ============================================================================
// TIMELINE PATTERNS (10 patterns)
// ============================================================================
export const TIMELINE_PATTERNS: PatternEntry[] = [
  { key: "weeks_range", label: "Weeks range", regex: /\b(\d+)\s*[-–to]\s*(\d+)\s*weeks?\b/gi, category: "timeline" },
  { key: "days_range", label: "Days range", regex: /\b(\d+)\s*[-–to]\s*(\d+)\s*days?\b/gi, category: "timeline" },
  { key: "within_weeks", label: "Within weeks", regex: /\bwithin\s*(\d+)\s*weeks?\b/gi, category: "timeline" },
  { key: "within_days", label: "Within days", regex: /\bwithin\s*(\d+)\s*days?\b/gi, category: "timeline" },
  { key: "immediately", label: "Immediately", regex: /\b(immediately|right\s*away)\b/gi, category: "timeline" },
  { key: "as_soon_as_possible", label: "As soon as possible", regex: /\bas\s*soon\s*as\s*possible\b/gi, category: "timeline", synonyms: ["asap"] },
  { key: "promptly", label: "Promptly", regex: /\bpromptly\b/gi, category: "timeline" },
  { key: "urgently", label: "Urgently", regex: /\burgent(ly)?\b/gi, category: "timeline" },
  { key: "symptoms_persist", label: "If symptoms persist", regex: /\bif\s*(symptoms?\s*)?(persist|continue|worsen)\b/gi, category: "timeline" },
  { key: "seek_care", label: "Seek care timeframe", regex: /\bseek\s*(medical\s*)?(care|attention|evaluation)\b/gi, category: "timeline" },
];

// ============================================================================
// TREATMENT PATTERNS (7 patterns)
// ============================================================================
export const TREATMENT_PATTERNS: PatternEntry[] = [
  { key: "chemotherapy", label: "Chemotherapy", regex: /\bchemotherapy\b/gi, category: "treatment", synonyms: ["chemo"] },
  { key: "immunotherapy", label: "Immunotherapy", regex: /\bimmunotherapy\b/gi, category: "treatment" },
  { key: "radiation", label: "Radiation therapy", regex: /\bradiation\s*(therapy|treatment)?\b/gi, category: "treatment", synonyms: ["radiotherapy"] },
  { key: "targeted_therapy", label: "Targeted therapy", regex: /\btargeted\s*therapy\b/gi, category: "treatment" },
  { key: "hormone_therapy", label: "Hormone therapy", regex: /\bhormone\s*therapy\b/gi, category: "treatment", synonyms: ["hormonal therapy", "endocrine therapy"] },
  { key: "surgery", label: "Surgery", regex: /\bsurgery\b/gi, category: "treatment" },
  { key: "surgical_procedure", label: "Surgical procedure", regex: /\bsurgical\s*(resection|removal|procedure)\b/gi, category: "treatment" },
];

// ============================================================================
// STAGING / PROGNOSIS PATTERNS (7 patterns)
// ============================================================================
export const STAGING_PROGNOSIS_PATTERNS: PatternEntry[] = [
  { key: "stage", label: "Cancer stage", regex: /\bstage\s*[I1-4IV]+\b/gi, category: "staging_prognosis" },
  { key: "staging", label: "Staging", regex: /\bstaging\b/gi, category: "staging_prognosis" },
  { key: "prognosis", label: "Prognosis", regex: /\bprognosis\b/gi, category: "staging_prognosis" },
  { key: "survival_rate", label: "Survival rate", regex: /\bsurvival\s*(rate|percentage)?\b/gi, category: "staging_prognosis" },
  { key: "survival_percent", label: "Survival percentage", regex: /\b\d+%\s*survival\b/gi, category: "staging_prognosis" },
  { key: "metastasis", label: "Metastasis", regex: /\bmetastasis\b/gi, category: "staging_prognosis" },
  { key: "metastatic", label: "Metastatic", regex: /\bmetastatic\b/gi, category: "staging_prognosis" },
];

// ============================================================================
// PROCEDURE PATTERNS (7 patterns)
// ============================================================================
export const PROCEDURE_PATTERNS: PatternEntry[] = [
  { key: "physical_exam", label: "Physical exam", regex: /\bphysical\s*exam\b/gi, category: "procedure" },
  { key: "clinical_exam", label: "Clinical exam", regex: /\bclinical\s*exam\b/gi, category: "procedure" },
  { key: "pelvic_exam", label: "Pelvic exam", regex: /\bpelvic\s*exam\b/gi, category: "procedure" },
  { key: "breast_exam", label: "Breast exam", regex: /\bbreast\s*exam\b/gi, category: "procedure", synonyms: ["clinical breast exam", "cbe"] },
  { key: "chest_exam", label: "Chest exam", regex: /\bchest\s*exam\b/gi, category: "procedure" },
  { key: "neurologic_exam", label: "Neurologic exam", regex: /\bneurologic\s*exam\b/gi, category: "procedure" },
  { key: "ent_exam", label: "ENT exam", regex: /\bENT\s*exam\b/gi, category: "procedure" },
];

// ============================================================================
// HELPER: Get all patterns by category
// ============================================================================
export function getPatternsByCategory(category: EntityCategory): PatternEntry[] {
  switch (category) {
    case "diagnostic_test":
      return DIAGNOSTIC_TEST_PATTERNS;
    case "warning_sign":
      return WARNING_SIGN_PATTERNS;
    case "timeline":
      return TIMELINE_PATTERNS;
    case "treatment":
      return TREATMENT_PATTERNS;
    case "staging_prognosis":
      return STAGING_PROGNOSIS_PATTERNS;
    case "procedure":
      return PROCEDURE_PATTERNS;
    default:
      return [];
  }
}

// ============================================================================
// HELPER: Get all patterns combined
// ============================================================================
export function getAllPatterns(): PatternEntry[] {
  return [
    ...DIAGNOSTIC_TEST_PATTERNS,
    ...WARNING_SIGN_PATTERNS,
    ...TIMELINE_PATTERNS,
    ...TREATMENT_PATTERNS,
    ...STAGING_PROGNOSIS_PATTERNS,
    ...PROCEDURE_PATTERNS,
  ];
}

// ============================================================================
// HELPER: Reset regex lastIndex for all patterns (call before extraction loop)
// ============================================================================
export function resetPatternIndices(patterns: PatternEntry[]): void {
  for (const p of patterns) {
    p.regex.lastIndex = 0;
  }
}
