/**
 * Response templates following Intent → Template Mapping Table
 * All templates follow warm-professional tone, structured format, and end with clear next steps
 */

export interface TemplateContext {
  isFirstMessage: boolean;
  userText: string;
  queryType?: string;
  evidenceQuality?: string;
  [key: string]: any;
}

export class ResponseTemplates {
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
   */
  static selectTemplate(intent: string, context: TemplateContext): string {
    const templateMap: Record<string, (ctx: TemplateContext) => string> = {
      GREETING_ONLY: context.isFirstMessage ? this.G1 : this.G2,
      SYMPTOMS_NON_URGENT: this.S1,
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
      SIDE_EFFECTS_GENERAL: this.T1,
      TREATMENT_OPTIONS_GENERAL: this.T2
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



