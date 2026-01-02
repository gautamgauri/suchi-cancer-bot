import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { SafetyService } from "../safety/safety.service";
import { RagService } from "../rag/rag.service";
import { LlmService } from "../llm/llm.service";
import { EvidenceGateService } from "../evidence/evidence-gate.service";
import { CitationService } from "../citations/citation.service";
import { AbstentionService } from "../abstention/abstention.service";
import { QueryTypeClassifier } from "../rag/query-type.classifier";
import { GreetingDetector } from "./greeting-detector";
import { IntentClassifier } from "./intent-classifier";
import { TemplateSelector } from "./template-selector";
import { ChatDto } from "./dto";

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly safety: SafetyService,
    private readonly rag: RagService,
    private readonly llm: LlmService,
    private readonly evidenceGate: EvidenceGateService,
    private readonly citationService: CitationService,
    private readonly abstention: AbstentionService,
    private readonly intentClassifier: IntentClassifier,
    private readonly templateSelector: TemplateSelector
  ) {}

  async handle(dto: ChatDto) {
    const session = await this.prisma.session.findUnique({ where: { id: dto.sessionId } });
    if (!session) throw new BadRequestException("Invalid sessionId");

    await this.analytics.emit("chat_turn_submitted", { channel: dto.channel }, dto.sessionId);

    await this.prisma.message.create({ data: { sessionId: dto.sessionId, role: "user", text: dto.userText } });

    const started = Date.now();
    const safetyResult = this.safety.evaluate(dto.userText);

    if (safetyResult.classification !== "normal") {
      const assistant = await this.prisma.message.create({
        data: {
          sessionId: dto.sessionId,
          role: "assistant",
          text: safetyResult.responseText ?? "I'm sorry—can you rephrase that?",
          safetyClassification: safetyResult.classification,
          policyRulesFired: safetyResult.rulesFired,
          latencyMs: Date.now() - started
        }
      });

      await this.prisma.safetyEvent.create({
        data: { sessionId: dto.sessionId, messageId: assistant.id, type: safetyResult.classification, detail: safetyResult.rulesFired.join(",") }
      });

      await this.analytics.emit("safety_triggered", { classification: safetyResult.classification, rules: safetyResult.rulesFired }, dto.sessionId);

      return { sessionId: dto.sessionId, messageId: assistant.id, responseText: assistant.text, safety: { classification: safetyResult.classification, actions: safetyResult.actions } };
    }

    // 1.5. Check for urgent red flags BEFORE greeting (priority: red flags > greetings)
    // This ensures "hi + severe pain" doesn't get a cheerful greeting menu
    const hasUrgencyIndicators = this.abstention.hasUrgencyIndicators(dto.userText);
    if (hasUrgencyIndicators && safetyResult.classification === "normal") {
      // Use template system for urgent symptoms (S2 template)
      const existingAssistantMessages = await this.prisma.message.count({
        where: {
          sessionId: dto.sessionId,
          role: "assistant"
        }
      });
      const isFirstMessage = existingAssistantMessages === 0;

      const templateResult = this.templateSelector.selectAndGenerate(
        dto.userText,
        [],
        { shouldAbstain: false, confidence: "high", quality: "strong" },
        "normal",
        isFirstMessage,
        "sideEffects"
      );
      
      const assistant = await this.prisma.message.create({
        data: {
          sessionId: dto.sessionId,
          role: "assistant",
          text: templateResult.responseText,
          safetyClassification: "red_flag",
          latencyMs: Date.now() - started
        }
      });

      await this.prisma.safetyEvent.create({
        data: { sessionId: dto.sessionId, messageId: assistant.id, type: "red_flag", detail: "urgency_indicators_detected" }
      });

      await this.analytics.emit("safety_triggered", { classification: "red_flag", rules: ["urgency_indicators_detected"], intent: templateResult.intent }, dto.sessionId);

      return { 
        sessionId: dto.sessionId, 
        messageId: assistant.id, 
        responseText: assistant.text, 
        safety: { classification: "red_flag" as const, actions: ["show_emergency_banner", "end_conversation"] } 
      };
    }

    // 1.6. Check for greeting (after safety and urgency checks, before RAG)
    // Note: Greeting will be handled by intent classification system below
    // But we keep this check for early return to bypass RAG
    if (GreetingDetector.isGreeting(dto.userText)) {
      const existingAssistantMessages = await this.prisma.message.count({
        where: {
          sessionId: dto.sessionId,
          role: "assistant"
        }
      });
      const isFirstMessage = existingAssistantMessages === 0;

      // Use template system for greeting
      const templateResult = this.templateSelector.selectAndGenerate(
        dto.userText,
        [],
        { shouldAbstain: false, confidence: "high", quality: "strong" },
        "normal",
        isFirstMessage,
        "general"
      );

      const assistant = await this.prisma.message.create({
        data: {
          sessionId: dto.sessionId,
          role: "assistant",
          text: templateResult.responseText,
          safetyClassification: "normal",
          latencyMs: Date.now() - started
        }
      });

      await this.analytics.emit("greeting_response", { isFirstMessage, intent: templateResult.intent }, dto.sessionId);

      return {
        sessionId: dto.sessionId,
        messageId: assistant.id,
        responseText: assistant.text,
        safety: { classification: "normal" as const, actions: [] }
      };
    }

    // 2. Retrieve evidence with full metadata
    const evidenceChunks = await this.rag.retrieveWithMetadata(dto.userText, 6);
    const kbDocIds = Array.from(new Set(evidenceChunks.map(c => c.docId)));

    // 3. Classify query type
    const queryType = QueryTypeClassifier.classify(dto.userText);

    // 4. Evidence gate check
    const gateResult = await this.evidenceGate.validateEvidence(evidenceChunks, queryType);
    
    // 5. Intent classification and template selection
    const existingAssistantMessages = await this.prisma.message.count({
      where: {
        sessionId: dto.sessionId,
        role: "assistant"
      }
    });
    const isFirstMessage = existingAssistantMessages === 0;

    // Check if we should use template-based response
    const templateResult = this.templateSelector.selectAndGenerate(
      dto.userText,
      evidenceChunks,
      gateResult,
      safetyResult.classification,
      isFirstMessage,
      queryType
    );

    // Intents that should use templates directly (bypass RAG/LLM)
    const templateOnlyIntents = [
      "GREETING_ONLY",
      "UNCLEAR_REQUEST",
      "REPORT_REQUEST_NO_TEXT",
      "SYMPTOMS_NON_URGENT",
      "SIDE_EFFECTS_GENERAL",
      "CARE_NAVIGATION_PROVIDER_CHOICE",
      "CARE_NAVIGATION_SECOND_OPINION",
      "PREVENTION_SCREENING_INFO",
      "TREATMENT_OPTIONS_GENERAL",
      "REQUEST_OUT_OF_SCOPE",
      "INSUFFICIENT_EVIDENCE",
      "MISSING_CONTEXT",
      "CONFLICTING_INFO",
      "TECHNICAL_FAILURE",
      "SAFETY_RESTRICTED",
      "ABSTENTION_WITH_RED_FLAGS"
    ];

    // Intents that need RAG/LLM but with template structure
    const ragWithTemplateIntents = [
      "REPORT_TEXT_PROVIDED",
      "SYMPTOMS_URGENT_RED_FLAGS", // Already handled above, but keep for consistency
      "SIDE_EFFECTS_POSSIBLY_URGENT" // Already handled above
    ];

    // Use template directly for template-only intents
    if (templateOnlyIntents.includes(templateResult.intent)) {
      const assistant = await this.prisma.message.create({
        data: {
          sessionId: dto.sessionId,
          role: "assistant",
          text: templateResult.responseText,
          safetyClassification: "normal",
          kbDocIds: templateResult.intent === "INSUFFICIENT_EVIDENCE" || 
                    templateResult.intent === "ABSTENTION_WITH_RED_FLAGS" ? [] : kbDocIds,
          latencyMs: Date.now() - started,
          evidenceQuality: gateResult.quality,
          evidenceGatePassed: !gateResult.shouldAbstain,
          abstentionReason: gateResult.shouldAbstain ? gateResult.reason || undefined : undefined
        }
      });

      await this.analytics.emit("template_response", {
        intent: templateResult.intent,
        queryType
      }, dto.sessionId);

      return {
        sessionId: dto.sessionId,
        messageId: assistant.id,
        responseText: assistant.text,
        safety: { classification: "normal" as const, actions: [] },
        abstentionReason: gateResult.shouldAbstain ? gateResult.reason : undefined
      };
    }

    // For intents that need RAG/LLM, continue with existing flow
    // (REPORT_TEXT_PROVIDED and others will go through RAG/LLM)

    // 5. Generate response with citations
    const systemPrompt =
      "You are Suchi (Suchitra Cancer Bot), an informational and navigation assistant for cancer. " +
      "No diagnosis/prescribing/dosage. Use sections: Next steps, Red flags, Questions to ask a doctor.";

    let responseText = await this.llm.generateWithCitations(
      systemPrompt,
      "",
      dto.userText,
      evidenceChunks
    );

    // 6. Extract and validate citations with confidence levels
    let citations = this.citationService.extractCitations(responseText, evidenceChunks);
    let citationValidation = this.citationService.validateCitations(citations, evidenceChunks, responseText);

    // Handle RED (no citations) - retry once, then abstain
    if (citationValidation.confidenceLevel === "RED") {
      this.logger.warn(`Citation validation RED (no citations): ${citationValidation.errors?.join(", ")}`);
      // Retry once
      responseText = await this.llm.generateWithCitations(
        systemPrompt,
        "",
        dto.userText,
        evidenceChunks
      );
      citations = this.citationService.extractCitations(responseText, evidenceChunks);
      citationValidation = this.citationService.validateCitations(citations, evidenceChunks, responseText);

      if (citationValidation.confidenceLevel === "RED") {
        // Still RED after retry - abstain
        const abstentionMsg = this.abstention.generateAbstentionMessage("citation_validation_failed", queryType, dto.userText);

        const assistant = await this.prisma.message.create({
          data: {
            sessionId: dto.sessionId,
            role: "assistant",
            text: abstentionMsg,
            safetyClassification: "normal",
            kbDocIds: [],
            latencyMs: Date.now() - started,
            evidenceQuality: gateResult.quality,
            evidenceGatePassed: false,
            abstentionReason: "citation_validation_failed"
          }
        });

        return {
          sessionId: dto.sessionId,
          messageId: assistant.id,
          responseText: assistant.text,
          safety: { classification: "normal" as const, actions: [] },
          abstentionReason: "citation_validation_failed"
        };
      }
    }

    // Handle YELLOW (low confidence) - add cautious preamble
    if (citationValidation.confidenceLevel === "YELLOW") {
      this.logger.log(`Citation validation YELLOW: ${citations.length} citations, density ${citationValidation.citationDensity.toFixed(2)}`);

      // Prepend uncertainty disclaimer
      const uncertaintyPreamble =
        "**Note:** I have limited source material on this specific aspect, so this answer may not be comprehensive. " +
        "Please verify with your healthcare provider.\n\n";

      responseText = uncertaintyPreamble + responseText;
    }

    // GREEN or YELLOW with citations - proceed with response

    // 7. Store assistant message
    const assistant = await this.prisma.message.create({
      data: {
        sessionId: dto.sessionId,
        role: "assistant",
        text: responseText,
        safetyClassification: "normal",
        kbDocIds,
        latencyMs: Date.now() - started,
        evidenceQuality: gateResult.quality,
        evidenceGatePassed: true,
        citationCount: citations.length
      }
    });

    // 8. Store citations
    if (citations.length > 0) {
      const enrichedCitations = await this.citationService.enrichCitations(citations, evidenceChunks);
      
      await Promise.all(
        enrichedCitations.map(citation =>
          this.prisma.messageCitation.create({
            data: {
              messageId: assistant.id,
              docId: citation.docId,
              chunkId: citation.chunkId,
              citationText: citation.citationText,
              position: citation.position
            }
          })
        )
      );
    }

    await this.analytics.emit("chat_turn_completed", {
      kbDocCount: kbDocIds.length,
      latencyMs: assistant.latencyMs,
      citationCount: citations.length,
      citationConfidence: citationValidation.confidenceLevel,
      citationDensity: citationValidation.citationDensity,
      evidenceQuality: gateResult.quality,
      queryType
    }, dto.sessionId);

    return {
      sessionId: dto.sessionId,
      messageId: assistant.id,
      responseText: assistant.text,
      safety: { classification: "normal" as const, actions: [] },
      citations: citations.map(c => ({
        docId: c.docId,
        chunkId: c.chunkId,
        position: c.position
      })),
      citationConfidence: citationValidation.confidenceLevel
    };
  }
}
