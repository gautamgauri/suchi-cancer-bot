import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

/**
 * IDENTIFY_REQUIREMENTS: Structure checklist for "how to identify" questions
 * CRITICAL: This is a STRUCTURE checklist, NOT hardcoded content. 
 * All information MUST come from the RAG chunks provided in the REFERENCE LIST.
 * The items listed are examples/requirements - include them IF they appear in the references.
 */
const IDENTIFY_REQUIREMENTS = `
If the user asks "how to identify" cancer (or warning signs / how doctors confirm), you MUST output the following 4 sections with these minimum requirements.

IMPORTANT: All content MUST come from the provided REFERENCE LIST (RAG chunks). Do NOT make up information. If a required item is not in the references, note that it's not available rather than inventing it.

1) WARNING SIGNS (minimum 7 bullet points, plain language)
Extract from references. Common examples to look for (include IF found in references):
- Lump/mass or thickening
- Change in size/shape
- Nipple inversion/pulling in
- Nipple discharge (new, one-sided; mention bloody as concerning if mentioned in references)
- Skin dimpling / "orange peel" or puckering
- Redness or scaling of nipple/breast skin
- Swollen lymph nodes in armpit or collarbone
- Any other warning signs mentioned in the references
Cite each sign using [citation:docId:chunkId] from the REFERENCE LIST.

2) HOW DOCTORS CONFIRM (minimum 4 bullet points)
Extract diagnostic methods from references. Common examples to look for (include IF found in references):
- Clinical breast exam (if mentioned)
- Imaging: mammogram, ultrasound, MRI (as mentioned in references)
- Biopsy (core needle or surgical) - MUST be included if mentioned in references, and explicitly state it as the diagnostic gold standard / confirmation step if the references indicate this
- Pathology and receptor testing: ER/PR/HER2 (if mentioned)
Include the sentence: "Symptoms cannot confirm cancer; confirmation requires medical evaluation and often a biopsy." (only if this concept appears in references)
Cite each diagnostic method using [citation:docId:chunkId] from the REFERENCE LIST.

3) WHEN TO SEEK CARE (timeline + urgency)
Extract timeline guidance from references. If references mention specific timelines (e.g., "2–4 weeks"), include them. If not, provide general guidance based on what the references say about urgency.
Include timeline guidance if available: "If a new lump persists for 2–4 weeks, or there are nipple/skin changes, book a clinical evaluation soon." (only if references support this)
Also include urgent vs routine distinction based on what references say.
Cite using [citation:docId:chunkId] from the REFERENCE LIST.

4) QUESTIONS TO ASK THE DOCTOR (minimum 7 questions)
Generate practical questions based on information in the references. Examples to include (if supported by references):
- What imaging do I need and why? (if references discuss imaging)
- Do I need a biopsy? Which type? (if references discuss biopsy)
- If cancer is confirmed, what subtype tests will be done (ER/PR/HER2)? (if references discuss these tests)
- If benign, what follow-up interval? (if references discuss follow-up)
- What symptoms should trigger earlier return? (if references discuss symptom monitoring)
Plus 2 additional practical questions based on reference content (referral, timeline, costs, where to go, etc.)

CITATIONS: Provide at least 2 sources with title + URL if available. All citations MUST reference chunks from the REFERENCE LIST provided below.
Do NOT ask more clarifying questions if the user has indicated general intent (e.g., "generally asking").
`;

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
   * @param conversationContext Optional context about conversation state (e.g., general intent)
   */
  getExplainModePrompt(
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean }
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
      return basePrompt + `\n\n${IDENTIFY_REQUIREMENTS}`;
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
   * @param conversationContext Optional context about conversation state (e.g., general intent)
   */
  async generateWithCitations(
    systemPrompt: string | "explain" | "navigate",
    context: string,
    userMessage: string,
    chunks: EvidenceChunk[],
    isIdentifyQuestion: boolean = false,
    conversationContext?: { hasGenerallyAsking?: boolean }
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
