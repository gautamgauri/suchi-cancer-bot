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
Cite each sign using [citation:docId:chunkId] from the REFERENCE LIST.

2) HOW DOCTORS CONFIRM (minimum 4 bullet points)
Extract diagnostic methods SPECIFIC to ${cancerType ? cancerType + ' cancer' : 'the cancer type mentioned'} from the references. Look for:
- Physical/clinical examination methods mentioned in references
- Imaging tests SPECIFIC to ${cancerType ? 'this cancer type' : 'this cancer'} (X-ray, CT, MRI, PET, ultrasound, mammogram, etc. - as mentioned in references)
- Biopsy types and procedures mentioned in references - MUST be included if mentioned, and explicitly state it as the diagnostic gold standard / confirmation step if the references indicate this
- Pathology, staging, and molecular testing mentioned in references (receptor testing, genetic markers, tumor markers, etc. - as mentioned in references)
Include the sentence: "Symptoms cannot confirm cancer; confirmation requires medical evaluation and often a biopsy." (only if this concept appears in references)
Cite each diagnostic method using [citation:docId:chunkId] from the REFERENCE LIST.

3) WHEN TO SEEK CARE (timeline + urgency)
Extract timeline guidance SPECIFIC to ${cancerType ? cancerType + ' cancer' : 'this cancer type'} from the references. If references mention specific timelines, include them. If not, provide general guidance based on what the references say about urgency for ${cancerType ? 'this cancer type' : 'this cancer'}.
Include timeline guidance if available from references (adapt to the specific cancer type and symptoms mentioned)
Also include urgent vs routine distinction based on what references say for ${cancerType ? 'this cancer type' : 'this cancer'}.
Cite using [citation:docId:chunkId] from the REFERENCE LIST.

4) QUESTIONS TO ASK THE DOCTOR (minimum 7 questions)
Generate practical questions based on information in the references for ${cancerType ? cancerType + ' cancer' : 'this cancer type'}. Include questions about:
- What imaging or tests are needed for ${cancerType ? 'this cancer type' : 'this cancer'} and why? (if references discuss imaging/tests)
- Do I need a biopsy? Which type is used for ${cancerType ? 'this cancer type' : 'this cancer'}? (if references discuss biopsy)
- If cancer is confirmed, what staging or subtype tests will be done? (if references discuss staging/subtyping)
- What follow-up interval is recommended? (if references discuss follow-up)
- What symptoms should trigger earlier return? (if references discuss symptom monitoring)
Plus 2 additional practical questions based on reference content for ${cancerType ? cancerType + ' cancer' : 'this cancer type'} (referral, timeline, costs, where to go, etc.)

CITATIONS: Provide at least 2 sources with title + URL if available. All citations MUST reference chunks from the REFERENCE LIST provided below.
Do NOT ask more clarifying questions if the user has indicated general intent (e.g., "generally asking").
`;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly openai: OpenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("OPENAI_API_KEY");
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required");
    }
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Get system prompt for Explain Mode (information-first)
   * @param isIdentifyQuestion If true, provide structured answer for "how to identify" questions
   * @param conversationContext Optional context about conversation state (e.g., general intent, cancer type)
   */
  getExplainModePrompt(
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean; cancerType?: string | null }
  ): string {
    const basePrompt = `You are Suchi (Suchitra Cancer Bot). For general informational questions, provide direct, evidence-based answers from the provided references.

REQUIREMENTS:
- Answer the question directly with 4-8 bullet points
- Do NOT assume the user is personally symptomatic unless they explicitly state it
- Do NOT default to "prepare for your visit" language
- Cite every medical claim using [citation:docId:chunkId]
${conversationContext?.hasGenerallyAsking 
  ? "- Do NOT ask clarifying questions - user has indicated general/educational intent"
  : "- End with ONE optional follow-up: \"Are you asking generally or about your symptoms?\""}

DO NOT:
- Say "I understand you're experiencing symptoms" unless user said they are
- Push "prepare for healthcare visit" unless user indicates personal situation
- Show red-flag warnings unless urgency signals exist
- Use coaching/triage script language for general questions`;

    if (isIdentifyQuestion) {
      return basePrompt + `\n\n${getIdentifyRequirements(conversationContext?.cancerType || null)}`;
    }

    return basePrompt;
  }

  /**
   * Get system prompt for Navigate Mode (personal symptom support)
   */
  getNavigateModePrompt(): string {
    return `You are Suchi (Suchitra Cancer Bot). For personal symptom questions, provide brief acknowledgment, then 1-2 targeted questions to gather context. Provide a short "what to do next" checklist (max 3 bullets).

REQUIREMENTS:
- Acknowledge the user's situation briefly
- Ask 1-2 targeted questions to gather context
- Provide a short next-step list (max 3 bullets)
- Use warm, supportive tone
- Cite any medical information using [citation:docId:chunkId]`;
  }

  /**
   * Generate response with mandatory inline citations
   * @param mode "explain" for Explain Mode, "navigate" for Navigate Mode, or custom systemPrompt
   * @param isIdentifyQuestion If true and mode is "explain", use enhanced prompt for identify questions
   * @param conversationContext Optional context about conversation state (e.g., general intent, cancer type)
   */
  async generateWithCitations(
    systemPrompt: string | "explain" | "navigate",
    context: string,
    userMessage: string,
    chunks: EvidenceChunk[],
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean; cancerType?: string | null }
  ): Promise<string> {
    // Resolve mode to actual prompt
    let actualSystemPrompt: string;
    if (systemPrompt === "explain") {
      actualSystemPrompt = this.getExplainModePrompt(isIdentifyQuestion, conversationContext);
    } else if (systemPrompt === "navigate") {
      actualSystemPrompt = this.getNavigateModePrompt();
    } else {
      actualSystemPrompt = systemPrompt;
    }
    try {
      // Build reference list with citation IDs
      const referenceList = chunks.map((chunk, index) => {
        return `[${index + 1}] docId: ${chunk.docId}, chunkId: ${chunk.chunkId}\n   Title: ${chunk.document.title}\n   Content: ${chunk.content.substring(0, 300)}${chunk.content.length > 300 ? "..." : ""}`;
      }).join("\n\n");

      // Enhanced prompt with citation requirements
      const citationInstructions = `
CRITICAL CITATION REQUIREMENTS:
1. You MUST cite EVERY medical claim using the format: [citation:docId:chunkId]
2. Example: "Breast cancer screening typically begins at age 40 [citation:doc_123:chunk_456]"
3. If you cannot cite a claim from the provided references, DO NOT include it in your response
4. Use the exact docId and chunkId from the reference list below
5. Multiple claims can cite the same chunk if appropriate
6. DO NOT make up information or cite sources not in the reference list

REFERENCE LIST:
${referenceList}

RESPONSE FORMAT:
- Provide a clear, helpful answer based ONLY on the references above
- Cite every medical fact or claim
- Format with clear sections when appropriate
- If you cannot answer based on the references, say so clearly

User question: ${userMessage}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: actualSystemPrompt },
          { role: "user", content: citationInstructions }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      const text = completion.choices[0]?.message?.content;

      if (!text || text.trim().length === 0) {
        this.logger.warn("Empty response from OpenAI, using fallback");
        return this.getFallbackResponse();
      }

      return text;
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

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      const text = completion.choices[0]?.message?.content;

      if (!text || text.trim().length === 0) {
        this.logger.warn("Empty response from OpenAI, using fallback");
        return this.getFallbackResponse();
      }

      return text;
    } catch (error) {
      this.logger.error(`Error generating response with OpenAI: ${error.message}`, error.stack);
      return this.getFallbackResponse();
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
