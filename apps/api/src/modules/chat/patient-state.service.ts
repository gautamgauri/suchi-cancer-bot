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
 *   URGENT > CAREGIVER > POST_DIAGNOSIS > SIDE_EFFECTS > SYMPTOMATIC > INFORMATIONAL
 *
 * CAREGIVER sits above POST_DIAGNOSIS because its patterns answer WHO IS
 * SPEAKING while POST_DIAGNOSIS's answer WHAT IS WRONG, and a relative's
 * illness satisfies the latter just as well as one's own (issue #154). A
 * first-person claim on one's OWN care overrides the relation word.
 *
 * Those two jobs use two different sets. FIRST_PERSON_SELF_REFERENCE is broad
 * and only decides patient-vs-caregiver; FIRST_PERSON_DIAGNOSIS_OWNERSHIP is
 * narrow and is the only first-person route into POST_DIAGNOSIS, because that
 * contract asserts to the reader that they have been diagnosed. A scheduled
 * biopsy, an oncology appointment or an operation is not a diagnosis.
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
    // Hinglish possessive + relation. The rule above requires the ENGLISH "my",
    // so the natural Hinglish forms — "mere papa", "meri maa", "mera bhai" —
    // matched no relation at all and fell through to INFORMATIONAL (issue #154).
    // The relation nouns here are disjoint from the illness nouns in
    // FIRST_PERSON_SELF_REFERENCE, so "meri maa" reads as a relation while
    // "meri report" still reads as the speaker's own.
    /\bmer[aei]\s+(bhai|behen|bahan|maa|maan|papa|pita|mata|pati|patni|beta|beti|chacha|chachi|dada|dadi|nana|nani|dost|rishtedaar|sasur|saas)\b/i,
    // Devanagari relations. NO `\b` anywhere near these: JavaScript word
    // boundaries are ASCII-only and are meaningless against Devanagari, a bug
    // this project has shipped before. Without these a Hindi-script caregiver
    // ("मेरे पिता को कैंसर है") matched no relation at all and fell through to
    // INFORMATIONAL (issue #154).
    /मेरे\s*(पिता|पापा|भाई|पति|चाचा|दादा|बेटे|ससुर)/,
    /मेरी\s*(माँ|मां|माता|बहन|पत्नी|बेटी|चाची|दादी|सास)/,
    /मेरा\s*(बेटा|भाई|दोस्त|रिश्तेदार)/,
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
    // Devanagari equivalents — again deliberately without `\b` (issue #154).
    /कैंसर|कैन्सर/,
    /ट्यूमर|गाँठ|गांठ/,
    /कीमो(थेरेपी)?/,
    /रेडिएशन|विकिरण/,
    /बायोप्सी/,
    /इलाज|उपचार/,
  ];

  // ── WHO IS SPEAKING vs WHAT IS CONFIRMED (issue #154, PR #156 review) ──
  //
  // Two different questions, and collapsing them into one list is what the
  // review of PR #156 caught.
  //
  // POST_DIAGNOSIS's markers ("stage 4", "diagnosed with", "biopsy report")
  // are DISEASE FACTS: equally true whether the speaker is the patient or a
  // relative. CAREGIVER's markers are the only ones that say WHO IS SPEAKING.
  // Because detect() returned on the first matching tier and POST_DIAGNOSIS
  // was checked first, every caregiver query that mentioned a clinical fact —
  // including "my father was diagnosed with breast cancer", the single most
  // natural caregiver opening — was answered with the patient contract.
  //
  // So: two sets, with deliberately opposite breadth.
  //
  //   FIRST_PERSON_SELF_REFERENCE — WHO. The speaker is talking about their
  //     own care. BROAD on purpose. It only decides which side of the
  //     patient/caregiver fork the message falls on, and the cost of a false
  //     positive is that a caregiver query keeps the routing it had before
  //     issue #154. What it buys is that a patient who mentions a relative in
  //     passing ("my wife wants to understand my treatment plan") is not
  //     handed the caregiver contract and addressed as somebody else's
  //     attendant. Membership of this set is never, on its own, a reason to
  //     claim the speaker has cancer.
  //
  //   FIRST_PERSON_DIAGNOSIS_OWNERSHIP — CONFIRMED. The speaker states a
  //     cancer diagnosis they already have. NARROW on purpose, because this
  //     is the set that unlocks the POST_DIAGNOSIS contract, and that
  //     contract opens by acknowledging the diagnosis and then enumerates
  //     treatment options. Possessing a *pending* biopsy, an oncology
  //     appointment, an operation or a lump is not a diagnosis: "My biopsy is
  //     scheduled tomorrow; what should I expect?" is a frightened
  //     undiagnosed person, and telling them they have cancer is the worst
  //     failure this classifier can produce. Anything short of stated disease
  //     falls through to the symptom/informational tiers, whose contracts
  //     explicitly forbid assuming a diagnosis.
  //
  // The sets are nested — every diagnosis claim is also self-reference — so
  // ownership is folded into the self check in detect() rather than repeated
  // here.

  // BROAD — answers "is the speaker talking about their own care?"
  private readonly FIRST_PERSON_SELF_REFERENCE: RegExp[] = [
    // Possessive directly on a clinical noun. Adjacency matters: "my mother's
    // biopsy report" does not match, because "my" is followed by the relation.
    /\bmy\s+(own\s+)?(biopsy|pathology|histopathology|scans?|mri|ct|pet|x-?ray|mammogram|colonoscopy|endoscopy|ultrasound|blood\s+tests?|tests?|reports?|results?|oncologist|surgeon|surgery|operation|treatments?|therapy|medicines?|medication|prescription|lumps?|symptoms?|tumou?rs?|cancer)\b/i,
    /\bI\s+(have|had|am\s+having|found|noticed|discovered)\s+(a\s+)?(lump|mass|growth|tumou?r)\b/i,
    // Hinglish
    /\bmer[ai]\s+(biopsy|report|rip[oa]rt|tests?|scan|ilaaj|treatment|operation|surgery|dawa|gaanth|cancer|kainsar)\b/i,
    /\bmujhe\s+(cancer|kainsar|tumou?r|gaanth)\b/i,
    // Devanagari — no `\b`, see the note on the relation patterns above.
    /मुझे\s*(कैंसर|कैन्सर|ट्यूमर|गाँठ|गांठ)/,
    /मेर[ाीे]\s*(कैंसर|कैन्सर|ट्यूमर|गाँठ|गांठ|इलाज|उपचार|कीमो(थेरेपी)?|रिपोर्ट|बायोप्सी|जाँच|जांच|सर्जरी|ऑपरेशन|दवा|टेस्ट|स्कैन)/,
  ];

  // NARROW — answers "has the speaker said they are already diagnosed?"
  private readonly FIRST_PERSON_DIAGNOSIS_OWNERSHIP: RegExp[] = [
    // Stated disease. A lump, mass or growth is NOT here: that is a symptom
    // under investigation, and it belongs to the SYMPTOMATIC tier.
    /\bI\s+(have|had|am\s+having)\s+(stage\s+[1-4IV]+|cancer|lymphoma|leukemia|carcinoma|melanoma|sarcoma|myeloma)\b/i,
    /\bI\s+(was|am|have\s+been)\s+diagnosed\b/i,
    /\b(my|I)\s+(own\s+)?(cancer|tumou?r)\s+(is|was|has)\b/i,
    // Care one only receives after a diagnosis. Bare "my biopsy", "my
    // oncologist", "my surgery" and "my appointment" are deliberately absent:
    // a person still awaiting a diagnosis has all of those too.
    /\bmy\s+(diagnosis|chemo(therapy)?|radiation|radiotherapy|mastectomy)\b/i,
    // A completed diagnostic report, as opposed to a scheduled procedure.
    /\bmy\s+(biopsy|pathology|histopathology)\s+(report|results?)\b/i,
    /\bmy\s+(er|pr|her2)\b/i,
    /\bI'?m\s+(a\s+)?(cancer\s+)?(patient|survivor)\b/i,
    // Hinglish. "meri report" is kept for parity with the long-standing
    // English `\bmy\s+report\b` POST_DIAGNOSIS pattern above — a report in
    // hand, not a procedure in the diary.
    /\bmujhe\s+(cancer|kainsar)\b/i,
    /\bmer[ai]\s+(cancer|kainsar|ilaaj|k[ei]mo(therapy)?|report)\b/i,
    // Devanagari — no `\b`, see the note on the relation patterns above.
    /मुझे\s*(कैंसर|कैन्सर)/,
    /मेर[ाीे]\s*(कैंसर|कैन्सर|इलाज|उपचार|कीमो(थेरेपी)?|रिपोर्ट)/,
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

    // 2. WHO IS SPEAKING, before WHAT IS WRONG (issue #154)
    //
    // Precedence is URGENT > first-person disease ownership > CAREGIVER >
    // POST_DIAGNOSIS > the rest. The previous order put POST_DIAGNOSIS second,
    // and because each tier returns on its first match, CAREGIVER was never
    // reached for any caregiver query that mentioned a clinical fact — a stage,
    // "diagnosed with", a biopsy report. Those markers describe the DISEASE and
    // are equally true of a relative's illness; only the relation words say who
    // is asking. Caregivers were therefore addressed as the patient and lost the
    // caregiver-only material: the action steps, the preparation checklist and
    // the support helplines.
    // Two distinct questions, deliberately answered by two sets of different
    // breadth (see their definitions above):
    //   speaksForSelf  — is this their own care they are asking about?
    //   ownsDiagnosis  — have they said they are already diagnosed?
    // The first gates CAREGIVER, the second gates POST_DIAGNOSIS. Using one
    // list for both either misroutes a patient who mentions a relative, or
    // tells an undiagnosed person they have cancer.
    const ownsDiagnosis = this.FIRST_PERSON_DIAGNOSIS_OWNERSHIP.some((p) => p.test(text));
    const speaksForSelf =
      ownsDiagnosis || this.FIRST_PERSON_SELF_REFERENCE.some((p) => p.test(text));
    const hasRelation = this.CAREGIVER_RELATION_PATTERNS.some((p) => p.test(text));

    // 3. CAREGIVER — a relation plus cancer context, unless the speaker is
    // talking about their own care ("my father had cancer and now I have
    // stage 2", or "my wife wants to understand my treatment plan", are both
    // the patient speaking, not a caregiver).
    //
    // The gate here is speaksForSelf, NOT ownsDiagnosis. A patient who has not
    // stated a diagnosis is still not a caregiver, and requiring proof of
    // disease to stay on the patient side would hand the caregiver contract —
    // action steps, hospital checklist, helplines for the attendant — to the
    // ill person themselves.
    if (hasRelation && !speaksForSelf) {
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

    // 4. POST_DIAGNOSIS — only for a stated diagnosis. Self-reference alone is
    // not enough: it says whose care this is, not that cancer was found.
    if (ownsDiagnosis) {
      matched.push("post_diagnosis:first_person_diagnosis_ownership");
    }
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

    // 5. SIDE_EFFECTS
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

    // 6. SYMPTOMATIC — need first-person + symptom keyword
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

    // 7. INFORMATIONAL — default fallback
    return { state: PatientState.INFORMATIONAL, confidence: "low", matchedPatterns: ["informational:default"] };
  }
}
