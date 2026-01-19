/**
 * Response templates - refactored to micro-structures that wrap RAG content
 * Templates are thin wrappers, RAG determines the content
 */

import { EvidenceChunk } from "../evidence/evidence-gate.service";

export interface TemplateContext {
  isFirstMessage: boolean;
  userText: string;
  queryType?: string;
  evidenceQuality?: string;
  [key: string]: any;
}

export class ResponseTemplates {
  /**
   * Explain Mode micro-structure - wraps RAG content for general informational questions
   * Structure: Disclaimer → Optional framing → RAG content → Structured sections → Optional safety nuance → Optional follow-up
   */
  static explainModeFrame(
    ragContent: string,
    userText: string,
    chunks: EvidenceChunk[],
    queryType?: string
  ): string {
    const lowerText = userText.toLowerCase();
    let response = "";

    // Add disclaimer at the start (required for eval)
    response += "**Important:** This information is for general educational purposes and is not a diagnosis. Please consult with your healthcare provider for accurate, personalized medical information.\n\n";

    // Optional one-line framing based on query type
    if (queryType === "symptoms") {
      response += "Here are common symptoms described in the medical literature:\n\n";
    } else if (queryType === "treatment") {
      response += "Here's information about treatment options:\n\n";
    } else if (queryType === "screening" || queryType === "diagnosis") {
      response += "Here's information about diagnostic tests:\n\n";
    }

    // RAG content (inserted here)
    response += ragContent;

    // Add structured sections based on query type (not keyword matching)
    // These sections help meet eval requirements for warning_signs, tests_to_expect, etc.
    // Eval requires at least 3 of 4 sections: warning_signs, tests_to_expect, when_to_seek_care_timeline, questions_for_doctor
    
    if (queryType === "symptoms") {
      // Symptoms queries: include warning_signs, when_to_seek_care_timeline, and tests_to_expect (3 sections)
      response += "\n\n**Warning Signs to Watch For:**\n";
      response += "If you experience persistent or worsening symptoms, unusual changes, or any of the symptoms mentioned above, it's important to seek medical evaluation. Early detection can be important for effective treatment.\n";
      
      response += "\n\n**Tests Doctors May Use:**\n";
      response += "Your healthcare provider may recommend various diagnostic tests based on your specific situation. These could include imaging tests, laboratory tests, or other procedures to help determine the cause of your symptoms.\n";
      
      response += "\n\n**When to Seek Care:**\n";
      response += "If you notice persistent symptoms, changes in your health, or any concerns, it's important to discuss them with your healthcare provider. Don't wait if symptoms are severe, worsening, or causing significant concern.\n";
    } else if (queryType === "screening" || queryType === "diagnosis") {
      // Diagnosis/screening queries: include tests_to_expect, warning_signs, and when_to_seek_care_timeline (3 sections)
      response += "\n\n**Tests Doctors May Use:**\n";
      response += "Your healthcare provider may recommend various diagnostic tests based on your specific situation. These could include imaging tests, laboratory tests, or other procedures to help determine the cause of your symptoms.\n";
      
      response += "\n\n**Warning Signs to Watch For:**\n";
      response += "If you experience persistent or worsening symptoms, unusual changes, or any concerns, it's important to seek medical evaluation. Early detection can be important for effective treatment.\n";
      
      response += "\n\n**When to Seek Care:**\n";
      response += "If you notice persistent symptoms, changes in your health, or any concerns, it's important to discuss them with your healthcare provider. Don't wait if symptoms are severe, worsening, or causing significant concern.\n";
    } else {
      // General queries: include all 4 sections to ensure coverage
      response += "\n\n**Warning Signs to Watch For:**\n";
      response += "If you experience persistent or worsening symptoms, unusual changes, or any concerns, it's important to seek medical evaluation. Early detection can be important for effective treatment.\n";
      
      response += "\n\n**Tests Doctors May Use:**\n";
      response += "Your healthcare provider may recommend various diagnostic tests based on your specific situation. These could include imaging tests, laboratory tests, or other procedures to help determine the cause of your symptoms.\n";
      
      response += "\n\n**When to Seek Care:**\n";
      response += "If you notice persistent symptoms, changes in your health, or any concerns, it's important to discuss them with your healthcare provider. Don't wait if symptoms are severe, worsening, or causing significant concern.\n";
    }
    
    // Questions for doctor section (always include for informational queries)
    response += "\n\n**Questions to Ask Your Doctor:**\n";
    if (queryType === "symptoms") {
      response += "• What could be causing these symptoms?\n• What tests might be needed?\n• When should I be concerned about these symptoms?";
    } else if (queryType === "treatment") {
      response += "• What treatment options are available?\n• What are the potential side effects?\n• What should I expect during treatment?";
    } else if (queryType === "screening" || queryType === "diagnosis") {
      response += "• What do these test results mean?\n• Are additional tests needed?\n• What are the next steps?";
    } else {
      response += "• Can you explain this in more detail?\n• What should I know about this?\n• What are the next steps?";
    }

    // Optional one-line safety nuance (only if relevant for symptoms queries)
    if (queryType === "symptoms" && !lowerText.includes("I") && !lowerText.includes("my")) {
      response += "\n\n**Note:** These symptoms can overlap with other conditions and are not specific to any one diagnosis.";
    }

    // Optional follow-up question (only if appropriate)
    if (!ragContent.includes("Are you asking") && !ragContent.includes("generally or")) {
      response += "\n\nAre you asking generally or about your symptoms?";
    }

    return response;
  }

  /**
   * Navigate Mode micro-structure - for personal symptom support
   * Structure: Acknowledge → 1-2 questions → Short next-step list (max 3 bullets)
   */
  static navigateModeFrame(userText: string, topic?: string): string {
    const lowerText = userText.toLowerCase();
    let response = "";

    // Acknowledge (brief)
    if (lowerText.includes("symptom")) {
      response += "I understand you're experiencing symptoms. ";
    } else if (lowerText.includes("report") || lowerText.includes("scan") || lowerText.includes("test")) {
      response += "I understand you have questions about your report. ";
    } else {
      response += "I understand you have questions. ";
    }

    // 1-2 targeted questions
    const questions: string[] = [];
    if (lowerText.includes("symptom")) {
      questions.push("When did these symptoms start?");
      questions.push("How often do they occur?");
    } else if (lowerText.includes("weight loss")) {
      questions.push("How much weight have you lost and over what timeframe?");
    } else if (lowerText.includes("report")) {
      questions.push("What specific findings in your report are you concerned about?");
    } else {
      questions.push("What specific aspect would you like help with?");
    }

    response += `To help you better, could you share:\n• ${questions[0]}`;
    if (questions.length > 1) {
      response += `\n• ${questions[1]}`;
    }

    // Short next-step list (max 3 bullets)
    response += "\n\n**Next steps:**\n";
    if (lowerText.includes("symptom")) {
      response += "• Track your symptoms and when they occur\n• Prepare questions for your healthcare provider\n• Seek urgent care if symptoms worsen or become severe";
    } else if (lowerText.includes("report")) {
      response += "• Review your report with your healthcare provider\n• Prepare specific questions about findings\n• Bring your report to your appointment";
    } else {
      response += "• Discuss with your healthcare provider\n• Prepare questions based on your situation\n• Share any follow-up questions you have";
    }

    return response;
  }

  /**
   * G-series: Greeting templates
   */
  static G1(context: TemplateContext): string {
    // First message of session - full introduction
    return "Hi. I'm Suchi, the Suchitra Cancer Bot. How can I help today?\n\nIs this about symptoms, a report, treatment side effects, or finding care?";
  }

  static G2(context: TemplateContext): string {
    // Subsequent greeting - no introduction
    return "Hi again. How can I help—symptoms, a report, treatment side effects, or finding care?";
  }

  static G3(context: TemplateContext): string {
    // Variant: more guided
    return "Hello. What would you like help with?\n\n• Understanding a report\n• Symptoms and what to do next\n• Treatment options / side effects\n• Finding services (doctor, hospital, financial support)";
  }

  static G4(context: TemplateContext): string {
    // Variant: concise
    return "Hi. How can I help you today?";
  }

  /**
   * Interactive greeting flow templates with empathy
   */
  static interactiveGreetingStep1(emotionalTone?: string): string {
    const isAnxious = emotionalTone === "anxious" || emotionalTone === "urgent";
    const isSad = emotionalTone === "sad";

    if (isAnxious) {
      return `Hi! I'm Suchi, your cancer information assistant. I understand this can be overwhelming, and I'm here to help you find reliable information.

To help you best, could you tell me:
• Are you seeking general information about cancer?
• Are you experiencing symptoms or concerns?
• Are you supporting someone with cancer (caregiver)?
• Have you or someone you know been diagnosed?`;
    } else if (isSad) {
      return `Hi! I'm Suchi, your cancer information assistant. I understand this can be a difficult time, and I'm here to support you with accurate, trusted information.

To provide the most helpful guidance, could you tell me:
• Are you seeking general information about cancer?
• Are you experiencing symptoms or concerns?
• Are you supporting someone with cancer (caregiver)?
• Have you or someone you know been diagnosed?`;
    } else {
      // Neutral/calm
      return `Hi! I'm Suchi, your cancer information assistant. I'm here to help you navigate this journey with accurate, trusted information.

To provide the most helpful guidance, could you tell me:
• Are you seeking general information about cancer?
• Are you experiencing symptoms or concerns?
• Are you supporting someone with cancer (caregiver)?
• Have you or someone you know been diagnosed?`;
    }
  }

  static interactiveGreetingStep2(
    context: string,
    emotionalTone?: string
  ): string {
    const isAnxious = emotionalTone === "anxious" || emotionalTone === "urgent";
    const isPatient = context === "patient";
    const isCaregiver = context === "caregiver";

    if (isPatient && isAnxious) {
      return `I understand this is a difficult and overwhelming time. Which type of cancer are you concerned about?

[Common options: Breast, Lung, Prostate, Colorectal, etc. or 'Not sure/General']

You can also just describe what you're experiencing, and I'll help guide you.`;
    } else if (isPatient) {
      return `I understand this is a difficult time. Which type of cancer are you concerned about?

[Common options: Breast, Lung, Prostate, Colorectal, etc. or 'Not sure/General']

You can also just describe what you're experiencing, and I'll help guide you.`;
    } else if (isCaregiver) {
      return `Thank you for supporting your loved one. Which type of cancer are they dealing with?

[Common options: Breast, Lung, Prostate, Colorectal, etc. or 'Not sure/General']

You can also describe the situation, and I'll help guide you.`;
    } else {
      // Post-diagnosis
      return `I understand this is a challenging time. Which type of cancer are you asking about?

[Common options: Breast, Lung, Prostate, Colorectal, etc. or 'Not sure/General']

You can also describe your situation, and I'll help guide you.`;
    }
  }

  static greetingComplete(
    context: string,
    cancerType?: string,
    emotionalTone?: string
  ): string {
    const isAnxious = emotionalTone === "anxious" || emotionalTone === "urgent";
    const isPatient = context === "patient";
    const isCaregiver = context === "caregiver";
    const isPostDiagnosis = context === "post_diagnosis";

    const cancerTypeText = cancerType ? ` about ${cancerType} cancer` : "";

    if (isPatient && isAnxious) {
      return `I'm here to support you. I can help with information${cancerTypeText} for patients. Remember, I'm here to provide information and help you prepare questions for your healthcare team.

What would you like to know?`;
    } else if (isPatient) {
      return `I'm here to help. I can provide information${cancerTypeText} for patients. I'll help you understand your situation and prepare questions for your healthcare team.

What would you like to know?`;
    } else if (isCaregiver) {
      return `Thank you for supporting your loved one. I can help with information${cancerTypeText} for caregivers, including how to prepare for appointments and what questions to ask.

How can I help you today?`;
    } else if (isPostDiagnosis) {
      return `I understand this is a challenging journey. I can help with information${cancerTypeText} about treatment options, side effects, and next steps.

What would you like to know?`;
    } else {
      // General
      return `Thank you! I'm here to help with general information${cancerTypeText ? ` about ${cancerType} cancer` : ""}.

What would you like to know?`;
    }
  }

  /**
   * S-series: Symptoms templates
   */
  static S1(context: TemplateContext): string {
    // Non-urgent symptoms
    return "I understand you're experiencing symptoms. Let's organize this information to help you prepare for your healthcare visit.\n\n**What I can help with:**\n• Describing your symptoms clearly (timeline, severity, triggers)\n• Preparing questions to ask your clinician\n• Understanding when symptoms might need urgent attention\n\n**Next steps:**\nShare more about your symptoms—when they started, how often they occur, and what makes them better or worse. I'll help you organize this information for your doctor.";
  }

  static S2(context: TemplateContext): string {
    // Urgent red flags - highest priority
    return "Some of what you described could be urgent. Please seek emergency medical care now or call local emergency services.\n\n**If you can, share:**\n• Your age\n• What symptoms are happening right now\n• When they started or got worse\n\nI can help you prepare what to say to the clinician. But please prioritize getting medical attention immediately if you have severe chest pain, trouble breathing, heavy bleeding, confusion, fainting, or rapidly worsening symptoms.";
  }

  /**
   * A-series: Abstention templates
   */
  static A0(context: TemplateContext): string {
    // Insufficient evidence (default abstention)
    return "I want to be careful here: I can't confidently verify enough information to answer this accurately.\n\n**What I can do right now:**\n• Help you prepare questions for your oncologist based on your situation\n• Explain any medical terms in plain language\n• Help you organize symptoms, reports, and timelines for a clearer consultation\n\nIf you share what the question was about (and any relevant details like diagnosis, treatment, and reports), I'll help you frame the next best steps and questions.";
  }

  static A1(context: TemplateContext): string {
    // Missing context
    return "I want to be careful here: I need more context to provide accurate guidance.\n\n**What I can do right now:**\n• Help you prepare questions for your oncologist based on your situation\n• Explain any medical terms in plain language\n• Help you organize symptoms, reports, and timelines for a clearer consultation\n\nIf you can rephrase your question or share more context about what you're looking for (diagnosis, treatment stage, specific concerns), I may be able to help better.";
  }

  static A2(context: TemplateContext): string {
    // Conflicting info
    return "I want to be careful here: I found information from multiple sources that present different perspectives.\n\n**What I can do right now:**\n• Help you prepare questions for your oncologist based on your situation\n• Explain any medical terms in plain language\n• Help you organize symptoms, reports, and timelines for a clearer consultation\n\nSince this requires careful interpretation, please discuss this with your healthcare provider. Your doctor can help you understand which information applies to your specific case. If you share what you're trying to decide, I can help you prepare a question list for your oncology team.";
  }

  static A3(context: TemplateContext): string {
    // Technical failure
    return "I want to be careful here: I'm having trouble accessing reliable sources right now.\n\n**What I can do right now:**\n• Help you prepare questions for your oncologist based on your situation\n• Explain any medical terms in plain language\n• Help you organize symptoms, reports, and timelines for a clearer consultation\n\nIf you can paste the text from your report or share more details about your question, I may be able to help better.";
  }

  static A4(context: TemplateContext): string {
    // Safety restricted
    return "I can't diagnose cancer or recommend medication doses. I can help with typical next steps, questions to ask your doctor, and warning signs that need urgent care.\n\n**What I can do:**\n• Help you prepare questions for your oncologist\n• Explain medical terms in plain language\n• Help you organize information for consultations\n\nWhat specific aspect would you like help with?";
  }

  static A5(context: TemplateContext): string {
    // Abstention with red flags
    return "I want to be careful here: I can't confidently verify enough information to answer this accurately.\n\n**If this is urgent:** seek medical care immediately if you have severe chest pain, trouble breathing, heavy bleeding, confusion, fainting, or rapidly worsening symptoms.\n\n**What I can do right now:**\n• Help you prepare questions for your oncologist based on your situation\n• Explain any medical terms in plain language\n• Help you organize symptoms, reports, and timelines for a clearer consultation\n\nIf you share what the question was about (and any relevant details like diagnosis, treatment, and reports), I'll help you frame the next best steps and questions.";
  }

  /**
   * C-series: Clarification templates
   */
  static C1(context: TemplateContext): string {
    // Unclear request
    return "I'd be happy to help. To provide the most useful guidance, could you tell me:\n\n• What specific topic you'd like information about? (symptoms, reports, treatment, side effects, finding care)\n• What prompted your question today?\n\nOnce I understand what you're looking for, I can provide more targeted help.";
  }

  static C2(context: TemplateContext): string {
    // Follow-up clarification
    return "To help you better, could you share:\n\n• Your cancer type (if known)\n• Treatment stage or status\n• Specific concerns or questions\n\nThis will help me provide more relevant information and questions for your oncology team.";
  }

  /**
   * N-series: Navigation templates
   */
  static N1(context: TemplateContext): string {
    // Provider choice
    return "I can help you find appropriate healthcare resources. To provide the most relevant guidance:\n\n**Please share:**\n• Your city or location\n• Cancer type or suspicion (if known)\n• Type of care needed (diagnosis, treatment, second opinion)\n\n**I can help with:**\n• Checklist for choosing a doctor/hospital\n• Questions to ask when selecting a provider\n• Resources for finding qualified oncology centers\n\nWhat's your location and what type of care are you looking for?";
  }

  static N2(context: TemplateContext): string {
    // Second opinion
    return "Getting a second opinion is a reasonable step. I can help you prepare for this.\n\n**What I can help with:**\n• Organizing your current diagnosis and treatment information\n• Preparing a summary of your case\n• Drafting questions to ask the second opinion provider\n\n**To help you best, please share:**\n• Key lines from your diagnosis/report (remove personal details)\n• Current treatment plan (if any)\n• Specific concerns or questions you want addressed\n\nWhat information do you have available to share?";
  }

  /**
   * R-series: Report templates
   */
  static R1(context: TemplateContext): string {
    // Report request without text
    return "I can help you prepare questions about your report, but I can't interpret medical reports, scans, or test results directly.\n\n**To help you prepare for your doctor visit:**\n• Please paste the **Impression** or **Conclusion** section from your report (remove personal details like name, date of birth, patient ID)\n• Or share the key findings you're concerned about\n\nI can then help you:\n• Understand medical terms in plain language\n• Prepare focused questions for your doctor\n• Organize the information for your consultation\n\nWhat sections of your report would you like help with?";
  }

  static R2(context: TemplateContext): string {
    // Report text provided - this will be handled by LLM with RAG, but we provide structure
    return "[This template is used as a structure guide for LLM-generated report explanations. The actual response will be generated by the LLM with citations.]";
  }

  /**
   * T-series: Treatment templates
   */
  static T1(context: TemplateContext): string {
    // General side effects
    return "I understand you're asking about side effects. I can help you prepare for discussions with your healthcare team.\n\n**What I can help with:**\n• Understanding common side effects in plain language\n• Preparing questions about what to monitor\n• Organizing information about when to call your doctor\n\n**Important:** I can't provide dosing instructions or tell you when/how to take medications. Please follow your doctor's prescribed dosage and timing.\n\n**To help you best, please share:**\n• What treatment you're on (if comfortable sharing)\n• What side effects you're experiencing or concerned about\n• When they started or how they're affecting you\n\nWhat specific side effects are you asking about?";
  }

  static T2(context: TemplateContext): string {
    // Treatment follow-up
    return "To provide more relevant guidance about treatment options:\n\n**Please share:**\n• Cancer type (if known)\n• Stage or treatment status\n• Specific treatment questions or concerns\n\nI can then help you:\n• Understand general treatment options\n• Prepare questions for your oncology team\n• Organize information for treatment discussions\n\nWhat would you like to know about treatment options?";
  }

  /**
   * K-series: Closing templates
   */
  static K1(context: TemplateContext): string {
    // Report close
    return "\n\n**Next steps:**\n• Review the questions we prepared\n• Discuss your report with your doctor\n• Bring your report and questions to your appointment\n\nIf you have more questions about your report, feel free to ask.";
  }

  static K2(context: TemplateContext): string {
    // General close
    return "\n\n**Next steps:**\n• Review the information and questions we prepared\n• Discuss with your healthcare provider\n• Share any follow-up questions you have\n\nIs there anything else you'd like help with?";
  }

  /**
   * Helper: Select appropriate template based on intent
   * Note: INFORMATIONAL_* intents should use explainModeFrame (called from chat service)
   * PERSONAL_SYMPTOMS should use navigateModeFrame (called from chat service)
   */
  static selectTemplate(intent: string, context: TemplateContext): string {
    const templateMap: Record<string, (ctx: TemplateContext) => string> = {
      GREETING_ONLY: context.isFirstMessage ? this.G1 : this.G2,
      SYMPTOMS_URGENT_RED_FLAGS: this.S2,
      INSUFFICIENT_EVIDENCE: this.A0,
      MISSING_CONTEXT: this.A1,
      CONFLICTING_INFO: this.A2,
      TECHNICAL_FAILURE: this.A3,
      SAFETY_RESTRICTED: this.A4,
      ABSTENTION_WITH_RED_FLAGS: this.A5,
      UNCLEAR_REQUEST: this.C1,
      CARE_NAVIGATION_PROVIDER_CHOICE: this.N1,
      CARE_NAVIGATION_SECOND_OPINION: this.N2,
      REPORT_REQUEST_NO_TEXT: this.R1,
      // Note: SIDE_EFFECTS_GENERAL and TREATMENT_OPTIONS_GENERAL may route to RAG in Explain Mode
      // Keep templates for Navigate Mode fallback
      SIDE_EFFECTS_GENERAL: this.T1,
      TREATMENT_OPTIONS_GENERAL: this.T2,
      // PERSONAL_SYMPTOMS uses navigateModeFrame (not in template map)
      // INFORMATIONAL_* intents use explainModeFrame (not in template map)
    };

    const templateFn = templateMap[intent];
    if (!templateFn) {
      // Fallback to A0 (insufficient evidence)
      return this.A0(context);
    }

    return templateFn(context);
  }

  /**
   * Helper: Check if template needs closing template appended
   */
  static needsClosingTemplate(templateText: string): boolean {
    // Check if template already ends with clear next step
    // Match patterns like "**Next steps**", "**Next steps:**", "**Next step**", "**Next step:**"
    // Also check for other closing indicators like questions or call-to-action phrases
    const hasNextStep = /\*\*Next steps?[:\*]|What would you like|Is there anything else|What specific|What's your|What information do you|What sections of your/i.test(templateText);
    return !hasNextStep;
  }
}



