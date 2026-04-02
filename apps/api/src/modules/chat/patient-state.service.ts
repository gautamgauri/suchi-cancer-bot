import { Injectable, Logger } from "@nestjs/common";

/**
 * Patient journey states for clinical reasoning.
 * Determines WHAT the model is allowed to discuss and HOW retrieval is filtered.
 */
export enum PatientState {
  INFORMATIONAL = "informational",       // general questions, no personal symptoms
  SYMPTOMATIC = "symptomatic",           // user reports symptoms they're experiencing
  POST_DIAGNOSIS = "post_diagnosis",     // user has been diagnosed, asking about treatment/staging
  URGENT = "urgent",                     // emergency symptoms, red flags
  CAREGIVER = "caregiver",              // asking about someone else's cancer
  SIDE_EFFECTS = "side_effects",        // asking about treatment side effects
}

export interface PatientStateResult {
  state: PatientState;
  confidence: "high" | "medium" | "low";
  matchedPatterns: string[];
}

/**
 * Fast, rule-based patient state detector.
 * No LLM calls — pure pattern matching for sub-millisecond classification.
 *
 * Priority order (highest to lowest):
 *   URGENT > POST_DIAGNOSIS > CAREGIVER > SIDE_EFFECTS > SYMPTOMATIC > INFORMATIONAL
 */
@Injectable()
export class PatientStateService {
  private readonly logger = new Logger(PatientStateService.name);

  // ── URGENT patterns ──────────────────────────────────────────────────
  private readonly URGENT_PATTERNS: RegExp[] = [
    /\b(cough(?:ing)?|vomit(?:ing)?|spit(?:ting)?)\s+blood\b/i,
    /\bcan'?t\s+breathe?\b/i,
    /\bdifficulty\s+breathing\b/i,
    /\bemergency\b/i,
    /\bright\s+now\b/i,
    /\bfever\s+10[3-9]\b/i,
    /\bfever\s+1[1-9]\d\b/i,
    /\bsevere\s+(pain|bleeding|headache)\b/i,
    /\buncontrolled\s+bleeding\b/i,
    /\bcollapsed?\b/i,
    /\bfaint(ed|ing)?\b/i,
    /\bseizure\b/i,
    /\bchest\s+pain\b/i,
    /\bsudd?en(ly)?\s+(worse|swelling|pain)\b/i,
    /\bcan'?t\s+(swallow|eat|drink|move)\b/i,
    /\bsaans\s+nahi\b/i,           // Hindi: can't breathe
    /\bkhoon\s+(aa\s+raha|nikal)\b/i, // Hindi: blood coming out
  ];

  // ── POST_DIAGNOSIS patterns ──────────────────────────────────────────
  private readonly POST_DIAGNOSIS_PATTERNS: RegExp[] = [
    /\bdiagnosed\s+with\b/i,
    /\bstage\s+[1-4IV]+\b/i,
    /\bbiopsy\s+report\s+(says?|shows?|said|showed|results?)\b/i,
    /\bmy\s+report\b/i,
    /\bgrade\s+[1-3]\b/i,
    /\bpathology\s+(report|results?)\b/i,
    /\bher2\s*(positive|negative|\+|-)\b/i,
    /\b(er|pr)\s*(positive|negative|\+|-)\b/i,
    /\breceptor\s+status\b/i,
    /\btriple\s+negative\b/i,
    /\bmy\s+(cancer|tumor|tumour)\s+(is|was)\b/i,
    /\btreatment\s+(plan|option|pathway)\b/i,
    /\bafter\s+(my\s+)?(surgery|biopsy|diagnosis)\b/i,
    /\bwhat\s+stage\b/i,
    /\bmy\s+oncologist\s+(said|told|recommended)\b/i,
    /\bwhat\s+does\s+my\s+(report|biopsy|pathology)\b/i,
  ];

  // ── CAREGIVER patterns ───────────────────────────────────────────────
  // First-person possessive + family/relation word, with optional cancer context
  private readonly CAREGIVER_RELATION_PATTERNS: RegExp[] = [
    /\bmy\s+(father|mother|mom|dad|wife|husband|spouse|brother|sister|son|daughter|friend|relative|uncle|aunt|grandfather|grandmother|parent)\b/i,
    /\bmy\s+(bhai|behen|maa|papa|pita|mata|pati|patni|dost|rishtedaar)\b/i, // Hindi relations
    /\b(father|mother|mom|dad|wife|husband|spouse)\s+(has|had|got|diagnosed|is\s+having)\b/i,
    /\b(caring|care)\s+for\s+(my|a)\b/i,
    /\bsomeone\s+(I\s+know|close\s+to\s+me)\b/i,
    /\bas\s+a\s+caregiver\b/i,
    /\b(his|her)\s+(cancer|diagnosis|treatment|chemo|report|biopsy)\b/i,
  ];

  // Cancer-related terms used to confirm caregiver context
  private readonly CANCER_CONTEXT_PATTERNS: RegExp[] = [
    /\bcancer\b/i,
    /\btumou?r\b/i,
    /\bchemo(therapy)?\b/i,
    /\bradiation\b/i,
    /\boncolog(ist|y)\b/i,
    /\bbiopsy\b/i,
    /\bdiagnos(ed|is)\b/i,
    /\bstage\b/i,
    /\bmalignant\b/i,
    /\blump\b/i,
    /\btreatment\b/i,
  ];

  // ── SIDE_EFFECTS patterns ────────────────────────────────────────────
  private readonly SIDE_EFFECTS_PATTERNS: RegExp[] = [
    /\bside\s+effects?\b/i,
    /\bafter\s+(chemo|chemotherapy|radiation|treatment|surgery)\b/i,
    /\bduring\s+(chemo|chemotherapy|radiation|treatment)\b/i,
    /\bchemo(therapy)?\s+(cause|making|made|gave)\b/i,
    /\b(nausea|vomiting|hair\s+loss|fatigue|tired|mouth\s+sores?)\s+(from|after|during|because\s+of)\s+(chemo|treatment|radiation)\b/i,
    /\bradiation\s+(burn|skin|damage|side)\b/i,
    /\b(immunotherapy|targeted\s+therapy)\s+(side|effect|cause)\b/i,
    /\b(managing|coping|dealing)\s+with\s+(chemo|treatment|radiation)\b/i,
    /\breaction\s+to\s+(chemo|treatment|drug|medicine)\b/i,
  ];

  // ── SYMPTOMATIC patterns ─────────────────────────────────────────────
  // First-person symptom reports
  private readonly SYMPTOMATIC_FIRST_PERSON: RegExp[] = [
    /\bI\s+(found|have|noticed|feel|felt|see|saw|got|developed|discovered)\b/i,
    /\bI'?ve?\s+(been|got|had|noticed|found)\b/i,
    /\bI\s+am\s+(having|feeling|experiencing|noticing)\b/i,
    /\bthere\s+is\s+a\s+(lump|bump|mass|swelling|growth)\b/i,
    /\b(it|this)\s+(hurts|pains|aches|itches|bleeds|burns)\b/i,
    /\bmujhe\b/i,   // Hindi: "I have / to me"
    /\bmere\s+(breast|pet|sar|seene)\b/i, // Hindi: my body parts
  ];

  // Symptom keywords (need first-person context to trigger SYMPTOMATIC)
  private readonly SYMPTOM_KEYWORDS: RegExp[] = [
    /\b(lump|bump|mass|swelling|growth|nodule)\b/i,
    /\b(bleeding|blood|discharge|spotting)\b/i,
    /\b(pain|ache|hurt|sore|tender)\b/i,
    /\b(weight\s+loss|losing\s+weight)\b/i,
    /\b(fatigue|tired|exhausted)\b/i,
    /\b(change|changes)\s+(in|to)\s+(skin|breast|mole|bowel|stool|urine)\b/i,
    /\b(difficulty|trouble)\s+(swallowing|urinating|eating)\b/i,
    /\b(cough|hoarse|wheezing)\b/i,
    /\b(night\s+sweats?)\b/i,
  ];

  /**
   * Classify the patient's journey state from their message text.
   * Pure pattern matching — no LLM, sub-millisecond.
   */
  detect(userText: string): PatientStateResult {
    const text = userText.trim();
    const matched: string[] = [];

    // 1. URGENT — highest priority
    for (const pattern of this.URGENT_PATTERNS) {
      if (pattern.test(text)) {
        matched.push(`urgent:${pattern.source.substring(0, 40)}`);
      }
    }
    if (matched.length > 0) {
      return { state: PatientState.URGENT, confidence: "high", matchedPatterns: matched };
    }

    // 2. POST_DIAGNOSIS
    for (const pattern of this.POST_DIAGNOSIS_PATTERNS) {
      if (pattern.test(text)) {
        matched.push(`post_diagnosis:${pattern.source.substring(0, 40)}`);
      }
    }
    if (matched.length > 0) {
      return {
        state: PatientState.POST_DIAGNOSIS,
        confidence: matched.length >= 2 ? "high" : "medium",
        matchedPatterns: matched,
      };
    }

    // 3. CAREGIVER — need relation pattern + cancer context
    const hasRelation = this.CAREGIVER_RELATION_PATTERNS.some((p) => p.test(text));
    if (hasRelation) {
      const hasCancerContext = this.CANCER_CONTEXT_PATTERNS.some((p) => p.test(text));
      // "his/her cancer/treatment" patterns already imply cancer context
      const hasImpliedCancerContext = /\b(his|her)\s+(cancer|diagnosis|treatment|chemo|report|biopsy)\b/i.test(text);
      if (hasCancerContext || hasImpliedCancerContext) {
        const relationMatch = this.CAREGIVER_RELATION_PATTERNS.find((p) => p.test(text));
        matched.push(`caregiver:relation+cancer_context`);
        if (relationMatch) matched.push(`caregiver:${relationMatch.source.substring(0, 40)}`);
        return { state: PatientState.CAREGIVER, confidence: "high", matchedPatterns: matched };
      }
      // Relation word without cancer context — might still be caregiver but low confidence
      // Fall through to check other states
    }

    // 4. SIDE_EFFECTS
    for (const pattern of this.SIDE_EFFECTS_PATTERNS) {
      if (pattern.test(text)) {
        matched.push(`side_effects:${pattern.source.substring(0, 40)}`);
      }
    }
    if (matched.length > 0) {
      return {
        state: PatientState.SIDE_EFFECTS,
        confidence: matched.length >= 2 ? "high" : "medium",
        matchedPatterns: matched,
      };
    }

    // 5. SYMPTOMATIC — need first-person + symptom keyword
    const hasFirstPerson = this.SYMPTOMATIC_FIRST_PERSON.some((p) => p.test(text));
    const hasSymptomKeyword = this.SYMPTOM_KEYWORDS.some((p) => p.test(text));

    if (hasFirstPerson && hasSymptomKeyword) {
      matched.push("symptomatic:first_person+symptom_keyword");
      return { state: PatientState.SYMPTOMATIC, confidence: "high", matchedPatterns: matched };
    }
    if (hasFirstPerson) {
      // First person but no explicit symptom keyword — could still be symptomatic
      // Check for implicit symptom language
      if (/\b(worry|worried|scared|concerned|anxious|afraid)\b/i.test(text) && /\b(cancer|lump|growth|tumor)\b/i.test(text)) {
        matched.push("symptomatic:first_person+worry+cancer_term");
        return { state: PatientState.SYMPTOMATIC, confidence: "medium", matchedPatterns: matched };
      }
    }
    if (hasSymptomKeyword && !hasRelation) {
      // Symptom keyword without explicit first person — might still be personal
      // Lower confidence; could be informational
      // BUT: exclude informational framing like "tell me about symptoms", "what are the symptoms"
      const hasInformationalFraming = /\b(tell\s+me\s+about|what\s+are|what\s+is|explain|describe|list|information\s+about|learn\s+about|know\s+about|how\s+to\s+identify|signs\s+of)\b/i.test(text);
      if (/\b(my|me|I)\b/.test(text) && !hasInformationalFraming) {
        matched.push("symptomatic:symptom_keyword+implicit_first_person");
        return { state: PatientState.SYMPTOMATIC, confidence: "medium", matchedPatterns: matched };
      }
    }

    // 6. INFORMATIONAL — default fallback
    return { state: PatientState.INFORMATIONAL, confidence: "low", matchedPatterns: ["informational:default"] };
  }
}
