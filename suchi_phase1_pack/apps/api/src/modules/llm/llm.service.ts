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
  private readonly openai: OpenAI;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required");
    }
    this.openai = new OpenAI({ apiKey });
    // Default timeout: 15s, configurable via LLM_TIMEOUT_MS env var
    // Increased from 10s to handle complex queries better
    this.timeoutMs = this.configService.get<number>("LLM_TIMEOUT_MS") || 15000;
  }

  /**
   * Get empathy guidelines based on emotional state
   */
  private getEmpathyGuidelines(emotionalState?: string): string {
    if (!emotionalState || emotionalState === "neutral" || emotionalState === "calm") {
      return "";
    }

    const guidelines: Record<string, string> = {
      anxious: `EMPATHY GUIDELINES (for anxious user):
- Acknowledge their concern: "I understand this can be overwhelming/concerning"
- Provide reassurance: "I'm here to help you find reliable information"
- Use calming language: avoid alarmist phrasing
- Be supportive while maintaining evidence-only policy
- Balance empathy with accuracy`,
      urgent: `EMPATHY GUIDELINES (for urgent user):
- Acknowledge urgency: "I understand this is urgent"
- Prioritize actionable information
- Provide clear next steps
- Maintain calm, supportive tone
- Balance empathy with evidence-only policy`,
      sad: `EMPATHY GUIDELINES (for sad user):
- Use supportive language: "I understand this is a difficult time"
- Acknowledge difficulty: "I'm here to support you"
- Provide hope without false promises
- Be compassionate while maintaining evidence-only policy
- Balance empathy with accuracy`,
    };

    return `\n\n${guidelines[emotionalState] || ""}`;
  }

  /**
   * Get system prompt for Explain Mode (information-first)
   * @param isIdentifyQuestion If true, provide structured answer for "how to identify" questions
   * @param conversationContext Optional context about conversation state (e.g., general intent, cancer type, emotional state)
   */
  getExplainModePrompt(
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean; cancerType?: string | null; emotionalState?: string }
  ): string {
    const empathyGuidelines = this.getEmpathyGuidelines(conversationContext?.emotionalState);
    const basePrompt = `You are Suchi (Suchitra Cancer Bot). For general informational questions, provide direct, evidence-based answers from the provided references.${empathyGuidelines}

EVIDENCE-ONLY POLICY (CRITICAL - YOU MUST FOLLOW THIS):
- You may ONLY state medical facts that are directly supported by retrieved NCI chunks
- DO NOT use general medical knowledge to "fill in" missing information
- DO NOT use phrases like "common tests include...", "usually doctors do...", "often done..." unless these exact phrases appear in retrieved text
- If retrieval doesn't support something, DO NOT guess - either omit it or say "I can't confirm from the provided sources"
- Every medical claim, test, treatment, or symptom MUST be present in the retrieved chunks
- If you cannot quote-support a test/treatment/symptom from retrieved context, omit it entirely
- Allowed meta-statements:
  * Content present in retrieved NCI text
  * Universal safety actions (seek urgent care for red flags, call emergency services)
  * Limitation statements ("I can't confirm from the provided sources", "I don't have enough information in my NCI sources")

REQUIREMENTS:
- Answer the question directly with 4-8 bullet points based on the references
- Do NOT assume the user is personally symptomatic unless they explicitly state it
- Do NOT default to "prepare for your visit" language
- Cite every medical claim using [citation:docId:chunkId]
- Every bullet point in structured sections MUST have a citation or be omitted

STRUCTURED SECTIONS REQUIREMENT:
After your main answer, you MUST include these sections with SPECIFIC content from the references (not generic placeholders):

1) **Warning Signs to Watch For:** (if query is about symptoms)
   - List 5+ SPECIFIC warning signs mentioned in the references
   - Each sign must be cited: "- [specific sign] [citation:docId:chunkId]"
   - Example: "- A lump in the breast [citation:kb_en_nci_types_breast_symptoms_v1:chunk-id]"
   - DO NOT use generic text like "persistent symptoms" - use specific signs from references

2) **Tests Doctors May Use:** (if query is about diagnosis/screening/symptoms)
   - List SPECIFIC diagnostic tests mentioned in the references
   - Each test must be cited: "- [specific test name] [citation:docId:chunkId]"
   - Example: "- Mammography (breast X-ray) [citation:kb_en_nci_types_breast_symptoms_v1:chunk-id]"
   - DO NOT use generic text like "various diagnostic tests" - list actual tests from references

3) **When to Seek Care:** (always include for symptom/diagnosis queries)
   - Include SPECIFIC timeframe from references (e.g., "within 2-4 weeks", "within 1-2 weeks")
   - If references mention specific timelines, use them exactly
   - If no specific timeframe in references, state: "I don't have enough information in my NCI sources to provide a specific timeline. Please consult a clinician for guidance."
   - Cite timeline information: "If symptoms persist for 2-4 weeks, seek medical evaluation [citation:docId:chunkId]"

4) **Questions to Ask Your Doctor:** (always include)
   - Generate 5-7 SPECIFIC, practical questions based on the references
   - Questions should be cancer-type-specific and reference-specific
   - Example: "What imaging tests are recommended for [cancer type]?" (if references discuss imaging)
   - DO NOT use generic questions like "Can you explain this in more detail?"
${conversationContext?.hasGenerallyAsking 
  ? "- Do NOT ask clarifying questions - user has indicated general/educational intent"
  : "- End with ONE optional follow-up: \"Are you asking generally or about your symptoms?\""}

DO NOT:
- Say "I understand you're experiencing symptoms" unless user said they are
- Push "prepare for healthcare visit" unless user indicates personal situation
- Show red-flag warnings unless urgency signals exist
- Use coaching/triage script language for general questions
- Add general medical knowledge not in retrieved chunks`;

    if (isIdentifyQuestion) {
      return basePrompt + `\n\n${getIdentifyRequirements(conversationContext?.cancerType || null)}`;
    }

    return basePrompt;
  }

  /**
   * Get system prompt for Navigate Mode (personal symptom support)
   * @param emotionalState Optional emotional state for empathy-aware responses
   */
  getNavigateModePrompt(emotionalState?: string): string {
    const empathyGuidelines = this.getEmpathyGuidelines(emotionalState);
    return `You are Suchi (Suchitra Cancer Bot). For personal symptom questions, provide brief acknowledgment, then 1-2 targeted questions to gather context. Provide a short "what to do next" checklist (max 3 bullets).${empathyGuidelines}

EVIDENCE-ONLY POLICY (CRITICAL):
- You may ONLY state medical facts that are directly supported by retrieved NCI chunks
- DO NOT use general medical knowledge to "fill in" missing information
- If retrieval doesn't support something, DO NOT guess - either omit it or say "I can't confirm from the provided sources"
- Every medical claim MUST be present in the retrieved chunks

REQUIREMENTS:
- Acknowledge the user's situation briefly
- Ask 1-2 targeted questions to gather context
- Provide a short next-step list (max 3 bullets)
- Use warm, supportive tone
- Cite any medical information using [citation:docId:chunkId]
- Every bullet point with medical information MUST have a citation or be omitted`;
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
   */
  async generateWithCitations(
    systemPrompt: string | "explain" | "navigate",
    context: string,
    userMessage: string,
    chunks: EvidenceChunk[],
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean; cancerType?: string | null; emotionalState?: string; checklist?: string }
  ): Promise<string> {
    // Resolve mode to actual prompt
    let actualSystemPrompt: string;
    if (systemPrompt === "explain") {
      actualSystemPrompt = this.getExplainModePrompt(isIdentifyQuestion, conversationContext);
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

      // Enhanced prompt with citation requirements and structured sections - make it extremely explicit
      const citationInstructions = `
CRITICAL CITATION REQUIREMENTS - YOU MUST FOLLOW THESE EXACTLY:
1. You MUST cite EVERY medical claim, fact, symptom, diagnostic method, or piece of information using the format: [citation:docId:chunkId]
2. Use the EXACT docId and chunkId from the reference list below - copy them exactly as shown
3. Example: If reference [1] has docId "kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1" and chunkId "kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1::chunk::0", you would write: "Swollen lymph nodes are a symptom [citation:kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1:kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1::chunk::0]"
4. You MUST include at least 2-3 citations in your response
5. If you mention multiple facts, cite each one separately
6. DO NOT write a response without citations - if you cannot cite something, do not include it
7. DO NOT make up docId or chunkId values - use ONLY what is in the reference list below
8. Every bullet point in structured sections (Warning Signs, Tests, etc.) MUST have a citation - if you cannot cite it, omit the bullet entirely

GROUNDING PER BULLET REQUIREMENT:
- Each bullet point MUST include: the medical claim + citation marker [citation:docId:chunkId]
- Format: "- CT scan of the chest [citation:doc_123:chunk_456]"
- If you cannot find supporting content in the references for a bullet point, DO NOT include that bullet point

REFERENCE LIST (use the exact docId and chunkId shown for each reference):
${referenceList}

${conversationContext?.checklist || ""}

RESPONSE FORMAT - YOU MUST INCLUDE THESE SECTIONS:
1. Main Answer: 4-8 bullet points directly answering the question, all cited
2. **Warning Signs to Watch For:** (if query mentions symptoms or is about symptoms)
   - List 5+ SPECIFIC warning signs from references, each cited
   - Extract ALL warning signs mentioned in references - don't stop at 2-3
   - Example: "- A lump in the breast [citation:kb_en_nci_types_breast_symptoms_v1:chunk-id]"
   - Include systemic symptoms (weight loss, fatigue, etc.) if mentioned in references
   - DO NOT use generic text - use specific signs from references

3. **Tests Doctors May Use:** (if query is about diagnosis/screening/symptoms)
   - Extract ALL diagnostic tests mentioned in references - aim for 4+ tests
   - Include: imaging tests (CT, MRI, X-ray, mammogram, ultrasound, PET scan, etc.), biopsy types, lab tests, physical exams
   - Each test must be cited: "- Mammography (breast X-ray) [citation:kb_en_nci_types_breast_symptoms_v1:chunk-id]"
   - If references mention multiple tests, list them all - don't stop at 2
   - DO NOT use generic text like "various diagnostic tests" - list actual test names

4. **When to Seek Care:** (always include)
   - FIRST: Check if references mention specific timeframes (e.g., "2-4 weeks", "within 1-2 weeks")
   - If references mention timelines, use them EXACTLY: "If symptoms persist for 2-4 weeks, seek medical evaluation [citation:docId:chunkId]"
   - If NO specific timeframe in references, provide reasonable guidance: "If symptoms persist for 2-4 weeks or worsen, seek medical evaluation. For urgent symptoms (severe pain, difficulty breathing, heavy bleeding), seek care immediately."
   - DO NOT say "I don't have enough information" - provide actionable guidance based on standard medical practice
   - Always cite if timeline is from references, or note it's general guidance

5. **Questions to Ask Your Doctor:** (always include)
   - Generate 5-7 SPECIFIC, practical questions based on references
   - Questions should be cancer-type-specific and reference-specific
   - Include questions about: specific tests mentioned, biopsy types, staging, follow-up, symptoms to monitor
   - Example: "What imaging tests are recommended for [cancer type]?" (if references discuss imaging)
   - DO NOT use generic questions like "Can you explain this in more detail?"

CRITICAL REQUIREMENTS:
- Extract ALL available information from references - don't stop early
- For tests: List ALL diagnostic methods mentioned, not just 2-3
- For timeline: Provide actionable guidance even if references don't specify exact timeframe
- All sections must contain SPECIFIC content from references with citations
- If a section truly has no relevant content in references, state that clearly rather than using generic text

User question: ${userMessage}`;

      // Retry logic with exponential backoff (max 2 retries)
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
          const completion = await this.openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              { role: "system", content: actualSystemPrompt },
              { role: "user", content: citationInstructions }
            ],
            temperature: 0.3,
            max_tokens: isIdentifyQuestion ? 2500 : 1500 // Identify questions need more tokens for structured response with citations
          }, {
            signal: controller.signal as any // OpenAI SDK may not support AbortSignal directly, but we'll handle timeout via catch
          });

          clearTimeout(timeoutId);

          const text = completion.choices[0]?.message?.content;

          if (!text || text.trim().length === 0) {
            this.logger.warn("Empty response from OpenAI, using fallback");
            return this.getFallbackResponse();
          }

          return text;
        } catch (error: any) {
          clearTimeout(timeoutId);
          lastError = error;
          
          // Don't retry on timeout or abort errors
          if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('aborted')) {
            this.logger.warn(`LLM generation timeout after ${this.timeoutMs}ms, using fallback`);
            return this.getFallbackResponse();
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
          
          // Non-retryable error or last attempt - throw
          throw error;
        }
      }
      
      // Should not reach here, but handle just in case
      this.logger.error(`LLM generation failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
      return this.getFallbackResponse();
    } catch (error) {
      this.logger.error(`Error generating response with OpenAI: ${error.message}`, error.stack);
      return this.getFallbackResponse();
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async generate(systemPrompt: string, context: string, userMessage: string): Promise<string> {
    try {
      const fullPrompt = `${context}\n\nUser question: ${userMessage}\n\nPlease provide a helpful response based on the reference information above. Format your response with clear sections when appropriate.`;

      // Add timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.timeoutMs);

      try {
        const completion = await this.openai.chat.completions.create({
          model: "gpt-4o",
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
          this.logger.warn("Empty response from OpenAI, using fallback");
          return this.getFallbackResponse();
        }
        return text;
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError' || error.message?.includes('timeout') || error.message?.includes('aborted')) {
          this.logger.warn(`LLM generation timeout after ${this.timeoutMs}ms, using fallback`);
          return this.getFallbackResponse();
        }
        throw error; // Re-throw non-timeout errors
      }
    } catch (error) {
      this.logger.error(`Error generating response with OpenAI: ${error.message}`, error.stack);
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
      const fullPrompt = `${systemPrompt}

REFERENCE LIST (use the exact docId and chunkId shown for each reference):
${referenceList}

User question: ${userMessage}

YOUR RESPONSE (2-3 sentences with citations + optional clarifying question):`;

      // Single attempt for definitional responses (simpler, should be faster)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const completion = await this.openai.chat.completions.create({
          model: "gpt-4o",
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
          this.logger.warn("Empty definitional response from OpenAI, retrying with full explain mode");
          return this.getFallbackResponse();
        }
        return text;
      } catch (error: any) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError' || error.message?.includes('timeout')) {
          this.logger.warn(`Definitional response timeout after ${this.timeoutMs}ms`);
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
}
