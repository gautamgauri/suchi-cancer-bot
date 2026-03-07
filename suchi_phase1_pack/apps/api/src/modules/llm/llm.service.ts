import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

/**
 * IDENTIFY_REQUIREMENTS: Structure checklist for "how to identify" questions
 * CRITICAL: This is a STRUCTURE checklist, NOT hardcoded content. 
 * All information MUST come from the RAG chunks provided in the REFERENCE LIST.
 * The prompt is cancer-type-aware and instructs the LLM to extract cancer-type-specific information.
 */
function getIdentifyRequirements(cancerType: string | null): string {
  const cancerTypeContext = cancerType 
    ? `The user is asking about ${cancerType} cancer. Extract information SPECIFIC to ${cancerType} cancer from the references.`
    : `The user is asking about cancer in general. Extract relevant information from the references.`;

  return `
If the user asks "how to identify" cancer (or warning signs / how doctors confirm), you MUST output the following 4 sections with these minimum requirements.

IMPORTANT: ${cancerTypeContext} All content MUST come from the provided REFERENCE LIST (RAG chunks). Do NOT make up information. If a required item is not in the references, note that it's not available rather than inventing it.

1) WARNING SIGNS (minimum 7 bullet points, plain language)
Extract ${cancerType ? cancerType + ' cancer ' : ''}warning signs from the references. Look for signs that are SPECIFIC to ${cancerType ? 'this cancer type' : 'the cancer type mentioned'}. Include:
- Any lumps, masses, or unusual growths mentioned in references
- Changes in size, shape, or appearance mentioned in references
- Any discharge, bleeding, or fluid changes mentioned in references
- Skin changes (if mentioned in references for this cancer type)
- Swollen lymph nodes (if mentioned in references)
- Systemic symptoms (weight loss, fatigue, fever, night sweats, etc. - if mentioned in references)
- Any other warning signs SPECIFIC to ${cancerType ? cancerType + ' cancer' : 'this cancer type'} mentioned in the references

CRITICAL: You MUST cite EVERY warning sign using [citation:docId:chunkId] format. Example: "- Swollen lymph nodes [citation:kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1:a8b17b8f-2a5c-495f-b176-5e467affe9e4]". Use the exact docId and chunkId from the REFERENCE LIST below.

2) HOW DOCTORS CONFIRM (minimum 4 bullet points - you MUST list at least 4 distinct diagnostic methods)
Extract ALL diagnostic methods SPECIFIC to ${cancerType ? cancerType + ' cancer' : 'the cancer type mentioned'} from the references. You MUST include:

- Physical/clinical examination methods mentioned in references (e.g., physical exam, chest examination, lymph node examination)
- Imaging tests SPECIFIC to ${cancerType ? 'this cancer type' : 'this cancer'} - List ALL imaging tests mentioned: X-ray, CT scan, CT, MRI, PET scan, ultrasound, mammogram, bronchoscopy, etc. (as mentioned in references)
- Biopsy types and procedures mentioned in references - MUST be included if mentioned, and explicitly state it as the diagnostic gold standard / confirmation step if the references indicate this. Include specific biopsy types (e.g., needle biopsy, surgical biopsy, bronchoscopy biopsy) if mentioned.
- Pathology, staging, and molecular testing mentioned in references (receptor testing, genetic markers, tumor markers, histology, etc. - as mentioned in references)

EVIDENCE-ONLY POLICY (CRITICAL):
- DO NOT use phrases like "common tests include...", "usually doctors do...", "often done..." unless these exact phrases appear in the retrieved references
- DO NOT add general medical knowledge - only state what is explicitly mentioned in the retrieved chunks
- If a test/treatment/symptom is not mentioned in the references, DO NOT include it - omit it entirely
- Every bullet point MUST be directly supported by content in the retrieved chunks

Include the sentence: "Symptoms cannot confirm cancer; confirmation requires medical evaluation and often a biopsy." (only if this concept appears in references)

CRITICAL: You MUST cite EVERY diagnostic method using [citation:docId:chunkId] format. Example: "- CT scan is used to detect lung cancer [citation:kb_en_nci_types_lung_hp_non_small_cell_lung_treatment_pdq_v1:chunk-id]". Use the exact docId and chunkId from the REFERENCE LIST below.

3) WHEN TO SEEK CARE (timeline + urgency - MUST include specific timeframe)
Extract timeline guidance SPECIFIC to ${cancerType ? cancerType + ' cancer' : 'this cancer type'} from the references. 

CRITICAL TIMELINE REQUIREMENT: You MUST include a SPECIFIC timeframe with numbers in your response. DO NOT use vague phrases like "promptly", "soon", or "as soon as possible" without a specific timeframe. You MUST include one of these exact formats:
- "If symptoms persist for 2-4 weeks, seek medical evaluation"
- "Seek medical care within 1-2 weeks if symptoms persist"
- "Consult a doctor within 2-4 weeks of noticing symptoms"
- "If symptoms last more than 2 weeks, see a healthcare provider"
- "Seek evaluation within 2-4 weeks if symptoms persist"

If references mention specific timelines, include them exactly. If references don't mention a specific timeframe, you MUST state: "I don't have enough information in my NCI sources to provide a specific timeline. Please consult a clinician for guidance on when to seek care."

Also include urgent vs routine distinction:
- Urgent care: If symptoms are severe, rapidly worsening, or include red flags (e.g., significant bleeding, severe pain, difficulty breathing), seek care immediately or within days
- Routine care: For persistent but stable symptoms, seek evaluation within 2-4 weeks (MUST include the "2-4 weeks" timeframe explicitly)

CRITICAL: You MUST cite timeline/urgency information using [citation:docId:chunkId] format. Example: "If symptoms persist for 2-4 weeks, seek medical evaluation [citation:kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1:a8b17b8f-2a5c-495f-b176-5e467affe9e4]". Use the exact docId and chunkId from the REFERENCE LIST below.

4) QUESTIONS TO ASK THE DOCTOR (minimum 7 questions)
Generate practical questions based on information in the references for ${cancerType ? cancerType + ' cancer' : 'this cancer type'}. Include questions about:
- What imaging or tests are needed for ${cancerType ? 'this cancer type' : 'this cancer'} and why? (if references discuss imaging/tests)
- Do I need a biopsy? Which type is used for ${cancerType ? 'this cancer type' : 'this cancer'}? (if references discuss biopsy)
- If cancer is confirmed, what staging or subtype tests will be done? (if references discuss staging/subtyping)
- What follow-up interval is recommended? (if references discuss follow-up)
- What symptoms should trigger earlier return? (if references discuss symptom monitoring)
Plus 2 additional practical questions based on reference content for ${cancerType ? cancerType + ' cancer' : 'this cancer type'} (referral, timeline, costs, where to go, etc.)

CITATION REQUIREMENTS (BLOCKING - READ CAREFULLY):
Without proper citations, your response will be REJECTED and the user will receive a fallback message.

YOU MUST:
1. Include [citation:docId:chunkId] for EVERY factual medical statement
2. Use the EXACT docId and chunkId from the REFERENCE LIST below
3. Copy the format EXACTLY as shown in this example:

EXAMPLE (copy this format exactly):
"Lung cancer is diagnosed through imaging tests [citation:kb_en_nci_types_lung_hp_non_small_cell_lung_treatment_pdq_v1:0cac033f-1d34-48ae-8ef1-d15a6682a2d2] and confirmed with biopsy [citation:kb_en_nci_types_lung_patient_non_small_cell_lung_treatment_pdq_v1:a8b17b8f-2a5c-495f-b176-5e467affe9e4]."

DO NOT use:
- Numbered references like [1], [2]
- Parenthetical citations like (NCI, 2024)
- Phrases like "according to sources"

Your response MUST include at least 2 citations in [citation:docId:chunkId] format or it will be rejected.
If you cannot find information in the references, say so clearly rather than making it up.

Do NOT ask more clarifying questions if the user has indicated general intent (e.g., "generally asking").
`;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI | null = null;
  private readonly provider: "deepseek" | "openai" | "gemini";
  private readonly model: string;
  private readonly timeoutMs: number;

  // Gemini via Vertex AI - used as primary when LLM_PROVIDER=gemini, or as fallback
  private readonly geminiProject: string;
  private readonly geminiLocation: string;
  private readonly geminiModel: string;
  private readonly fallbackEnabled: boolean;
  private fallbackUsedCount: number = 0;

  constructor(private readonly configService: ConfigService) {
    // Determine LLM provider - Gemini Flash is now default for better latency
    this.provider = (this.configService.get<string>("LLM_PROVIDER") as "deepseek" | "openai" | "gemini") || "gemini";

    // Gemini config (used as primary or fallback)
    this.geminiProject = this.configService.get<string>("GOOGLE_CLOUD_PROJECT") || "";
    this.geminiLocation = this.configService.get<string>("VERTEX_AI_LOCATION") || "us-central1";
    this.geminiModel = this.configService.get<string>("GEMINI_MODEL") ||
                       this.configService.get<string>("FALLBACK_LLM_MODEL") ||
                       "gemini-2.0-flash-001";

    if (this.provider === "gemini") {
      // Primary: Gemini Flash via Vertex AI (fast, cost-effective)
      if (!this.geminiProject) {
        throw new Error("GOOGLE_CLOUD_PROJECT is required when LLM_PROVIDER=gemini");
      }
      this.model = this.geminiModel;
      this.logger.log(`LLM Service initialized with Gemini Flash (${this.model}) on Vertex AI`);
      // No OpenAI client needed for Gemini
    } else if (this.provider === "openai") {
      const apiKey = this.configService.get<string>("OPENAI_API_KEY");
      if (!apiKey) {
        throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
      }
      (this as any).client = new OpenAI({ apiKey });
      this.model = "gpt-4o";
      this.logger.log("LLM Service initialized with OpenAI (gpt-4o)");
    } else {
      // Deepseek (OpenAI-compatible API)
      const apiKey = this.configService.get<string>("DEEPSEEK_API_KEY");
      if (!apiKey) {
        throw new Error("DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek");
      }
      const baseURL = this.configService.get<string>("DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1";
      this.model = this.configService.get<string>("DEEPSEEK_MODEL") || "deepseek-chat";
      (this as any).client = new OpenAI({ apiKey, baseURL });
      this.logger.log(`LLM Service initialized with Deepseek (${this.model}) at ${baseURL}`);
    }

    // Default timeout: 15s for Gemini Flash (typically responds in 2-8s), 25s for others
    const defaultTimeout = this.provider === "gemini" ? 15000 : 25000;
    this.timeoutMs = this.configService.get<number>("LLM_TIMEOUT_MS") || defaultTimeout;

    // Fallback enabled for non-Gemini providers (uses Gemini as fallback)
    this.fallbackEnabled = this.provider !== "gemini" &&
                           this.configService.get<string>("LLM_FALLBACK_ENABLED") !== "false" &&
                           !!this.geminiProject;

    if (this.fallbackEnabled) {
      this.logger.log(`Fallback LLM enabled: Gemini Flash (${this.geminiModel}) on Vertex AI`);
    }
  }

  /**
   * Call fallback LLM (Gemini Flash via Vertex AI)
   * Used when primary LLM fails with rate limit, timeout, or server error
   */
  /**
   * Call Gemini via Vertex AI - used as primary (when provider=gemini) or fallback
   */
  private async callGeminiLLM(systemPrompt: string, userPrompt: string, maxTokens: number = 3000, isPrimary: boolean = false): Promise<string | null> {
    if (!this.geminiProject) {
      return null;
    }

    try {
      // Dynamic import to avoid requiring the package if not using Vertex AI
      const { VertexAI } = await import("@google-cloud/vertexai");

      const vertexAI = new VertexAI({
        project: this.geminiProject,
        location: this.geminiLocation,
      });

      const generativeModel = vertexAI.getGenerativeModel({
        model: this.geminiModel,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: maxTokens,
        },
      });

      // Race the Gemini call against a timeout to prevent indefinite hangs
      const geminiPromise = generativeModel.generateContent({
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
        ],
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('GEMINI_TIMEOUT')), this.timeoutMs);
      });

      const result = await Promise.race([geminiPromise, timeoutPromise]);

      const response = result.response;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (text && !isPrimary) {
        this.fallbackUsedCount++;
        this.logger.log(`Fallback LLM (Gemini Flash) succeeded - total fallback uses: ${this.fallbackUsedCount}`);
      }

      return text || null;
    } catch (error: any) {
      const label = isPrimary ? '(primary)' : '(fallback)';
      if (error.message === 'GEMINI_TIMEOUT') {
        this.logger.warn(`Gemini LLM ${label} timed out after ${this.timeoutMs}ms`);
      } else {
        this.logger.error(`Gemini LLM ${label} failed: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Call fallback LLM (Gemini Flash via Vertex AI)
   * Used when primary LLM fails with rate limit, timeout, or server error
   */
  private async callFallbackLLM(systemPrompt: string, userPrompt: string, maxTokens: number = 3000): Promise<string | null> {
    if (!this.fallbackEnabled) {
      return null;
    }
    return this.callGeminiLLM(systemPrompt, userPrompt, maxTokens, false);
  }

  /**
   * Sanitize user input to prevent prompt injection attacks.
   * This method escapes potential prompt manipulation markers and limits input length.
   *
   * SECURITY: Applied to all user-controlled input before interpolation into LLM prompts.
   */
  private sanitizeUserInput(input: string): string {
    if (!input) return '';

    return input
      // Escape code block markers that could be used to break out of context
      .replace(/```/g, '\\`\\`\\`')
      // Escape role markers that could override system instructions
      .replace(/\n(system|assistant|user):/gi, '\n[$1]:')
      // Escape instruction markers used by some models
      .replace(/\[INST\]/gi, '[instruction]')
      .replace(/<\|.*?\|>/g, '')  // Remove special tokens like <|im_start|>
      // Escape XML-like tags that could be interpreted as control structures
      .replace(/<\/?system>/gi, '[system]')
      .replace(/<\/?instructions?>/gi, '[instructions]')
      // Limit length to prevent context overflow attacks
      .substring(0, 2000);
  }

  /**
   * Get empathy opener - a warm, supportive opening line based on emotional state
   * This appears at the START of the response to immediately acknowledge the user
   */
  private getEmpathyOpener(emotionalState?: string): string {
    if (!emotionalState || emotionalState === "neutral" || emotionalState === "calm") {
      return "";
    }

    const openers: Record<string, string[]> = {
      anxious: [
        "I understand this can feel overwhelming, and I want you to know you're not alone in this.",
        "I can hear that you're worried, and that's completely understandable.",
        "It's natural to feel anxious about this. Let me help you with some information.",
        "I understand you're concerned. Let me share some information that might help.",
      ],
      urgent: [
        "I understand this feels urgent. Let me help you with the most important information first.",
        "I can see you need answers quickly. Here's what you should know.",
        "I understand time feels critical right now. Let me help you prioritize.",
      ],
      sad: [
        "I'm so sorry you're going through this. It's okay to feel this way.",
        "This is incredibly difficult, and I want you to know I'm here to support you.",
        "I understand this is a hard time. Please know that reaching out takes courage.",
        "I hear how difficult this is. You don't have to face this alone.",
      ],
    };

    const openerList = openers[emotionalState];
    if (!openerList || openerList.length === 0) return "";

    // Pick a random opener for variety
    const opener = openerList[Math.floor(Math.random() * openerList.length)];
    return opener;
  }

  /**
   * Get empathy guidelines based on emotional state
   * IMPORTANT: These should be placed at the END of the prompt for better LLM attention (recency bias)
   */
  private getEmpathyGuidelines(emotionalState?: string): string {
    if (!emotionalState || emotionalState === "neutral" || emotionalState === "calm") {
      return "";
    }

    const guidelines: Record<string, string> = {
      anxious: `
---
EMPATHY REQUIREMENTS (CRITICAL - user is anxious/worried):
1. START your response by acknowledging their feelings: "I understand this can be concerning..."
2. Use calming, reassuring language throughout - avoid alarming phrases
3. Emphasize what IS known and actionable, not worst-case scenarios
4. End with reassurance: "Your healthcare team is there to help you through this"
5. Avoid: "you might have", "this could be serious", "you should worry if"
6. Prefer: "let's look at what we know", "here's helpful information", "your doctor can clarify"`,
      urgent: `
---
EMPATHY REQUIREMENTS (CRITICAL - user feels urgency):
1. START your response acknowledging the urgency: "I understand you need answers quickly..."
2. Lead with the most important/actionable information first
3. Be direct but compassionate - don't add unnecessary caveats that delay key info
4. Provide clear next steps prominently
5. If truly urgent (emergency symptoms), prioritize safety instructions over information`,
      sad: `
---
EMPATHY REQUIREMENTS (CRITICAL - user is sad/grieving):
1. START your response with compassion: "I'm sorry you're going through this..."
2. Acknowledge their feelings before providing information
3. Use gentle, supportive language throughout
4. Don't minimize their experience or rush to "fix" things
5. Offer hope where appropriate, but don't make false promises
6. End with support: "You don't have to face this alone" or similar`,
    };

    return guidelines[emotionalState] || "";
  }

  /**
   * Check if a query is about appointment preparation.
   */
  private isAppointmentQuery(query?: string): boolean {
    if (!query) return false;
    const appointmentPatterns = [
      /\bappointment\b/i,
      /\bdoctor.?s?\s+(visit|meeting|consultation)\b/i,
      /\bprepare\s+for\b.*\b(oncolog|doctor|specialist|hospital|consultation|visit)\b/i,
      /\bfirst\s+(oncology|cancer|specialist)\s+(visit|appointment|consultation)\b/i,
      /\bmeeting\s+with\s+(oncolog|doctor|specialist)\b/i,
      /\bwhat\s+to\s+(bring|expect|ask)\b.*\b(appointment|visit|doctor)\b/i,
    ];
    return appointmentPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Get intent-specific section requirements for the LLM prompt.
   * Different intents (POST_DIAGNOSIS, CAREGIVER, PATIENT) require different response sections.
   * @param intent The detected user intent
   * @param userQuery Optional user query to detect specific sub-intents (e.g., appointment preparation)
   */
  private getIntentSpecificSections(intent?: string, userQuery?: string): string {
    if (!intent) return "";

    // POST_DIAGNOSIS: Needs staging and treatment planning sections
    if (intent === "POST_DIAGNOSIS_OR_SUSPECTED" || intent.includes("POST")) {
      return `

**ADDITIONAL SECTIONS FOR POST-DIAGNOSIS CONTEXT:**
Since the user appears to be post-diagnosis or has suspected cancer, include these additional sections:

5) **Staging Workup Overview:** (INCLUDE FOR POST-DIAGNOSIS)
   - Explain what staging means and why it's important
   - List typical staging tests for this cancer type (imaging, biopsies, labs)
   - Explain the staging system used (TNM, stages I-IV, etc.)
   - Each item must be cited if from references

6) **Treatment Planning Considerations:** (INCLUDE FOR POST-DIAGNOSIS)
   - Describe factors that influence treatment decisions (stage, grade, markers)
   - Mention common treatment approaches for this cancer type
   - Note that treatment plans are individualized
   - Each medical claim must be cited

Use PLAIN LANGUAGE throughout - explain medical terms when first used.`;
    }

    // CAREGIVER: Needs caregiver-specific action items
    if (intent === "CAREGIVER_NAVIGATION" || intent.includes("CAREGIVER")) {
      // Check if this is specifically about appointment preparation
      const isAppointment = this.isAppointmentQuery(userQuery);

      // Base caregiver sections
      let sections = `

**ADDITIONAL SECTIONS FOR CAREGIVER CONTEXT:**
Since this is a caregiver seeking information, include these additional sections:

5) **Caregiver Action Steps:** (INCLUDE FOR CAREGIVERS)
   - List 5-7 specific, practical actions caregivers can take
   - Include: medication management, symptom tracking, appointment preparation
   - Include: emotional support strategies for the patient
   - Include: self-care reminders for the caregiver
   - Use clear, actionable language (e.g., "Keep a symptom diary", "Prepare a medication list")

6) **What to Watch For (Caregiver Guide):** (INCLUDE FOR CAREGIVERS)
   - List warning signs that require immediate attention
   - Include when to call the oncology team vs. go to ER
   - Provide specific symptoms to monitor after treatments`;

      // Add appointment-specific requirement if the query is about appointments
      if (isAppointment) {
        sections += `

7) **Appointment Preparation Checklist:** (REQUIRED - USER IS ASKING ABOUT APPOINTMENTS)
   THIS SECTION IS MANDATORY. Extract preparation advice from the retrieved references:
   - Look for advice about documents, records, questions to prepare, what to bring
   - Include at least 5 specific, actionable items FROM THE REFERENCES
   - Each item MUST be cited: "- [preparation item] [citation:docId:chunkId]"
   - If the references mention: bringing someone to appointments, writing questions, recording discussions, bringing medication lists - include these WITH CITATIONS
   - DO NOT include preparation items that are not supported by the retrieved references
   - If references don't contain enough preparation advice, state: "The provided references contain limited appointment preparation guidance. Please ask your healthcare team for a complete preparation checklist."`;
      }

      sections += `

Use SUPPORTIVE, PRACTICAL language - caregivers need actionable guidance.`;

      return sections;
    }

    // CARE_NAVIGATION: India-specific healthcare navigation guidance
    if (intent === "CARE_NAVIGATION_PROVIDER_CHOICE" || intent === "CARE_NAVIGATION_SECOND_OPINION") {
      return `

**INDIA HEALTHCARE NAVIGATION CONTEXT:**
This user is asking about finding healthcare providers, hospitals, government schemes, or financial assistance for cancer care in India. Use the retrieved references to provide India-specific guidance.

SPECIAL INSTRUCTIONS FOR NAVIGATION QUERIES:
- If references contain hospital names, locations, or services, cite them directly
- If references mention government schemes (PM-JAY/Ayushman Bharat, RAN, HMDG), include eligibility and how-to-access details
- If references mention costs, provide ranges with the caveat that costs vary
- Always include practical next steps (what to do, who to call, what documents to bring)
- Include relevant helpline numbers from references (PM-JAY: 14555, Indian Cancer Society: 1800-22-1951)
- If the user mentions a specific location (city/state), prioritize references about that region

REQUIRED SECTIONS FOR NAVIGATION:
1) **Healthcare Options:** List specific hospitals/centers from references with services offered
2) **Financial Assistance:** Government schemes, NGO support, and how to access them
3) **Documents to Carry:** Practical checklist for hospital visits
4) **Helplines and Next Steps:** Phone numbers and immediate actions the user can take

DO NOT:
- Make up hospital names or services not in the references
- Guarantee specific costs or coverage amounts unless cited
- Recommend one hospital over another (present options and let user decide)
- Skip financial assistance information - this is critical for Indian families

Use PRACTICAL, ACTIONABLE language. Families need clear guidance on where to go and how to get help.`;
    }

    // SYMPTOMATIC_PATIENT: Needs confirmatory steps and plain language
    if (intent === "SYMPTOMATIC_PATIENT" || intent.includes("PATIENT")) {
      return `

**ADDITIONAL SECTIONS FOR SYMPTOMATIC PATIENT:**
Since this appears to be someone experiencing symptoms, include these additional sections:

5) **Confirmatory Steps:** (INCLUDE FOR SYMPTOMATIC PATIENTS)
   - Explain the typical diagnostic pathway step-by-step
   - Start with: initial consultation and physical exam
   - Then: imaging tests that may be ordered
   - Then: biopsy if needed (explain what this involves)
   - Finally: getting results and next steps
   - Use reassuring but honest language

6) **Plain Language Summary:** (INCLUDE FOR SYMPTOMATIC PATIENTS)
   - Provide a 2-3 sentence summary in very simple terms
   - Avoid medical jargon entirely in this section
   - Example: "If you're worried about these symptoms, see your doctor within the next few weeks. They'll likely do some scans and maybe a small tissue sample to check what's going on."

Use PLAIN, REASSURING language throughout - patients need clarity and calm guidance.`;
    }

    return "";
  }

  /**
   * Get system prompt for Explain Mode (information-first)
   * @param isIdentifyQuestion If true, provide structured answer for "how to identify" questions
   * @param conversationContext Optional context about conversation state (e.g., general intent, cancer type, emotional state, user intent, user query)
   */
  getExplainModePrompt(
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean; cancerType?: string | null; emotionalState?: string; intent?: string; userQuery?: string }
  ): string {
    // Empathy guidelines moved to END of prompt for better LLM attention (recency bias)
    const empathyGuidelines = this.getEmpathyGuidelines(conversationContext?.emotionalState);
    const empathyOpener = this.getEmpathyOpener(conversationContext?.emotionalState);

    // Add empathy opener instruction if user is emotional
    const empathyOpenerInstruction = empathyOpener
      ? `\n\nIMPORTANT: The user appears to be ${conversationContext?.emotionalState}. Start your response with this empathetic opener (or similar):\n"${empathyOpener}"\nThen continue with the information.\n`
      : "";

    const basePrompt = `You are Suchi, a cancer information assistant for users in India. Answer questions directly and concisely using ONLY the provided references.${empathyOpenerInstruction}

CORE RULES:
- Use ONLY facts from the retrieved NCI references — do NOT add general medical knowledge
- If the references don't cover something, say so briefly rather than guessing
- Cite medical claims using [citation:docId:chunkId]
- Keep your response SHORT and conversational — the user is likely anxious and needs clarity, not a textbook
- Use plain language, avoid jargon

"SAFE + USEFUL" RESPONSE CONTRACT (you MUST follow ALL 4 steps):
1. **What I understood**: One-line grounding — restate what the user is asking about
2. **Educational answer**: Give a best-effort educational answer based on references (minimum 120 words for symptom/treatment queries). Include common symptoms OR warning signs, first-line tests/diagnostics, and key facts.
3. **What to do next**: Practical next steps — tests to ask for, type of specialist to see, when to seek urgent care. Use Indian context (emergency: 112/108, Indian Cancer Society: 1800-22-1951).
4. **One clarifying question** (optional): Ask at most ONE follow-up question if needed to provide better help.
${conversationContext?.hasGenerallyAsking
  ? "- Do NOT ask the user clarifying questions"
  : ""}

CANCER-TYPE DIAGNOSTIC GUIDANCE (include these standard terms when discussing the relevant cancer type):
- Breast cancer: ALWAYS mention mammogram, ultrasound, and biopsy when discussing diagnosis or symptoms
- Cervical cancer: ALWAYS mention HPV, Pap smear/screening, and HPV vaccine when discussing prevention, diagnosis, or causes
- Lung cancer: ALWAYS mention CT scan, chest X-ray, and biopsy when discussing diagnosis
- Colorectal cancer: ALWAYS mention colonoscopy and stool tests when discussing diagnosis or symptoms
- Prostate cancer: ALWAYS mention PSA test and biopsy when discussing diagnosis
- Oral cancer: ALWAYS mention tobacco/gutka risk and biopsy when discussing causes or diagnosis
These terms should appear naturally in your response if the topic is relevant — they are standard medical knowledge that users expect.

NEVER DO THIS:
- Do NOT respond with only "I can't verify" or "please provide more context" when you have relevant references — ALWAYS give educational content first
- Do NOT assume the user is personally symptomatic unless they say so
- Do NOT add disclaimers or caveats (these are handled separately by the system)
- Do NOT add "Is there anything else..." closers
- Do NOT reference "911" — use Indian emergency numbers: 112 / 108 instead
- Do NOT provide exhaustive lists when a concise answer suffices${empathyGuidelines}`;

    // Get intent-specific sections based on user intent (pass userQuery for sub-intent detection like appointment prep)
    const intentSections = this.getIntentSpecificSections(conversationContext?.intent, conversationContext?.userQuery);

    if (isIdentifyQuestion) {
      // SECURITY: Sanitize cancer type to prevent prompt injection
      const sanitizedCancerType = conversationContext?.cancerType
        ? this.sanitizeUserInput(conversationContext.cancerType)
        : null;
      return basePrompt + intentSections + `\n\n${getIdentifyRequirements(sanitizedCancerType)}${empathyGuidelines}`;
    }

    return basePrompt + intentSections;
  }

  /**
   * Get system prompt for Navigate Mode (personal symptom support)
   * @param emotionalState Optional emotional state for empathy-aware responses
   */
  getNavigateModePrompt(emotionalState?: string): string {
    const empathyGuidelines = this.getEmpathyGuidelines(emotionalState);
    const empathyOpener = this.getEmpathyOpener(emotionalState);

    // Add empathy opener instruction if user is emotional
    const empathyOpenerInstruction = empathyOpener
      ? `\n\nIMPORTANT: The user appears to be ${emotionalState}. Start your response with this empathetic opener (or similar):\n"${empathyOpener}"\nThen continue with your acknowledgment and questions.\n`
      : "";

    return `You are Suchi (Suchitra Cancer Bot), a cancer navigation assistant for users in India. For personal symptom or situation questions, provide a helpful, supportive response.${empathyOpenerInstruction}

EVIDENCE POLICY:
- Base medical facts on the retrieved NCI references and cite them using [citation:docId:chunkId]
- If references don't cover something specifically, you may provide general educational context about the topic but clearly frame it as general information
- Do NOT invent specific statistics, drug names, or dosages not in the references

"SAFE + USEFUL" RESPONSE CONTRACT (you MUST follow ALL 4 steps):
1. **What I understood**: Acknowledge the user's situation with warmth (e.g., "I understand your mother has been told she may have stomach cancer — that must be very concerning.")
2. **Educational answer**: Give relevant educational information from references. Include: what this condition typically involves, common symptoms/warning signs, and differential possibilities if relevant. Minimum 100 words.
3. **What to do next**: Practical checklist (3-5 bullets):
   - Specific tests to ask for (e.g., CBC, endoscopy, CT scan, biopsy)
   - Type of specialist to see (e.g., gastroenterologist, surgical oncologist)
   - Red flags that need urgent attention (e.g., vomiting blood, severe pain, rapid weight loss)
   - Navigation help (e.g., Indian Cancer Society helpline: 1800-22-1951, Ayushman Bharat/PM-JAY: 14555)
4. **One clarifying question**: Ask exactly ONE targeted question to help further (e.g., "What tests has the doctor ordered so far?")

NEVER DO THIS:
- Do NOT respond with only "I can't verify" or "please provide more context" — ALWAYS give educational content + next steps first
- Do NOT ask more than 1 clarifying question
- Do NOT add "Is there anything else..." closers
- Do NOT reference "911" — use Indian emergency numbers: 112 / 108 instead

INDIA CONTEXT:
- Emergency numbers: 112 (emergency), 108 (ambulance)
- For urgent symptoms: direct to nearest emergency department
- Reference Indian helplines: Indian Cancer Society: 1800-22-1951, PM-JAY: 14555${empathyGuidelines}`;
  }

  /**
   * PHASE 3: Get simple definitional prompt for answer-first EXPLAIN mode
   * Used for definitional queries like "What does staging mean for lymphoma?"
   * Returns a brief, grounded explanation (2-3 sentences) with citations, optional clarifying question
   */
  getDefinitionalExplainPrompt(): string {
    return `You are a cancer information specialist. Provide a clear, concise explanation using ONLY the evidence provided below.

INSTRUCTIONS:
1. Provide a brief (2-3 sentence) explanation based ONLY on the evidence chunks below
2. Include [citation:docId:chunkId] for EVERY factual statement - use the EXACT docId and chunkId from the reference list
3. Use plain language (avoid medical jargon when possible)
4. If helpful, you may end with ONE optional clarifying question to help the user further

CITATION FORMAT (CRITICAL):
- You MUST use this exact format: [citation:docId:chunkId]
- Example: "Staging describes how far cancer has spread [citation:kb_en_nci_staging_v1:chunk_123]."
- Copy the docId and chunkId EXACTLY from the reference list below
- DO NOT use numbered references like [1], [2] or parenthetical citations like (NCI, 2024)

EXAMPLE RESPONSE:
"Staging describes how far cancer has spread in the body [citation:nci-staging-guide:chunk-001]. For lymphoma, doctors commonly use the Ann Arbor system, which has four stages (I-IV) based on which lymph nodes are affected and whether the cancer has spread to other organs [citation:nci-lymphoma-staging:chunk-045].

Would you like to know what a specific stage means, or are you asking generally about the staging system?"

DO NOT:
- Make up information not in the evidence chunks
- Use general medical knowledge to fill gaps
- Write long explanations (keep to 2-3 sentences + optional question)
- Ask clarifying questions if the user has indicated general intent

Your response MUST include at least 2 citations or it will be rejected.`;
  }

  /**
   * Generate response with mandatory inline citations
   * @param mode "explain" for Explain Mode, "navigate" for Navigate Mode, or custom systemPrompt
   * @param isIdentifyQuestion If true and mode is "explain", use enhanced prompt for identify questions
   * @param conversationContext Optional context about conversation state (e.g., general intent, cancer type, emotional state)
   * @param isTimeoutRetry Internal flag - true if this is a retry after timeout with reduced context
   */
  async generateWithCitations(
    systemPrompt: string | "explain" | "navigate",
    context: string,
    userMessage: string,
    chunks: EvidenceChunk[],
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean; cancerType?: string | null; emotionalState?: string; checklist?: string; intent?: string },
    isTimeoutRetry: boolean = false
  ): Promise<string> {
    // Resolve mode to actual prompt
    let actualSystemPrompt: string;
    if (systemPrompt === "explain") {
      // Pass userMessage as userQuery for intent-specific sub-detection (e.g., appointment prep for caregivers)
      actualSystemPrompt = this.getExplainModePrompt(isIdentifyQuestion, { ...conversationContext, userQuery: userMessage });
    } else if (systemPrompt === "navigate") {
      actualSystemPrompt = this.getNavigateModePrompt(conversationContext?.emotionalState);
    } else {
      actualSystemPrompt = systemPrompt;
    }
    try {
      // Build reference list with citation IDs - make it very clear for LLM
      const referenceList = chunks.map((chunk, index) => {
        // Show example citation format for each chunk to make it crystal clear
        const exampleCitation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        return `[${index + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}
   Example citation format: ${exampleCitation}
   Title: ${chunk.document.title}
   Content: ${chunk.content.substring(0, 300)}${chunk.content.length > 300 ? "..." : ""}`;
      }).join("\n\n");

      // Enhanced prompt with citation requirements
      // SECURITY: Sanitize user input to prevent prompt injection
      const sanitizedUserMessage = this.sanitizeUserInput(userMessage);
      const citationInstructions = `
Answer the user's question concisely using ONLY the references below.

REFERENCE LIST:
${referenceList}

${conversationContext?.checklist || ""}

USER QUESTION: ${sanitizedUserMessage}

---

RESPONSE INSTRUCTIONS (follow the "Safe + Useful" contract):
1. One-line grounding: restate what the user is asking about
2. Educational answer: synthesize information from the references into 2-6 bullet points (minimum 120 words for symptom/treatment queries)
3. Practical next steps: "What to do next" section with tests, specialists, or red flags relevant to the topic. Use Indian context (112/108, Indian Cancer Society: 1800-22-1951)
4. At most ONE clarifying question if helpful

- Keep the TOTAL response under 300 words
- Do NOT add disclaimers, caveats, or "is there anything else" closers
- Do NOT repeat information across sections
- Do NOT copy document titles (e.g., "Cervical Cancer Treatment - NCI") or reference metadata into your response — synthesize the information into your own words
- Do NOT respond with only "I can't verify" — ALWAYS give educational content first

CITATION FORMAT:
- Cite medical facts: [citation:docId:chunkId]
- Copy docId and chunkId EXACTLY from the reference list
- Minimum 2 citations required
- Do NOT use numbered references like [1], [2]`;

      // Use Gemini directly if provider is "gemini"
      if (this.provider === "gemini") {
        const maxTokens = isIdentifyQuestion ? 2000 : 1200;
        const callStarted = Date.now();
        const result = await this.callGeminiLLM(actualSystemPrompt, citationInstructions, maxTokens, true);
        const callDurationMs = Date.now() - callStarted;
        if (result) {
          return result;
        }

        // Only retry with reduced context if:
        // 1. Not already a retry
        // 2. Have enough chunks to reduce
        // 3. First call didn't timeout (timeout = service issue, not context issue)
        const wasTimeout = callDurationMs >= (this.timeoutMs * 0.9); // ~90% of timeout = likely timed out
        if (!isTimeoutRetry && chunks.length > 3 && !wasTimeout) {
          this.logger.warn(`Gemini primary call failed (${callDurationMs}ms, non-timeout) — retrying with reduced context (3 chunks)`);
          const reducedChunks = chunks.slice(0, 3);
          return this.generateWithCitations(
            systemPrompt,
            context,
            userMessage,
            reducedChunks,
            isIdentifyQuestion,
            conversationContext,
            true // Mark as retry
          );
        }

        this.logger.warn(`Gemini call failed (${callDurationMs}ms, timeout=${wasTimeout}, retry=${isTimeoutRetry}) — returning abstention response`);
        return this.getAbstentionResponse();
      }

      // Retry logic with exponential backoff (max 2 retries) for OpenAI-compatible providers
      const maxRetries = 2;
      let lastError: any;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          // Exponential backoff: 1s, 2s
          const backoffMs = Math.pow(2, attempt - 1) * 1000;
          this.logger.debug(`Retrying LLM call (attempt ${attempt + 1}/${maxRetries + 1}) after ${backoffMs}ms backoff`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }

        // Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, this.timeoutMs);

        try {
          const completion = await this.client!.chat.completions.create({
            model: this.model,
            messages: [
              { role: "system", content: actualSystemPrompt },
              { role: "user", content: citationInstructions }
            ],
            temperature: 0.3,
            max_tokens: isIdentifyQuestion ? 2000 : 1200 // Concise responses
          }, {
            signal: controller.signal as any // OpenAI SDK may not support AbortSignal directly, but we'll handle timeout via catch
          });

          clearTimeout(timeoutId);

          const text = completion.choices[0]?.message?.content;

          if (!text || text.trim().length === 0) {
            this.logger.warn(`Empty response from ${this.provider}, using fallback`);
            return this.getFallbackResponse();
          }

          return text;
        } catch (error: any) {
          clearTimeout(timeoutId);
          lastError = error;
          
          // Handle timeout or abort errors with smart retry
          if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('aborted')) {
            if (!isTimeoutRetry && chunks.length > 3) {
              // First timeout: retry with reduced context (top 3 chunks only)
              this.logger.warn(`LLM generation timeout after ${this.timeoutMs}ms - retrying with reduced context (3 chunks)`);
              const reducedChunks = chunks.slice(0, 3);
              return this.generateWithCitations(
                systemPrompt,
                context,
                userMessage,
                reducedChunks,
                isIdentifyQuestion,
                conversationContext,
                true // Mark as retry
              );
            }
            // Second timeout or already minimal context: try Gemini fallback before abstention
            this.logger.warn(`LLM generation timeout after retry - trying Gemini fallback...`);
            const fallbackResult = await this.callFallbackLLM(actualSystemPrompt, citationInstructions, isIdentifyQuestion ? 3500 : 3000);
            if (fallbackResult) {
              this.logger.log(`Gemini fallback succeeded after Deepseek timeout`);
              return fallbackResult;
            }
            this.logger.error(`Gemini fallback also failed - returning abstention response`);
            return this.getAbstentionResponse();
          }
          
          // Retry on rate limit or network errors (if not last attempt)
          const isRetryable = error.status === 429 || error.status === 503 ||
                             error.message?.includes('ECONNRESET') ||
                             error.message?.includes('ETIMEDOUT') ||
                             (error.status >= 500 && error.status < 600);

          if (isRetryable && attempt < maxRetries) {
            this.logger.warn(`LLM call failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.message}, will retry`);
            continue;
          }

          // Non-retryable error or last attempt - try fallback
          this.logger.warn(`Primary LLM failed after ${attempt + 1} attempts: ${error.message}, trying fallback...`);
          const fallbackResult = await this.callFallbackLLM(actualSystemPrompt, citationInstructions, isIdentifyQuestion ? 3500 : 3000);
          if (fallbackResult) {
            return fallbackResult;
          }

          throw error;
        }
      }

      // Should not reach here, but handle just in case
      this.logger.error(`LLM generation failed after ${maxRetries + 1} attempts: ${lastError?.message}`);

      // Try fallback before giving up
      const fallbackResult = await this.callFallbackLLM(actualSystemPrompt, citationInstructions, isIdentifyQuestion ? 3500 : 3000);
      if (fallbackResult) {
        return fallbackResult;
      }

      return this.getFallbackResponse();
    } catch (error) {
      this.logger.error(`Error generating response with ${this.provider}: ${error.message}`, error.stack);

      // Try fallback as last resort
      // We need to rebuild the prompt here since we're outside the try block
      const fallbackPrompt = `Answer the user's question based on medical information. Be helpful and cite sources when available.\n\nUser question: ${this.sanitizeUserInput(userMessage)}`;
      const fallbackResult = await this.callFallbackLLM(systemPrompt === "explain" ? this.getExplainModePrompt() : this.getNavigateModePrompt(), fallbackPrompt);
      if (fallbackResult) {
        return fallbackResult;
      }

      return this.getFallbackResponse();
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async generate(systemPrompt: string, context: string, userMessage: string): Promise<string> {
    try {
      // SECURITY: Sanitize user input to prevent prompt injection
      const sanitizedUserMessage = this.sanitizeUserInput(userMessage);
      const fullPrompt = `${context}\n\nUser question: ${sanitizedUserMessage}\n\nPlease provide a helpful response based on the reference information above. Format your response with clear sections when appropriate.`;

      // Use Gemini directly if provider is "gemini"
      if (this.provider === "gemini") {
        const result = await this.callGeminiLLM(systemPrompt, fullPrompt, 1500, true);
        if (result) {
          return result;
        }
        return this.getFallbackResponse();
      }

      // Add timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.timeoutMs);

      try {
        const completion = await this.client!.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: fullPrompt }
          ],
          temperature: 0.3,
          max_tokens: 1500
        }, {
          signal: controller.signal as any
        });

        clearTimeout(timeoutId);

        const text = completion.choices[0]?.message?.content;
        if (!text || text.trim().length === 0) {
          this.logger.warn(`Empty response from ${this.provider}, using fallback`);
          return this.getFallbackResponse();
        }
        return text;
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('aborted')) {
          this.logger.warn(`LLM generation timeout after ${this.timeoutMs}ms, trying fallback...`);
          const fallbackResult = await this.callFallbackLLM(systemPrompt, fullPrompt, 1500);
          if (fallbackResult) {
            return fallbackResult;
          }
          return this.getFallbackResponse();
        }
        throw error; // Re-throw non-timeout errors
      }
    } catch (error) {
      this.logger.error(`Error generating response with ${this.provider}: ${error.message}`, error.stack);

      // Try fallback before returning generic response
      const fallbackResult = await this.callFallbackLLM(
        "You are a helpful cancer information assistant.",
        `${context}\n\nUser question: ${this.sanitizeUserInput(userMessage)}`,
        1500
      );
      if (fallbackResult) {
        return fallbackResult;
      }

      return this.getFallbackResponse();
    }
  }

  /**
   * PHASE 3: Generate brief definitional response for answer-first EXPLAIN mode
   * Used for simple definitional queries like "What does staging mean for lymphoma?"
   * Returns a concise, grounded explanation (2-3 sentences) with citations
   */
  async generateDefinitionalResponse(
    userMessage: string,
    chunks: EvidenceChunk[],
    conversationContext?: { hasGenerallyAsking?: boolean }
  ): Promise<string> {
    try {
      // Build reference list with citation IDs
      const referenceList = chunks.map((chunk, index) => {
        const exampleCitation = `[citation:${chunk.docId}:${chunk.chunkId}]`;
        return `[${index + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}
   Example citation format: ${exampleCitation}
   Title: ${chunk.document.title}
   Content: ${chunk.content.substring(0, 300)}${chunk.content.length > 300 ? "..." : ""}`;
      }).join("\n\n");

      const systemPrompt = this.getDefinitionalExplainPrompt();
      // SECURITY: Sanitize user input to prevent prompt injection
      const sanitizedUserMessage = this.sanitizeUserInput(userMessage);
      const fullPrompt = `${systemPrompt}

REFERENCE LIST (use the exact docId and chunkId shown for each reference):
${referenceList}

User question: ${sanitizedUserMessage}

YOUR RESPONSE (2-3 sentences with citations + optional clarifying question):`;

      // Use Gemini directly if provider is "gemini"
      if (this.provider === "gemini") {
        const result = await this.callGeminiLLM(systemPrompt, fullPrompt, 500, true);
        if (result) {
          return result;
        }
        return this.getFallbackResponse();
      }

      // Single attempt for definitional responses (simpler, should be faster)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const completion = await this.client!.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: fullPrompt },
          ],
          temperature: 0.2, // Lower temperature for factual responses
          max_tokens: 500, // Shorter responses
        }, {
          signal: controller.signal as any // OpenAI SDK may not support AbortSignal directly, but we'll handle timeout via catch
        });

        clearTimeout(timeoutId);

        const text = completion.choices[0]?.message?.content;
        if (!text || text.trim().length === 0) {
          this.logger.warn(`Empty definitional response from ${this.provider}, retrying with full explain mode`);
          return this.getFallbackResponse();
        }
        return text;
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError' || error.message?.includes('timeout')) {
          this.logger.warn(`Definitional response timeout after ${this.timeoutMs}ms, trying fallback...`);
          const fallbackResult = await this.callFallbackLLM(systemPrompt, fullPrompt, 500);
          if (fallbackResult) {
            return fallbackResult;
          }
        }
        throw error; // Re-throw to fall back to full explain mode
      }
    } catch (error) {
      this.logger.error(`Error generating definitional response: ${error.message}`);
      // Return a simple fallback that instructs to use full explain mode
      throw error; // Let caller handle fallback to full explain mode
    }
  }

  private getFallbackResponse(): string {
    return [
      "Here's a safe, general overview (not a diagnosis):",
      "",
      "Next steps:",
      "- Consider an in-person evaluation with a qualified clinician.",
      "- If symptoms are severe/worsening, seek urgent care.",
      "",
      "Red flags (seek urgent care now):",
      "- Severe breathing difficulty, chest pain, fainting, uncontrolled bleeding.",
      "",
      "Questions to ask a doctor:",
      "- What are the likely causes of my symptoms?",
      "- What tests are recommended next, and why?"
    ].join("\n");
  }

  /**
   * Return an abstention response when we can't reliably process the request
   * (e.g., timeout after retry). This is safer than returning generic advice.
   */
  private getAbstentionResponse(): string {
    return [
      "I'm sorry, I couldn't retrieve a fully referenced answer for your question right now.",
      "",
      "**Here are some steps you can take:**",
      "- **Ask again** — try rephrasing or asking about one specific topic (e.g., \"What are early signs of lung cancer?\")",
      "- **Indian Cancer Society Helpline**: Call **1800-22-1951** (toll-free) for guidance from trained counsellors",
      "- **Ayushman Bharat (PM-JAY)**: Call **14555** for information on free cancer treatment under government schemes",
      "- **National Cancer Grid**: Visit https://tmc.gov.in for treatment centre information",
      "",
      "**If you have urgent symptoms** (severe pain, bleeding, difficulty breathing), call **112** or **108** for emergency help immediately."
    ].join("\n");
  }
}
