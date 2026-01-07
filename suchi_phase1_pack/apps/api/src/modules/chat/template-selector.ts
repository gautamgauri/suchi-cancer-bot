import { Injectable } from "@nestjs/common";
import { IntentClassifier, IntentClassificationResult } from "./intent-classifier";
import { ResponseTemplates, TemplateContext } from "./response-templates";
import { EvidenceChunk, EvidenceGateResult } from "../evidence/evidence-gate.service";

@Injectable()
export class TemplateSelector {
  constructor(private readonly intentClassifier: IntentClassifier) {}

  /**
   * Select and generate appropriate template based on intent classification
   */
  selectAndGenerate(
    userText: string,
    evidenceChunks: EvidenceChunk[],
    gateResult: EvidenceGateResult,
    safetyClassification: string,
    isFirstMessage: boolean,
    queryType?: string
  ): { responseText: string; intent: string } {
    // Classify intent
    const intentResult: IntentClassificationResult = this.intentClassifier.classify(
      userText,
      evidenceChunks,
      gateResult,
      safetyClassification
    );

    // Build template context
    const context: TemplateContext = {
      isFirstMessage,
      userText,
      queryType,
      evidenceQuality: gateResult.quality,
      intent: intentResult.intent
    };

    // Select template
    let responseText = ResponseTemplates.selectTemplate(intentResult.intent, context);

    // Append closing template if needed
    if (ResponseTemplates.needsClosingTemplate(responseText)) {
      // Use K1 for report-related, K2 for general
      if (intentResult.intent.includes("REPORT")) {
        responseText += ResponseTemplates.K1(context);
      } else {
        responseText += ResponseTemplates.K2(context);
      }
    }

    return {
      responseText,
      intent: intentResult.intent
    };
  }
}















