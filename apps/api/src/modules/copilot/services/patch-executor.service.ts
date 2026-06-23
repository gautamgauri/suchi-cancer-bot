import { Injectable, Logger } from '@nestjs/common';
import { RagService } from '../../rag/rag.service';
import { LlmService } from '../../llm/llm.service';
import type { PatchPlan, PatchAction } from '../copilot.types';
import { DEFINITIONAL_EXPLAIN_PROMPT } from '../../llm/prompts';

const DISCLAIMER_TEXT = `\n\n**Disclaimer:** This information is for educational purposes only and is not a substitute for professional medical advice. Please consult your doctor or healthcare provider for personalized guidance.`;

@Injectable()
export class PatchExecutorService {
  private readonly logger = new Logger(PatchExecutorService.name);

  constructor(
    private readonly rag: RagService,
    private readonly llm: LlmService,
  ) {}

  /** Execute a patch plan against a response, returning the repaired text */
  async execute(
    plan: PatchPlan,
    originalQuery: string,
    originalResponse: string,
  ): Promise<string> {
    let response = originalResponse;

    for (const action of plan.actions) {
      this.logger.log({ event: 'patch_execute', action: action.type, id: action.id });

      switch (action.type) {
        case 'add_disclaimer':
          response = this.addDisclaimer(response);
          break;

        case 'soften_claims':
          response = this.softenClaims(response);
          break;

        case 'remove_fabrication':
          response = this.removeFabricatedCitations(response);
          break;

        case 're_retrieve':
          response = await this.reRetrieveAndPatch(originalQuery, response);
          break;

        case 'add_citations':
          // Already handled by re_retrieve in most cases
          break;

        case 'improve_tone':
          response = this.improveTone(response);
          break;

        case 'add_navigation':
          response = this.addNavigationInfo(response);
          break;

        case 'regenerate_response':
          response = await this.regenerateResponse(originalQuery);
          break;
      }
    }

    return response;
  }

  private addDisclaimer(text: string): string {
    if (/not (?:a )?substitute for/i.test(text)) return text;
    return text + DISCLAIMER_TEXT;
  }

  private softenClaims(text: string): string {
    let result = text;
    // Replace definitive diagnosis claims with hedged language
    result = result.replace(/you (?:definitely )?have cancer/gi, 'symptoms may warrant further evaluation');
    result = result.replace(/this is cancer/gi, 'this could potentially be concerning');
    result = result.replace(/you are diagnosed/gi, 'a doctor would need to evaluate');
    // Replace prognosis claims
    result = result.replace(/survival rate is \d+/gi, 'survival rates vary and a doctor can provide personalized information');
    result = result.replace(/you will live/gi, 'prognosis depends on many factors — please discuss with your oncologist');
    // Replace dosage claims
    result = result.replace(/take \d+ ?mg/gi, 'your doctor will determine the appropriate dosage');
    result = result.replace(/dosage is/gi, 'dosage should be determined by your healthcare provider');
    return result;
  }

  private removeFabricatedCitations(text: string): string {
    // Remove inline citation markers that don't have backing data
    return text.replace(/\[citation:[^\]]+\]/g, '');
  }

  private async reRetrieveAndPatch(query: string, response: string): Promise<string> {
    try {
      const chunks = await this.rag.retrieveWithMetadata(query, 8);
      if (chunks.length === 0) return response;

      // Append citation sources as a reference section
      const sources = chunks
        .slice(0, 5)
        .map((c, i) => `[${i + 1}] ${c.docId} — ${c.content?.slice(0, 100)}...`)
        .join('\n');

      if (!response.includes('Sources:') && !response.includes('References:')) {
        return response + `\n\n**Sources:**\n${sources}`;
      }
      return response;
    } catch (err) {
      this.logger.warn('Re-retrieve failed', err);
      return response;
    }
  }

  private improveTone(text: string): string {
    let result = text;
    result = result.replace(/you will die/gi, 'this is a serious condition that requires prompt medical attention');
    result = result.replace(/hopeless/gi, 'challenging but treatable in many cases');
    result = result.replace(/nothing can be done/gi, 'there are various treatment options to discuss with your doctor');
    result = result.replace(/give up/gi, 'seek support from your healthcare team');
    return result;
  }

  private addNavigationInfo(text: string): string {
    const navSection = `\n\n**Finding Help:**\n- Contact your nearest cancer center or hospital\n- National Cancer Helpline: 1800-11-4422 (toll-free)\n- Visit the National Cancer Institute at www.cancer.gov for more information`;
    if (text.includes('Finding Help') || text.includes('Helpline')) return text;
    return text + navSection;
  }

  private async regenerateResponse(query: string): Promise<string> {
    try {
      const chunks = await this.rag.retrieveWithMetadata(query, 6);
      const context = chunks.map((c) => c.content).join('\n\n');
      const systemPrompt = DEFINITIONAL_EXPLAIN_PROMPT;
      const response = await this.llm.generate(systemPrompt, context, query);
      return response;
    } catch (err) {
      this.logger.warn('Regeneration failed', err);
      return 'I apologize, but I was unable to generate a response. Please try again or consult a healthcare professional directly.';
    }
  }
}
