import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required");
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Generate response with mandatory inline citations
   */
  async generateWithCitations(
    systemPrompt: string,
    context: string,
    userMessage: string,
    chunks: EvidenceChunk[]
  ): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro" });

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

      const fullPrompt = `${systemPrompt}\n\n${citationInstructions}`;

      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();

      if (!text || text.trim().length === 0) {
        this.logger.warn("Empty response from Gemini, using fallback");
        return this.getFallbackResponse();
      }

      return text;
    } catch (error) {
      this.logger.error(`Error generating response with Gemini: ${error.message}`, error.stack);
      return this.getFallbackResponse();
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async generate(systemPrompt: string, context: string, userMessage: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-pro" });

      const fullPrompt = `${systemPrompt}\n\n${context}\n\nUser question: ${userMessage}\n\nPlease provide a helpful response based on the reference information above. Format your response with clear sections when appropriate.`;

      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();

      if (!text || text.trim().length === 0) {
        this.logger.warn("Empty response from Gemini, using fallback");
        return this.getFallbackResponse();
      }

      return text;
    } catch (error) {
      this.logger.error(`Error generating response with Gemini: ${error.message}`, error.stack);
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
