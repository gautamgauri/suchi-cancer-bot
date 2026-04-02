/**
 * Mode Detection System
 * Distinguishes between Explain Mode (information-first) and Navigate Mode (personal symptom support)
 */

export type InteractionMode = "explain" | "navigate";

export class ModeDetector {
  /**
   * Detect interaction mode based on user text patterns
   * @param userText User's message
   * @returns "explain" for general informational questions, "navigate" for personal symptom support
   */
  static detectMode(userText: string): InteractionMode {
    const text = userText.trim();
    const lowerText = text.toLowerCase();

    // PRIORITY CHECK: "Generally asking" signals override personal pronouns
    // User explicitly indicates educational/general intent, not personal symptoms
    const generallyAskingPatterns = [
      /\b(generally asking|asking generally|just asking|general question)\b/i,
      /\b(not personal|not for me|not about me|for awareness|educational|learning about)\b/i,
      /\b(information only|just curious|out of curiosity|in general)\b/i,
      /\bI('m| am) asking generally\b/i,
      /\bI('m| am) just (curious|asking|wondering)\b/i
    ];
    const hasGenerallyAskingSignal = generallyAskingPatterns.some(pattern => pattern.test(text));
    if (hasGenerallyAskingSignal) {
      return "explain"; // Override any personal pronouns
    }

    // Identify patterns - check these first to gate properly
    const identifyPatterns = [
      /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i
    ];

    // Check for identify patterns first - if found, gate by personal signals
    const hasIdentifyPattern = identifyPatterns.some(pattern => pattern.test(text));
    if (hasIdentifyPattern) {
      // If identify pattern + personal signal → NAVIGATE mode
      if (ModeDetector.hasPersonalDiagnosisSignal(text)) {
        return "navigate";
      }
      // If identify pattern + no personal signal → EXPLAIN mode
      return "explain";
    }

    // Explain Mode patterns - general informational questions
    // PRIORITY: Check these BEFORE navigate patterns so "tell me about X" is not
    // misclassified as personal due to the word "me"
    const explainPatterns = [
      // General question starters (includes "tell me about" which contains "me" but is informational)
      // Exclude "what should I" — that's a personal action query, not informational
      /\b(what are|what is|what do|how do|tell me about|explain|describe|list)\b(?!\s+(should|do)\s+I)/i,
      // General information requests
      /\b(common|typical|general|usually|often|typically)\b/i,
      // Educational intent
      /\b(information about|learn about|understand|know about)\b/i,
      // "How to identify" patterns - general informational questions about symptoms/signs
      /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i,
      // Hindi question patterns (क्या है = what is, कैसे = how, बताइए = tell me, जानकारी = information)
      /क्या है|क्या हैं|क्या होता|कैसे|किस तरह|बताइए|बताएं|जानकारी/,
    ];

    const hasGeneralQuestion = explainPatterns.some(pattern => pattern.test(text));

    // Informational framing patterns — these phrases use "me/my" but are NOT personal symptom reports
    // e.g., "tell me about symptoms", "can you explain to me", "give me information"
    const informationalFramingPatterns = [
      /\btell\s+me\s+(about|more|what)\b/i,
      /\bgive\s+me\s+(information|details|an?\s+overview)\b/i,
      /\bexplain\s+to\s+me\b/i,
      /\bhelp\s+me\s+(understand|learn|know)\b/i,
      /\bcan\s+you\s+tell\s+me\b/i,
      /\bwhat\s+can\s+you\s+tell\s+me\b/i,
      /\blet\s+me\s+know\b/i,
    ];
    const hasInformationalFraming = informationalFramingPatterns.some(pattern => pattern.test(text));

    // If we have clear informational framing (e.g., "tell me about symptoms of breast cancer"),
    // return explain mode immediately — do NOT let the bare "me" trigger navigate mode
    if (hasGeneralQuestion && hasInformationalFraming) {
      return "explain";
    }

    // Navigate Mode patterns - personal references
    // These indicate the user is talking about THEIR OWN situation
    const navigatePatterns = [
      // First-person symptom/experience statements (stronger than bare pronouns)
      /\b(I am|I'm|I have|I've been|I feel|I notice|I've noticed)\b/i,
      // Possessive medical references
      /\b(my|my own)\s+(symptom|symptoms|report|scan|test|diagnosis|treatment|condition|pain|ache)\b/i,
      // Direct personal statements
      /\b(I'm experiencing|I am experiencing|I have been experiencing)\b/i,
      // Personal questions about self
      /\b(should I|do I have|am I|is my|my doctor|my treatment|my symptoms)\b/i,
      // First-person pronouns with medical context — but NOT bare "me" alone
      // "I" and "my" are strong personal signals; "me" is only personal when NOT in informational framing
      /\bI\b(?!\s+(want to|would like to|need to)\s+(know|learn|understand))/,
      /\bmy\b(?!\s+(question|interest|curiosity))/i,
      // "me" only counts as personal when NOT preceded by informational verbs
      /(?<!\b(tell|give|explain to|help|show|let))\s+\bme\b/i,
      /\bmyself\b/i,
      // Hindi/Hinglish personal pronouns (मेरा=my, मुझे=me, मैं=I, हमारा=our, माय=my)
      /मेरा|मेरी|मुझे|मैं|हमारा|हमारी|हमें|माय/,
      // Hindi/Hinglish family references (मदर=mother, फादर=father, पत्नी=wife, बच्चा=child)
      /मदर|फादर|माँ|मम्मी|पापा|पिता|पत्नी|बच्चा|बेटा|बेटी|भाई|बहन/,
      // Hindi personal symptom framing (चल रहा है=is ongoing, हो रहा=is happening, हो गया=has happened)
      /चल रहा|हो रहा|हो गया|करवानी|करवाना|लगता है|बोला/,
    ];

    // Check for Navigate Mode patterns
    const hasPersonalReference = navigatePatterns.some(pattern => pattern.test(text));

    // If we have general question patterns, prefer Explain Mode even if some personal pronouns are present
    // The key insight: "tell me about symptoms of breast cancer" has "me" but is informational
    if (hasGeneralQuestion && !this.hasStrongPersonalSignal(text)) {
      return "explain";
    }

    // If we have personal references without general question framing, it's Navigate Mode
    if (hasPersonalReference) {
      return "navigate";
    }

    // Default: if text is short and unclear, check for medical keywords
    // If it has medical keywords but no personal reference, assume Explain Mode
    const hasMedicalKeywords = /\b(cancer|tumor|symptom|treatment|diagnosis|lymphoma|breast|lung|colon)\b/i.test(text)
      || /कैंसर|ट्यूमर|लक्षण|उपचार|निदान|स्तन|फेफड़/.test(text);
    if (hasMedicalKeywords && !hasPersonalReference) {
      return "explain";
    }

    // Default to Explain Mode for ambiguous cases (better to answer than to assume personal)
    return "explain";
  }

  /**
   * Check if text has STRONG personal signals — first-person symptom reports, not just bare pronouns.
   * "tell me about symptoms" → false (informational framing)
   * "I have a lump" → true (personal symptom report)
   * "I've been coughing blood" → true (personal symptom report)
   */
  private static hasStrongPersonalSignal(text: string): boolean {
    const strongSignals = [
      // First-person symptom/experience statements
      /\bI\s+(have|had|found|noticed|feel|felt|see|saw|got|developed|discovered)\s/i,
      /\bI'?ve?\s+(been|got|had|noticed|found)\s/i,
      /\bI\s+am\s+(having|feeling|experiencing|noticing)\b/i,
      /\bI'm\s+(having|feeling|experiencing|noticing|worried|scared)\b/i,
      // Possessive + medical term
      /\bmy\s+(symptom|symptoms|lump|pain|report|scan|test|diagnosis|treatment|doctor|oncologist)\b/i,
      // Hindi strong personal signals
      /मुझे\s+(दर्द|सूजन|खून|बुखार|थकान|गांठ)/,
      /मेरा\s+(रिपोर्ट|टेस्ट|इलाज|डॉक्टर)/,
    ];
    return strongSignals.some(pattern => pattern.test(text));
  }

  /**
   * Check if text contains personal references
   */
  static hasPersonalReference(text: string): boolean {
    const navigatePatterns = [
      /\b(I|my|me|myself)\b/i,
      /\b(I am|I'm|I have|I've been|I feel|I notice)\b/i,
      /\b(my|my own)\s+(symptom|symptoms|report|scan|test|diagnosis|treatment)\b/i,
      // Hindi/Hinglish personal pronouns
      /मेरा|मेरी|मुझे|मैं|हमारा|हमें|माय/,
      /मदर|फादर|माँ|मम्मी|पापा|पत्नी|बच्चा|बेटा|बेटी/,
    ];
    return navigatePatterns.some(pattern => pattern.test(text));
  }

  /**
   * Check if text contains personal diagnosis-style signals
   * Used to distinguish "how to identify X" (general) from "identify if I have X" (personal)
   * Patterns:
   * - First-person: I, I'm, me, my, mine
   * - Second-person direct: do I, can I, should I, am I
   * - Someone-specific: my mother, my father, my wife, my husband, my child, my friend, he has, she has
   * - Symptom framing: I have, I got, I feel, experiencing, suffering from
   */
  static hasPersonalDiagnosisSignal(text: string): boolean {
    const personalSignals = [
      // First-person pronouns
      /\b(i|i'm|im|me|my|mine)\b/i,
      // Second-person direct questions
      /\b(do i|can i|should i|am i)\b/i,
      // Someone-specific references
      /\b(my mother|my father|my wife|my husband|my child|my friend|he has|she has)\b/i,
      // Symptom framing
      /\b(i have|i got|i feel|experiencing|suffering from)\b/i,
      // Hindi personal pronouns and framing
      /मेरा|मेरी|मुझे|मैं|हमारा|हमें|माय/,
      // Hindi family references
      /मदर|फादर|माँ|मम्मी|पापा|पत्नी|बच्चा|बेटा|बेटी/,
    ];
    return personalSignals.some(pattern => pattern.test(text));
  }

  /**
   * Check if text is a general informational question
   */
  static isGeneralQuestion(text: string): boolean {
    const explainPatterns = [
      /\b(what are|what is|what do|how do|tell me about|explain|describe|list)\b/i,
      /\b(common|typical|general|usually|often|typically)\b/i,
      // "How to identify" patterns - general informational questions about symptoms/signs
      /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i,
      // Hindi question patterns
      /क्या है|क्या हैं|क्या होता|कैसे|किस तरह|बताइए|बताएं|जानकारी/,
    ];
    return explainPatterns.some(pattern => pattern.test(text));
  }
}



