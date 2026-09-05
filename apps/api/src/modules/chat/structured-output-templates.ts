/**
 * Structured Output Templates — Phase 3
 *
 * Pre-defined output structures for common agentic scenarios.
 * Each template defines SECTIONS that the executor fills with
 * retrieval results + context. The LLM then generates natural
 * language within each section boundary.
 *
 * These templates are NOT string templates — they're structural
 * contracts that ensure consistent, complete, actionable output.
 *
 * Zero LLM cost: templates are deterministic structures.
 */

import { normalizeForMatch } from "../safety/text-normalizer";

// ─── Template Definitions ─────────────────────────────────────

export interface OutputSection {
  /** Section ID for referencing */
  id: string;
  /** Display heading (Markdown) */
  heading: string;
  /** Whether this section is required (executor must fill it) */
  required: boolean;
  /** Source: where the content comes from */
  source: "retrieval" | "template" | "llm" | "session" | "computed";
  /** Retrieval intent to use for this section (if source=retrieval) */
  retrievalIntent?: string;
  /** Static content (if source=template) */
  staticContent?: string;
  /** Maximum bullet points (for list sections) */
  maxItems?: number;
  /** Hindi heading equivalent */
  headingHi?: string;
}

export interface OutputTemplate {
  /** Template ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** When this template should be used (matched by planner) */
  triggerCategories: string[];
  /** Ordered sections to render */
  sections: OutputSection[];
  /** Closing text (always appended) */
  closingNote?: string;
  /** Hindi closing text */
  closingNoteHi?: string;
}

// ─── Hospital Visit Preparation ────────────────────────────────

export const HOSPITAL_VISIT_PREP: OutputTemplate = {
  id: "hospital_visit_prep",
  name: "Hospital Visit Preparation",
  triggerCategories: ["NAVIGATION"],
  sections: [
    {
      id: "documents_checklist",
      heading: "**Documents to Carry**",
      headingHi: "**ले जाने वाले कागज़ात**",
      required: true,
      source: "template",
      staticContent: [
        "- Aadhaar card / voter ID (photo ID proof)",
        "- Ayushman Bharat (PMJAY) card, if available",
        "- Previous medical reports, prescriptions, and X-rays/scans",
        "- Biopsy report (if available)",
        "- Blood test reports from last 3 months",
        "- Referral letter from district hospital (if applicable)",
        "- BPL certificate / income certificate (for scheme eligibility)",
        "- Passport-size photographs (2-3 copies)",
      ].join("\n"),
      maxItems: 10,
    },
    {
      id: "hospital_info",
      heading: "**Hospital / Treatment Centre Information**",
      headingHi: "**अस्पताल / उपचार केंद्र की जानकारी**",
      required: false,
      source: "retrieval",
      retrievalIntent: "navigation",
    },
    {
      id: "questions_for_doctor",
      heading: "**Questions to Ask Your Doctor**",
      headingHi: "**डॉक्टर से पूछने वाले सवाल**",
      required: true,
      source: "template",
      staticContent: [
        "- What is the exact diagnosis and stage?",
        "- What are the recommended treatment options?",
        "- What are the expected side effects?",
        "- How long will treatment take?",
        "- Is this hospital empanelled under Ayushman Bharat?",
        "- What will be the approximate cost?",
      ].join("\n"),
      maxItems: 8,
    },
    {
      id: "financial_support",
      heading: "**Financial Support Options**",
      headingHi: "**आर्थिक सहायता के विकल्प**",
      required: false,
      source: "retrieval",
      retrievalIntent: "schemes",
    },
    {
      id: "practical_tips",
      heading: "**Practical Tips**",
      headingHi: "**व्यावहारिक सुझाव**",
      required: true,
      source: "template",
      staticContent: [
        "- Arrive early for OPD registration (before 9 AM recommended)",
        "- Bring a family member or caregiver for support",
        "- Carry water, snacks, and any current medications",
        "- Keep original documents and one set of photocopies",
        "- Note the doctor's name and OPD room number",
      ].join("\n"),
    },
  ],
  closingNote:
    "This checklist is for preparation only. Your doctor will guide you on the actual treatment plan.",
  closingNoteHi:
    "यह चेकलिस्ट केवल तैयारी के लिए है। आपके डॉक्टर वास्तविक उपचार योजना के बारे में मार्गदर्शन करेंगे।",
};

// ─── Scheme Application Checklist ──────────────────────────────

export const SCHEME_APPLICATION_CHECKLIST: OutputTemplate = {
  id: "scheme_application",
  name: "Government Scheme Application Guide",
  triggerCategories: ["SCHEMES"],
  sections: [
    {
      id: "scheme_overview",
      heading: "**Scheme Overview**",
      headingHi: "**योजना का अवलोकन**",
      required: true,
      source: "retrieval",
      retrievalIntent: "schemes",
    },
    {
      id: "eligibility",
      heading: "**Eligibility Criteria**",
      headingHi: "**पात्रता मानदंड**",
      required: true,
      source: "retrieval",
      retrievalIntent: "schemes",
    },
    {
      id: "documents_needed",
      heading: "**Documents Required**",
      headingHi: "**आवश्यक दस्तावेज़**",
      required: true,
      source: "template",
      staticContent: [
        "- Aadhaar card (mandatory)",
        "- Ration card / BPL certificate",
        "- Income certificate (from tehsildar / SDM office)",
        "- Cancer diagnosis certificate from government hospital",
        "- Treatment estimate letter from empanelled hospital",
        "- Bank account details (for direct benefit transfer)",
        "- Passport-size photographs (4 copies)",
      ].join("\n"),
    },
    {
      id: "application_steps",
      heading: "**How to Apply (Step by Step)**",
      headingHi: "**आवेदन कैसे करें (कदम दर कदम)**",
      required: true,
      source: "template",
      staticContent: [
        "1. Visit your nearest Common Service Centre (CSC) or Ayushman Bharat kiosk",
        "2. Carry all required documents listed above",
        "3. The operator will check your eligibility on the portal",
        "4. If eligible, your e-card will be generated on the spot",
        "5. Take the e-card to any empanelled hospital for cashless treatment",
        "",
        "**Helpline:** Call 14555 (toll-free) for Ayushman Bharat queries",
      ].join("\n"),
    },
    {
      id: "additional_schemes",
      heading: "**Other Financial Support**",
      headingHi: "**अन्य आर्थिक सहायता**",
      required: false,
      source: "retrieval",
      retrievalIntent: "schemes",
    },
  ],
  closingNote:
    "Scheme details may vary by state. Contact your district hospital or CSC for the latest information.",
  closingNoteHi:
    "योजना का विवरण राज्य के अनुसार भिन्न हो सकता है। नवीनतम जानकारी के लिए अपने जिला अस्पताल या CSC से संपर्क करें।",
};

// ─── Chemotherapy Day Preparation ──────────────────────────────

export const CHEMO_DAY_PREP: OutputTemplate = {
  id: "chemo_day_prep",
  name: "Chemotherapy Day Preparation",
  triggerCategories: ["NAVIGATION", "EDUCATION"],
  sections: [
    {
      id: "before_chemo",
      heading: "**Before Your Chemo Session**",
      headingHi: "**कीमो सत्र से पहले**",
      required: true,
      source: "template",
      staticContent: [
        "- Eat a light meal 2-3 hours before (avoid heavy/oily food)",
        "- Stay well hydrated — drink water throughout the day",
        "- Wear comfortable, loose clothing with easy arm access",
        "- Bring your medications list and latest blood reports",
        "- Arrange for someone to drive you home afterwards",
      ].join("\n"),
    },
    {
      id: "what_to_bring",
      heading: "**What to Bring**",
      headingHi: "**क्या ले जाएं**",
      required: true,
      source: "template",
      staticContent: [
        "- All current medications in original packaging",
        "- Latest blood test results (CBC within last 48 hours)",
        "- Ayushman Bharat / insurance card",
        "- Water bottle and light snacks (crackers, fruits)",
        "- Warm shawl or blanket (chemo rooms can be cold)",
        "- Something to pass time (book, phone, earphones)",
        "- A caregiver or family member for support",
      ].join("\n"),
    },
    {
      id: "side_effects_info",
      heading: "**Common Side Effects to Expect**",
      headingHi: "**सामान्य दुष्प्रभाव**",
      required: false,
      source: "retrieval",
      retrievalIntent: "side_effects",
    },
    {
      id: "when_to_call",
      heading: "**When to Call Your Doctor Immediately**",
      headingHi: "**तुरंत डॉक्टर को कब कॉल करें**",
      required: true,
      source: "template",
      staticContent: [
        "- Fever above 100.4°F (38°C)",
        "- Uncontrolled vomiting or diarrhea for more than 24 hours",
        "- Signs of infection (redness, swelling, pus at IV site)",
        "- Severe mouth sores making it hard to eat or drink",
        "- Unusual bleeding or bruising",
        "- Difficulty breathing or chest pain",
        "",
        "**Emergency:** Call 108 (ambulance) or go to the nearest hospital emergency",
      ].join("\n"),
    },
    {
      id: "post_chemo_care",
      heading: "**After Your Session**",
      headingHi: "**सत्र के बाद**",
      required: true,
      source: "template",
      staticContent: [
        "- Rest for the first 24-48 hours",
        "- Drink 8-10 glasses of water daily to flush medications",
        "- Eat small, frequent meals even if appetite is low",
        "- Avoid crowded places for 7-10 days (infection risk)",
        "- Track your temperature daily — report fever immediately",
      ].join("\n"),
    },
  ],
  closingNote:
    "Every patient's experience is different. Follow your oncologist's specific instructions for your treatment plan.",
  closingNoteHi:
    "हर मरीज़ का अनुभव अलग होता है। अपने ऑन्कोलॉजिस्ट के विशिष्ट निर्देशों का पालन करें।",
};

// ─── Second Opinion Preparation ────────────────────────────────

export const SECOND_OPINION_PREP: OutputTemplate = {
  id: "second_opinion_prep",
  name: "Second Opinion Preparation",
  triggerCategories: ["NAVIGATION"],
  sections: [
    {
      id: "why_second_opinion",
      heading: "**Why a Second Opinion Helps**",
      headingHi: "**दूसरी राय क्यों लेनी चाहिए**",
      required: true,
      source: "template",
      staticContent:
        "Getting a second opinion is a normal and recommended step in cancer care. It can confirm your diagnosis, explore alternative treatment options, or provide peace of mind. Most doctors encourage second opinions.",
    },
    {
      id: "documents_to_collect",
      heading: "**Documents to Collect from Current Hospital**",
      headingHi: "**वर्तमान अस्पताल से लेने वाले दस्तावेज़**",
      required: true,
      source: "template",
      staticContent: [
        "- Complete medical records and case summary",
        "- All pathology / biopsy reports (ask for slides/blocks if possible)",
        "- Imaging studies: CT scan, MRI, PET scan (CD copies)",
        "- Blood test reports",
        "- Current treatment plan and medications list",
        "- Discharge summaries (if hospitalized)",
      ].join("\n"),
    },
    {
      id: "where_to_go",
      heading: "**Where to Seek a Second Opinion**",
      headingHi: "**दूसरी राय कहां लें**",
      required: false,
      source: "retrieval",
      retrievalIntent: "navigation",
    },
    {
      id: "questions_to_ask",
      heading: "**Questions to Ask the Second Doctor**",
      headingHi: "**दूसरे डॉक्टर से पूछने वाले सवाल**",
      required: true,
      source: "template",
      staticContent: [
        "- Do you agree with the diagnosis?",
        "- Would you recommend the same treatment plan?",
        "- Are there other treatment options available?",
        "- What is your experience treating this type of cancer?",
        "- What outcomes can I expect with treatment?",
        "- Is your hospital empanelled under Ayushman Bharat?",
      ].join("\n"),
    },
  ],
  closingNote:
    "Seeking a second opinion is your right as a patient. It does not mean you distrust your current doctor.",
  closingNoteHi:
    "दूसरी राय लेना आपका अधिकार है। इसका मतलब यह नहीं कि आप अपने वर्तमान डॉक्टर पर भरोसा नहीं करते।",
};

// ─── Psychosocial Support Guide ────────────────────────────────

export const PSYCHOSOCIAL_SUPPORT: OutputTemplate = {
  id: "psychosocial_support",
  name: "Emotional & Psychosocial Support",
  triggerCategories: ["PSYCHOSOCIAL"],
  sections: [
    {
      id: "acknowledgment",
      heading: "**Your Feelings Are Valid**",
      headingHi: "**आपकी भावनाएं मान्य हैं**",
      required: true,
      source: "template",
      staticContent:
        "Cancer affects not just the body but also the mind. Feeling anxious, scared, angry, or sad is completely normal. You are not alone in this journey, and seeking support is a sign of strength.",
    },
    {
      id: "helplines",
      heading: "**Support Helplines**",
      headingHi: "**सहायता हेल्पलाइन**",
      required: true,
      source: "template",
      staticContent: [
        "- **Vandrevala Foundation**: 9999666555 (24/7, mental health)",
        "- **iCall (TISS)**: 9152987821 (Mon-Sat, 8am-10pm)",
        "- **Indian Cancer Society**: 1800-22-1951 (toll-free)",
        "- **Muktaa Foundation**: 7887889882 (Mon-Sat, 9:30am-5:30pm)",
      ].join("\n"),
    },
    {
      id: "coping_strategies",
      heading: "**Coping Strategies**",
      headingHi: "**मुकाबला करने के तरीके**",
      required: false,
      source: "retrieval",
      retrievalIntent: "psychosocial",
    },
    {
      id: "support_groups",
      heading: "**Support Groups & Communities**",
      headingHi: "**सहायता समूह और समुदाय**",
      required: false,
      source: "retrieval",
      retrievalIntent: "psychosocial",
    },
    {
      id: "caregiver_support",
      heading: "**For Caregivers**",
      headingHi: "**देखभालकर्ताओं के लिए**",
      required: false,
      source: "template",
      staticContent:
        "Caregivers also need support. Take breaks when possible, accept help from others, and remember that your wellbeing matters too. Many of the helplines above also offer caregiver support.",
    },
  ],
  closingNote:
    "Professional counseling can make a significant difference. Ask your hospital about onco-psychology services.",
  closingNoteHi:
    "पेशेवर परामर्श से बहुत फर्क पड़ सकता है। अपने अस्पताल में ऑन्को-साइकोलॉजी सेवाओं के बारे में पूछें।",
};

// ─── Biopsy Report Next Steps ──────────────────────────────────

export const BIOPSY_NEXT_STEPS: OutputTemplate = {
  id: "biopsy_next_steps",
  name: "Biopsy Report - What's Next",
  triggerCategories: ["NAVIGATION", "EDUCATION"],
  sections: [
    {
      id: "understanding_report",
      heading: "**Understanding Your Biopsy Report**",
      headingHi: "**अपनी बायोप्सी रिपोर्ट को समझें**",
      required: true,
      source: "template",
      staticContent:
        "A biopsy report tells your doctor what type of cells were found and whether they are cancerous. Key terms to look for: 'malignant' (cancerous), 'benign' (non-cancerous), 'grade' (how abnormal cells look), and 'margins' (whether cancer extends to edges of removed tissue).",
    },
    {
      id: "immediate_steps",
      heading: "**Immediate Next Steps**",
      headingHi: "**तुरंत अगले कदम**",
      required: true,
      source: "template",
      staticContent: [
        "1. **Don't panic** — wait for your doctor to explain the full picture",
        "2. **Schedule a follow-up** with your oncologist within 1-2 weeks",
        "3. **Keep the original report safe** and make 2-3 photocopies",
        "4. **Ask for pathology slides/blocks** — you may need them for a second opinion",
        "5. **Write down your questions** before your next appointment",
      ].join("\n"),
    },
    {
      id: "additional_tests",
      heading: "**Tests Your Doctor May Order Next**",
      headingHi: "**डॉक्टर जो अगले टेस्ट करवा सकते हैं**",
      required: false,
      source: "retrieval",
      retrievalIntent: "education",
    },
    {
      id: "treatment_overview",
      heading: "**Possible Treatment Pathways**",
      headingHi: "**संभावित उपचार मार्ग**",
      required: false,
      source: "retrieval",
      retrievalIntent: "treatment",
    },
    {
      id: "questions_for_doctor",
      heading: "**Questions for Your Next Appointment**",
      headingHi: "**अगली मुलाकात के लिए सवाल**",
      required: true,
      source: "template",
      staticContent: [
        "- What type of cancer has been found?",
        "- What is the grade and stage?",
        "- Do I need additional tests (CT scan, PET scan, blood markers)?",
        "- What are the treatment options for my specific case?",
        "- How soon should treatment begin?",
        "- Should I consider a second opinion?",
      ].join("\n"),
    },
  ],
  closingNote:
    "A biopsy report is the starting point, not the final answer. Your oncologist will combine it with other tests to create a complete treatment plan.",
  closingNoteHi:
    "बायोप्सी रिपोर्ट शुरुआत है, अंतिम उत्तर नहीं। आपके ऑन्कोलॉजिस्ट इसे अन्य परीक्षणों के साथ मिलाकर पूरी उपचार योजना बनाएंगे।",
};

// ─── Template Registry ─────────────────────────────────────────

export const TEMPLATE_REGISTRY: Record<string, OutputTemplate> = {
  hospital_visit_prep: HOSPITAL_VISIT_PREP,
  scheme_application: SCHEME_APPLICATION_CHECKLIST,
  chemo_day_prep: CHEMO_DAY_PREP,
  second_opinion_prep: SECOND_OPINION_PREP,
  psychosocial_support: PSYCHOSOCIAL_SUPPORT,
  biopsy_next_steps: BIOPSY_NEXT_STEPS,
};

// ─── Template Selection Logic ──────────────────────────────────

/**
 * Select the best template based on agentic category + detected signals.
 * Returns null if no structured template matches (falls back to existing flow).
 */
/**
 * Select a structured output template for an agentic scenario, or null.
 *
 * ── ACTIVE BIOPSY CONTEXT (biopsy router boundary) ──
 * The biopsy template is used ONLY when biopsy/report context is *active*,
 * defined as exactly one of:
 *   1. the CURRENT user message references a biopsy/report — a keyword or phrase
 *      such as "biopsy report", "biopsy ho gayi", "बायोप्सी रिपोर्ट"; OR
 *   2. the CURRENT care thread is about a biopsy/report — surfaced by the caller
 *      as the `report_received` signal (e.g. the immediately prior turn).
 *
 * It is explicitly NOT active for:
 *   - a bare "what next?" / `next_steps` with no biopsy context; or
 *   - a vague, unrelated biopsy mention from earlier history. Recency / thread
 *     relevance is the CALLER's responsibility: the caller MUST NOT set
 *     `report_received` for a stale historical mention.
 *
 * Executable boundary: structured-output-templates.spec.ts →
 * "ACTIVE biopsy context — boundary definition".
 */
export function selectOutputTemplate(
  category: string,
  signals: string[],
  userText: string
): OutputTemplate | null {
  // NFC + invisible-char/whitespace normalization, then lowercase. Note: ASCII
  // terms keep \b boundaries; Devanagari terms must NOT use \b — JavaScript word
  // boundaries only recognize ASCII, so \b adjacent to Devanagari never matches.
  const lowerText = normalizeForMatch(userText).toLowerCase();

  // Biopsy-related queries — require explicit biopsy/report context.
  // "next_steps" alone is too broad (matches "what should I do" on symptom queries).
  const biopsyContext =
    /\b(biopsy|report|pathology|diagnosed|result)\b/i.test(lowerText) ||
    /(बायोप्सी|रिपोर्ट|पैथोलॉजी)/.test(lowerText);
  // Route to biopsy ONLY with real biopsy context — either:
  //  • report_received signal (the upstream sets this from the current message
  //    OR reliable *active* session context; it must NOT set it for a stale,
  //    unrelated historical biopsy mention), or
  //  • next_steps + an in-message biopsy keyword, or
  //  • an explicit "biopsy report/done" phrase in the message.
  // "next_steps" / "what next?" ALONE never routes here (too broad).
  if (
    signals.includes("report_received") ||
    (signals.includes("next_steps") && biopsyContext) ||
    /\bbiopsy\s+(report|result|says?|shows?|ho\s*gay[ai]|hui|done|complete[d]?)\b/i.test(lowerText) ||
    /बायोप्सी\s*(रिपोर्ट|रिज़ल्ट|रिजल्ट|आई|आ\s*गई|हो\s*गई)/.test(lowerText)
  ) {
    return BIOPSY_NEXT_STEPS;
  }

  // Chemo preparation
  const isChemo = /\b(chemo|chemotherapy)\b/i.test(lowerText) || /कीमो/.test(lowerText);
  const isPrep =
    /\b(prepare|preparation|ready|day|what to|kya|kaise)\b/i.test(lowerText) ||
    /तैयारी/.test(lowerText);
  if (isChemo && isPrep) {
    return CHEMO_DAY_PREP;
  }

  // Second opinion
  if (
    /\bsecond opinion\b/i.test(lowerText) ||
    /\bdusri\s*raay\b/i.test(lowerText) ||
    /दूसरी\s*राय/.test(lowerText)
  ) {
    return SECOND_OPINION_PREP;
  }

  // Scheme/financial queries
  if (
    category === "SCHEMES" ||
    signals.includes("budget_concern") ||
    /\b(ayushman|scheme|card|paisa)\b/i.test(lowerText) ||
    /(योजना|आयुष्मान|कार्ड|पैसा)/.test(lowerText)
  ) {
    return SCHEME_APPLICATION_CHECKLIST;
  }

  // Psychosocial
  if (
    category === "PSYCHOSOCIAL" ||
    signals.includes("emotional_distress")
  ) {
    return PSYCHOSOCIAL_SUPPORT;
  }

  // Hospital visit / navigation (generic)
  if (
    category === "NAVIGATION" &&
    (signals.includes("hospital_search") || signals.includes("location_mentioned"))
  ) {
    return HOSPITAL_VISIT_PREP;
  }

  return null; // No structured template — use existing LLM flow
}

/**
 * Render a filled template to Markdown string.
 * Takes the template + a map of section content (filled by executor).
 */
export function renderTemplate(
  template: OutputTemplate,
  filledSections: Map<string, string>,
  locale: string = "en"
): string {
  const isHindi = locale === "hi" || locale === "bh" || locale === "mai";
  const parts: string[] = [];

  for (const section of template.sections) {
    const content = filledSections.get(section.id);

    // Skip optional sections without content
    if (!section.required && (!content || content.trim() === "")) {
      continue;
    }

    // Use Hindi heading if available and locale is Hindi
    const heading = isHindi && section.headingHi ? section.headingHi : section.heading;
    parts.push(heading);

    if (content && content.trim()) {
      parts.push(content);
    } else if (section.staticContent) {
      parts.push(section.staticContent);
    } else if (section.required) {
      // Required section with no content — add placeholder
      parts.push("_Information not available for your specific case. Please ask your healthcare provider._");
    }

    parts.push(""); // Blank line between sections
  }

  // Add closing note
  if (template.closingNote) {
    const closing = isHindi && template.closingNoteHi ? template.closingNoteHi : template.closingNote;
    parts.push("---");
    parts.push(`_${closing}_`);
  }

  return parts.join("\n");
}
