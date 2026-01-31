import { Injectable, Logger } from '@nestjs/common';

export interface QueryExpansion {
  original: string;
  expanded: string[];
  synonyms: Map<string, string[]>;
  abbreviationsExpanded: string[];
}

/**
 * Medical Query Expansion Service
 * Maps colloquial terms to medical terminology for better retrieval
 *
 * Key expansions:
 * 1. Symptom terms (patient language → medical terms)
 * 2. Treatment abbreviations (chemo → chemotherapy)
 * 3. Cancer type synonyms (colon → colorectal)
 * 4. Test abbreviations (PSA, CA-125, MRI)
 * 5. Staging/grade terms
 */
@Injectable()
export class QueryExpanderService {
  private readonly logger = new Logger(QueryExpanderService.name);

  // ============= SYMPTOM SYNONYMS =============
  // Patient colloquial terms → medical terminology
  private readonly SYMPTOM_SYNONYMS = new Map<string, string[]>([
    // Abdominal/GI symptoms
    ['bloating', ['abdominal distension', 'distended abdomen', 'abdominal swelling']],
    ['stomach pain', ['abdominal pain', 'epigastric pain', 'gastric discomfort']],
    ['belly pain', ['abdominal pain', 'lower abdominal pain']],
    ['throwing up', ['vomiting', 'emesis', 'nausea and vomiting']],
    ['nausea', ['nausea', 'queasy', 'upset stomach']],
    ['blood in stool', ['rectal bleeding', 'hematochezia', 'melena', 'bloody stool']],
    ['black stool', ['melena', 'tarry stool', 'gastrointestinal bleeding']],
    ['difficulty swallowing', ['dysphagia', 'swallowing difficulty', 'odynophagia']],
    ['hard to swallow', ['dysphagia', 'swallowing problems']],
    ['constipation', ['constipation', 'bowel obstruction', 'difficulty passing stool']],
    ['diarrhea', ['diarrhea', 'loose stools', 'frequent bowel movements']],
    ['heartburn', ['acid reflux', 'GERD', 'gastroesophageal reflux']],

    // Pelvic/reproductive symptoms
    ['pelvic pain', ['pelvic discomfort', 'lower abdominal pain', 'pelvic pressure']],
    ['painful periods', ['dysmenorrhea', 'menstrual pain', 'painful menstruation']],
    ['abnormal bleeding', ['irregular bleeding', 'menorrhagia', 'metrorrhagia', 'postmenopausal bleeding']],
    ['bleeding after menopause', ['postmenopausal bleeding', 'PMB', 'vaginal bleeding']],

    // Urinary symptoms
    ['frequent urination', ['urinary frequency', 'polyuria', 'urinary urgency']],
    ['painful urination', ['dysuria', 'burning urination']],
    ['blood in urine', ['hematuria', 'bloody urine', 'gross hematuria']],
    ['trouble peeing', ['urinary retention', 'difficulty urinating', 'weak urine stream']],

    // Respiratory symptoms
    ['shortness of breath', ['dyspnea', 'breathlessness', 'respiratory distress']],
    ['coughing blood', ['hemoptysis', 'bloody sputum']],
    ['persistent cough', ['chronic cough', 'prolonged cough']],
    ['wheezing', ['wheezing', 'stridor', 'breathing difficulty']],

    // Systemic symptoms
    ['tired', ['fatigue', 'tiredness', 'exhaustion', 'asthenia']],
    ['always tired', ['chronic fatigue', 'persistent fatigue', 'profound fatigue']],
    ['weight loss', ['unintentional weight loss', 'unexplained weight loss', 'cachexia']],
    ['lost weight', ['weight loss', 'unintentional weight loss']],
    ['night sweats', ['nocturnal diaphoresis', 'night sweating', 'drenching sweats']],
    ['fever', ['pyrexia', 'elevated temperature', 'febrile']],
    ['loss of appetite', ['anorexia', 'decreased appetite', 'poor appetite']],
    ['not hungry', ['anorexia', 'loss of appetite', 'decreased appetite']],

    // Skin symptoms
    ['lump', ['mass', 'nodule', 'tumor', 'swelling']],
    ['bump', ['mass', 'nodule', 'lesion']],
    ['mole changes', ['changing mole', 'atypical nevus', 'dysplastic nevus', 'melanoma signs']],
    ['new mole', ['new skin lesion', 'pigmented lesion']],
    ['skin sore', ['skin ulcer', 'non-healing wound', 'skin lesion']],
    ['jaundice', ['jaundice', 'yellowing of skin', 'icterus', 'yellow eyes']],
    ['yellow skin', ['jaundice', 'icterus', 'hyperbilirubinemia']],

    // Breast symptoms
    ['breast lump', ['breast mass', 'breast nodule', 'palpable breast lesion']],
    ['nipple discharge', ['nipple discharge', 'galactorrhea', 'bloody nipple discharge']],
    ['breast pain', ['mastalgia', 'breast tenderness', 'breast discomfort']],

    // Neurological symptoms
    ['headache', ['headache', 'cephalgia', 'head pain']],
    ['bad headaches', ['severe headache', 'persistent headache', 'intractable headache']],
    ['seizure', ['seizure', 'convulsion', 'epileptic episode']],
    ['numbness', ['paresthesia', 'numbness', 'tingling', 'sensory deficit']],
    ['confusion', ['cognitive changes', 'mental status changes', 'altered consciousness']],

    // Pain terms
    ['ache', ['pain', 'discomfort']],
    ['hurts', ['pain', 'painful']],
    ['sore', ['painful', 'tenderness']],

    // General symptom phrases
    ['early warning signs', ['signs and symptoms', 'early symptoms', 'warning signs', 'clinical presentation']],
    ['warning signs', ['signs and symptoms', 'symptoms', 'clinical signs']],
    ['signs of', ['signs and symptoms of', 'symptoms of', 'manifestations of']],
    ['symptoms of', ['signs and symptoms of', 'clinical presentation of']],
  ]);

  // ============= TREATMENT SYNONYMS =============
  // Colloquial treatment terms → medical terms
  private readonly TREATMENT_SYNONYMS = new Map<string, string[]>([
    ['chemo', ['chemotherapy', 'systemic therapy', 'cytotoxic therapy']],
    ['radiation', ['radiotherapy', 'radiation therapy', 'external beam radiation']],
    ['immunotherapy', ['immunotherapy', 'immune checkpoint inhibitor', 'biological therapy']],
    ['targeted therapy', ['targeted therapy', 'molecular targeted therapy', 'precision therapy']],
    ['hormone therapy', ['hormonal therapy', 'endocrine therapy', 'hormone treatment']],
    ['surgery', ['surgical resection', 'surgical excision', 'operative treatment']],
    ['biopsy', ['biopsy', 'tissue sampling', 'histological examination']],
    ['stem cell transplant', ['bone marrow transplant', 'hematopoietic stem cell transplant', 'HSCT']],
    ['CAR-T', ['CAR-T cell therapy', 'chimeric antigen receptor T-cell', 'adoptive cell therapy']],

    // Side effects
    ['chemo side effects', ['chemotherapy side effects', 'chemotherapy toxicity', 'treatment-related adverse events']],
    ['nausea from chemo', ['chemotherapy-induced nausea', 'CINV', 'chemotherapy nausea and vomiting']],
    ['hair loss', ['alopecia', 'chemotherapy-induced alopecia', 'hair loss from treatment']],
  ]);

  // ============= MEDICAL ABBREVIATIONS =============
  // Common abbreviations → full terms (for query expansion)
  private readonly ABBREVIATIONS = new Map<string, string[]>([
    // Tumor markers
    ['psa', ['prostate-specific antigen', 'PSA test', 'PSA level']],
    ['ca-125', ['cancer antigen 125', 'CA-125 test', 'CA-125 level']],
    ['ca 125', ['cancer antigen 125', 'CA-125 test']],
    ['cea', ['carcinoembryonic antigen', 'CEA test', 'CEA level']],
    ['afp', ['alpha-fetoprotein', 'AFP test']],
    ['hcg', ['human chorionic gonadotropin', 'beta-hCG']],

    // Imaging
    ['ct scan', ['computed tomography', 'CT imaging', 'CAT scan']],
    ['mri', ['magnetic resonance imaging', 'MRI scan']],
    ['pet scan', ['positron emission tomography', 'PET-CT', 'PET imaging']],
    ['mammogram', ['mammography', 'breast imaging', 'screening mammogram']],
    ['ultrasound', ['ultrasonography', 'sonography', 'US imaging']],

    // Procedures
    ['egd', ['esophagogastroduodenoscopy', 'upper endoscopy', 'gastroscopy']],
    ['ercp', ['endoscopic retrograde cholangiopancreatography']],
    ['eus', ['endoscopic ultrasound', 'endosonography']],

    // Staging
    ['tnm', ['TNM staging', 'tumor node metastasis', 'cancer staging']],
    ['ajcc', ['American Joint Committee on Cancer', 'AJCC staging']],

    // Genetic/molecular
    ['brca', ['BRCA gene', 'BRCA mutation', 'BRCA1/BRCA2']],
    ['brca1', ['BRCA1 gene', 'BRCA1 mutation']],
    ['brca2', ['BRCA2 gene', 'BRCA2 mutation']],
    ['her2', ['HER2 receptor', 'HER2 positive', 'HER2 status']],
    ['egfr', ['EGFR mutation', 'epidermal growth factor receptor']],
    ['alk', ['ALK rearrangement', 'ALK fusion', 'ALK positive']],
    ['kras', ['KRAS mutation', 'KRAS gene']],
    ['msi', ['microsatellite instability', 'MSI-H', 'MSI status']],
    ['mmr', ['mismatch repair', 'MMR deficiency', 'dMMR']],
    ['pd-l1', ['PD-L1 expression', 'programmed death-ligand 1']],

    // General
    ['chemo', ['chemotherapy']],
    ['mets', ['metastases', 'metastatic disease', 'distant metastasis']],
    ['onco', ['oncologist', 'oncology']],
  ]);

  // ============= CAREGIVER/NAVIGATION SYNONYMS =============
  // Caregiver and appointment-related terms for better retrieval
  // These map user queries to phrases found in NCI KB content (e.g., communication-pdq)
  private readonly NAVIGATION_SYNONYMS = new Map<string, string[]>([
    // Appointment preparation - mapped to NCI communication-pdq content phrases
    ['prepare for appointments', ['communication in cancer care', 'questions to ask before visit', 'remember what doctor said', 'list of questions']],
    ['prepare for appointment', ['communication in cancer care', 'questions to ask before visit', 'remember what doctor said', 'list of questions']],
    ['appointment preparation', ['communication in cancer care', 'improve communication with doctors', 'questions before visit']],
    ['first appointment', ['initial consultation', 'first visit', 'meet with doctor', 'health care team']],
    ['doctor visit', ['meet with your doctor', 'health care team', 'communicate with doctors']],
    ['oncologist appointment', ['oncology consultation', 'cancer care team', 'meet with doctor']],
    ['what to bring', ['copy of information', 'record the discussion', 'family member go with you']],
    ['help with appointments', ['family member go with you', 'support for caregivers', 'communication']],

    // Caregiver terms - mapped to NCI caregiver-support content
    ['caregiver', ['family caregiver', 'support for caregivers', 'when someone you love']],
    ['help her', ['support for caregivers', 'family member', 'loved one has cancer']],
    ['help him', ['support for caregivers', 'family member', 'loved one has cancer']],
    ['taking care of', ['caregiving', 'when someone you love', 'support for caregivers']],
    ['support my', ['family caregiver', 'support for caregivers', 'when someone you love']],
    ['mother diagnosed', ['family member', 'loved one has cancer', 'when someone you love']],
    ['father diagnosed', ['family member', 'loved one has cancer', 'when someone you love']],

    // Communication with doctors - mapped to NCI content
    ['talk to doctor', ['communicate with doctors', 'health care team', 'questions to ask']],
    ['questions to ask', ['list of questions', 'questions before visit', 'questions to ask doctor']],
    ['understand doctor', ['remember what doctor said', 'copy of information', 'communication']],
    ['remember what doctor', ['list of questions', 'record the discussion', 'copy of information']],
  ]);

  // ============= CANCER TYPE SYNONYMS =============
  // Common names → medical terminology
  private readonly CANCER_SYNONYMS = new Map<string, string[]>([
    ['colon cancer', ['colorectal cancer', 'colon carcinoma', 'bowel cancer']],
    ['bowel cancer', ['colorectal cancer', 'colon cancer', 'rectal cancer']],
    ['lung cancer', ['pulmonary carcinoma', 'bronchogenic carcinoma', 'lung carcinoma']],
    ['breast cancer', ['mammary carcinoma', 'breast carcinoma']],
    ['skin cancer', ['cutaneous malignancy', 'skin carcinoma']],
    ['blood cancer', ['hematologic malignancy', 'leukemia', 'lymphoma']],
    ['brain tumor', ['brain cancer', 'intracranial tumor', 'CNS tumor', 'brain neoplasm']],
    ['liver cancer', ['hepatocellular carcinoma', 'HCC', 'liver carcinoma']],
    ['kidney cancer', ['renal cell carcinoma', 'RCC', 'renal cancer']],
    ['bladder cancer', ['urothelial carcinoma', 'bladder carcinoma', 'transitional cell carcinoma']],
    ['stomach cancer', ['gastric cancer', 'gastric carcinoma', 'stomach carcinoma']],
    ['pancreatic cancer', ['pancreatic carcinoma', 'pancreatic adenocarcinoma']],
    ['throat cancer', ['pharyngeal cancer', 'laryngeal cancer', 'head and neck cancer']],
    ['mouth cancer', ['oral cancer', 'oral cavity cancer', 'oral carcinoma']],
    ['bone cancer', ['bone sarcoma', 'osteosarcoma', 'skeletal malignancy']],
    ['ovarian cancer', ['ovarian carcinoma', 'epithelial ovarian cancer']],
    ['cervical cancer', ['cervical carcinoma', 'cancer of the cervix']],
    ['uterine cancer', ['endometrial cancer', 'uterine carcinoma', 'corpus uteri cancer']],
    ['prostate cancer', ['prostatic carcinoma', 'prostate adenocarcinoma']],
    ['testicular cancer', ['testicular germ cell tumor', 'testis cancer']],
    ['thyroid cancer', ['thyroid carcinoma', 'papillary thyroid cancer']],
    ['lymphoma', ['lymphatic cancer', 'lymphoid neoplasm']],
    ['leukemia', ['blood cancer', 'leukemic disorder']],
    ['melanoma', ['malignant melanoma', 'cutaneous melanoma', 'skin melanoma']],
    ['sarcoma', ['soft tissue sarcoma', 'mesenchymal tumor']],
  ]);

  // ============= RISK FACTOR SYNONYMS =============
  // Cross-cutting risk factors that apply to multiple cancer types
  // Helps retrieve content about smoking, obesity, HPV, etc. across all related cancers
  private readonly RISK_FACTOR_SYNONYMS = new Map<string, string[]>([
    // Smoking - the most important cross-cancer risk factor
    ['smoking', ['tobacco use', 'cigarette smoking', 'smoking risk factor', 'tobacco causes cancer']],
    ['cigarette', ['tobacco', 'smoking', 'cigarette smoking', 'tobacco use']],
    ['tobacco', ['smoking', 'cigarette', 'tobacco use', 'tobacco causes cancer']],
    ['does smoking cause', ['smoking causes cancer', 'smoking risk factor', 'tobacco related cancers', 'cancers caused by smoking']],
    ['smoking cancer', ['smoking causes cancer', 'tobacco related cancer types', 'cancers caused by smoking']],
    ['other cancers', ['multiple cancer types', 'various cancers', 'different types of cancer']],
    ['smoking other cancer', ['smoking causes multiple cancers', 'tobacco related cancers', 'cancers linked to smoking']],

    // Obesity risk factors
    ['obesity cancer', ['obesity risk factor cancer', 'weight gain cancer risk', 'overweight cancer']],
    ['overweight cancer', ['obesity cancer risk', 'body weight cancer', 'BMI cancer risk']],

    // Alcohol risk factors
    ['alcohol cancer', ['alcohol risk factor', 'drinking cancer risk', 'alcohol related cancer']],
    ['drinking cancer', ['alcohol cancer risk', 'alcohol related cancer types']],

    // Sun/UV risk factors
    ['sun exposure cancer', ['UV radiation cancer', 'ultraviolet light cancer risk', 'sun damage skin cancer']],
    ['uv cancer', ['sun exposure cancer', 'ultraviolet cancer risk', 'sunlight cancer']],

    // HPV risk factors
    ['hpv cancer', ['human papillomavirus cancer', 'hpv related cancer', 'hpv infection cancer risk']],
  ]);

  // ============= INTENTS TO EXPAND =============
  // Only expand queries for these informational intents
  private readonly EXPANDABLE_INTENTS = new Set([
    'INFORMATIONAL_GENERAL',
    'INFORMATIONAL_SYMPTOMS',
    'PREVENTION_SCREENING_INFO',
    'POST_DIAGNOSIS_OR_SUSPECTED',
    'SYMPTOMATIC_PATIENT',
    'CAREGIVER_NAVIGATION',
  ]);

  /**
   * Expand query with medical synonyms for better retrieval
   * @param query Original user query
   * @param intent Detected user intent
   * @returns Expanded query variations
   */
  expandQuery(query: string, intent: string): QueryExpansion {
    const expanded: string[] = [query]; // Always include original
    const matchedSynonyms = new Map<string, string[]>();
    const abbreviationsExpanded: string[] = [];

    // Only expand for informational intents (not urgent/crisis)
    if (!this.EXPANDABLE_INTENTS.has(intent)) {
      return { original: query, expanded, synonyms: matchedSynonyms, abbreviationsExpanded };
    }

    const lowerQuery = query.toLowerCase();

    // 1. Expand symptom terms
    this.expandTerms(lowerQuery, this.SYMPTOM_SYNONYMS, expanded, matchedSynonyms);

    // 2. Expand treatment terms
    this.expandTerms(lowerQuery, this.TREATMENT_SYNONYMS, expanded, matchedSynonyms);

    // 3. Expand abbreviations
    this.expandAbbreviations(lowerQuery, expanded, abbreviationsExpanded);

    // 4. Expand cancer type synonyms
    this.expandTerms(lowerQuery, this.CANCER_SYNONYMS, expanded, matchedSynonyms);

    // 5. Expand navigation/caregiver terms (for appointment prep, caregiver queries)
    this.expandTerms(lowerQuery, this.NAVIGATION_SYNONYMS, expanded, matchedSynonyms);

    // 6. Expand risk factor terms (for cross-cancer risk factor queries like smoking, obesity)
    this.expandTerms(lowerQuery, this.RISK_FACTOR_SYNONYMS, expanded, matchedSynonyms);

    // Deduplicate expanded queries
    const uniqueExpanded = [...new Set(expanded)];

    // Log expansion for observability
    if (uniqueExpanded.length > 1) {
      this.logger.log({
        event: 'query_expansion',
        original: query,
        expandedCount: uniqueExpanded.length,
        synonymsMatched: Array.from(matchedSynonyms.keys()),
        abbreviationsExpanded,
      });
    }

    return {
      original: query,
      expanded: uniqueExpanded,
      synonyms: matchedSynonyms,
      abbreviationsExpanded
    };
  }

  /**
   * Expand terms from a synonym map
   */
  private expandTerms(
    lowerQuery: string,
    synonymMap: Map<string, string[]>,
    expanded: string[],
    matchedSynonyms: Map<string, string[]>
  ): void {
    for (const [term, synonyms] of synonymMap.entries()) {
      if (lowerQuery.includes(term)) {
        matchedSynonyms.set(term, synonyms);

        // Create expanded queries with top synonyms (limit to avoid over-expansion)
        synonyms.slice(0, 2).forEach(synonym => {
          const expandedQuery = lowerQuery.replace(term, synonym);
          if (expandedQuery !== lowerQuery) {
            expanded.push(expandedQuery);
          }
        });
      }
    }
  }

  /**
   * Expand medical abbreviations
   */
  private expandAbbreviations(
    lowerQuery: string,
    expanded: string[],
    abbreviationsExpanded: string[]
  ): void {
    // Split query into words to match whole abbreviations
    const words = lowerQuery.split(/\s+/);

    for (const [abbrev, fullForms] of this.ABBREVIATIONS.entries()) {
      // Check if abbreviation appears as a whole word
      if (words.includes(abbrev) || lowerQuery.includes(abbrev + ' ') || lowerQuery.includes(' ' + abbrev)) {
        abbreviationsExpanded.push(abbrev);

        // Add first full form as expanded query
        const fullForm = fullForms[0];
        const expandedQuery = lowerQuery.replace(new RegExp(`\\b${abbrev}\\b`, 'gi'), fullForm);
        if (expandedQuery !== lowerQuery) {
          expanded.push(expandedQuery);
        }
      }
    }
  }

  /**
   * Get all synonyms for a term (useful for highlighting)
   */
  getSynonyms(term: string): string[] {
    const lower = term.toLowerCase();
    return this.SYMPTOM_SYNONYMS.get(lower)
      || this.TREATMENT_SYNONYMS.get(lower)
      || this.CANCER_SYNONYMS.get(lower)
      || this.NAVIGATION_SYNONYMS.get(lower)
      || this.RISK_FACTOR_SYNONYMS.get(lower)
      || this.ABBREVIATIONS.get(lower)
      || [];
  }

  /**
   * Deduplicate chunks by chunkId (helper for RAG service)
   */
  deduplicateChunks<T extends { chunkId: string }>(chunks: T[]): T[] {
    const seen = new Set<string>();
    const unique: T[] = [];

    for (const chunk of chunks) {
      if (!seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        unique.push(chunk);
      }
    }

    return unique;
  }
}
