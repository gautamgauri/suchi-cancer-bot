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
import { ModeDetector } from "./mode-detector";
import { ResponseTemplates } from "./response-templates";
import { ResponseFormatter } from "./response-formatter";
import { ResponseValidatorService } from "./response-validator.service";
import { ChatDto } from "./dto";
import { hasGeneralIntentSignal } from "./utils/general-intent";
import { detectCancerType } from "./utils/cancer-type-detector";

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
    private readonly templateSelector: TemplateSelector,
    private readonly responseValidator: ResponseValidatorService
  ) {}

  async handle(dto: ChatDto) {
    const session = await this.prisma.session.findUnique({ where: { id: dto.sessionId } });
    if (!session) {
      throw new BadRequestException("Invalid sessionId");
    }

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

    // 2. Mode Detection (NEW - after greeting, before RAG)
    const mode = ModeDetector.detectMode(dto.userText);

    // 2.5. Conversation History Tracking - detect "generally asking" signals
    const recentMessages = await this.prisma.message.findMany({
      where: { sessionId: dto.sessionId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { role: true, text: true }
    });

    const hasGenerallyAsking =
      hasGeneralIntentSignal(dto.userText) ||
      recentMessages.some(m => m.role === "user" && hasGeneralIntentSignal(m.text));

    // 3. Retrieve evidence with full metadata
    // Use expanded retrieval if this might be an identify question or if we expect weak evidence
    const identifyGeneralPattern = /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i;
    const cancerKeywordPattern = /\b(cancer|lymphoma|tumou?r|symptom|sign|warning)\b/i;
    const mightBeIdentifyQuestion = identifyGeneralPattern.test(dto.userText.toLowerCase()) && 
                                    cancerKeywordPattern.test(dto.userText.toLowerCase());
    
    let evidenceChunks;
    if (mightBeIdentifyQuestion) {
      const cancerType = detectCancerType(dto.userText);
      evidenceChunks = await this.rag.retrieveWithExpansion(dto.userText, 6, cancerType);
    } else {
      evidenceChunks = await this.rag.retrieveWithMetadata(dto.userText, 6);
    }
    const kbDocIds = Array.from(new Set(evidenceChunks.map(c => c.docId)));

    // 4. Classify query type
    const queryType = QueryTypeClassifier.classify(dto.userText);

    // 5. Intent classification (moved before evidence gate to provide context)
    const existingAssistantMessages = await this.prisma.message.count({
      where: {
        sessionId: dto.sessionId,
        role: "assistant"
      }
    });
    const isFirstMessage = existingAssistantMessages === 0;

    const intentResult = this.intentClassifier.classify(
      dto.userText,
      evidenceChunks,
      { shouldAbstain: false, confidence: "high", quality: "strong" }, // Temporary gate result for classification
      safetyResult.classification,
      { hasGenerallyAsking }
    );

    // 6. Evidence gate check (with intent and conversation context)
    let gateResult = await this.evidenceGate.validateEvidence(
      evidenceChunks,
      queryType,
      dto.userText,
      intentResult.intent,
      { hasGenerallyAsking }
    );

    // If evidence is weak or insufficient, try expanded retrieval
    if ((gateResult.quality === "weak" || gateResult.quality === "insufficient") && !mightBeIdentifyQuestion) {
      const cancerType = detectCancerType(dto.userText);
      const expandedChunks = await this.rag.retrieveWithExpansion(dto.userText, 6, cancerType);
      if (expandedChunks.length > evidenceChunks.length) {
        evidenceChunks = expandedChunks;
        // Re-run evidence gate with expanded chunks
        gateResult = await this.evidenceGate.validateEvidence(
          evidenceChunks,
          queryType,
          dto.userText,
          intentResult.intent,
          { hasGenerallyAsking }
        );
      }
    }

    // 7. Mode-based routing
    // Template-only intents (no RAG needed)
    const templateOnlyIntents = [
      "GREETING_ONLY",
      "UNCLEAR_REQUEST",
      "REPORT_REQUEST_NO_TEXT",
      "CARE_NAVIGATION_PROVIDER_CHOICE",
      "CARE_NAVIGATION_SECOND_OPINION",
      "REQUEST_OUT_OF_SCOPE",
      "SAFETY_RESTRICTED",
      "ABSTENTION_WITH_RED_FLAGS"
    ];

    if (templateOnlyIntents.includes(intentResult.intent)) {
      const templateResult = this.templateSelector.selectAndGenerate(
        dto.userText,
        evidenceChunks,
        gateResult,
        safetyResult.classification,
        isFirstMessage,
        queryType
      );

      const assistant = await this.prisma.message.create({
        data: {
          sessionId: dto.sessionId,
          role: "assistant",
          text: templateResult.responseText,
          safetyClassification: "normal",
          kbDocIds: [],
          latencyMs: Date.now() - started,
          evidenceQuality: gateResult.quality,
          evidenceGatePassed: !gateResult.shouldAbstain,
          abstentionReason: gateResult.shouldAbstain ? gateResult.reason || undefined : undefined
        }
      });

      await this.analytics.emit("template_response", {
        intent: templateResult.intent,
        queryType,
        mode
      }, dto.sessionId);

      return {
        sessionId: dto.sessionId,
        messageId: assistant.id,
        responseText: assistant.text,
        safety: { classification: "normal" as const, actions: [] },
        abstentionReason: gateResult.shouldAbstain ? gateResult.reason : undefined
      };
    }

    // Abstention intents (weak evidence, ask clarifying question)
    const abstentionIntents = [
      "INSUFFICIENT_EVIDENCE",
      "MISSING_CONTEXT",
      "CONFLICTING_INFO",
      "TECHNICAL_FAILURE"
    ];

    if (abstentionIntents.includes(intentResult.intent) && mode === "explain") {
      // Clarification budget enforcement: count recent clarifying messages
      const recentAssistant = await this.prisma.message.findMany({
        where: { 
          sessionId: dto.sessionId, 
          role: "assistant"
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { text: true }
      });

      // Heuristic: detect clarifying questions (question mark + common clarifying patterns)
      const clarificationsSoFar = recentAssistant.filter(m => {
        return /\?/.test(m.text) && /\b(can you|could you|would you|tell me|share|provide|specify)\b/i.test(m.text);
      }).length;

      // Budget rules: 0 if general intent, max 2 otherwise
      const maxClarifications = hasGenerallyAsking ? 0 : 2;
      const canAskClarifying = clarificationsSoFar < maxClarifications;

      if (canAskClarifying) {
        // Rule B2: Ask ONE clarifying question before abstaining
        const clarifyingQuestion = this.evidenceGate.generateClarifyingQuestion(dto.userText, queryType);
      
        const assistant = await this.prisma.message.create({
          data: {
            sessionId: dto.sessionId,
            role: "assistant",
            text: clarifyingQuestion,
            safetyClassification: "normal",
            kbDocIds: [],
            latencyMs: Date.now() - started,
            evidenceQuality: gateResult.quality,
            evidenceGatePassed: false,
            abstentionReason: gateResult.reason || undefined
          }
        });

        await this.analytics.emit("clarifying_question", {
          intent: intentResult.intent,
          queryType,
          mode
        }, dto.sessionId);

        return {
          sessionId: dto.sessionId,
          messageId: assistant.id,
          responseText: assistant.text,
          safety: { classification: "normal" as const, actions: [] },
          abstentionReason: gateResult.reason
        };
      }
      // If canAskClarifying is false, fall through to Explain Mode flow below
      // (No clarifying question will be asked, proceed with answer generation)
    }

    // Explain Mode + Strong RAG: LLM with Explain Mode prompt → structure with micro-template
    if (mode === "explain" && (intentResult.intent === "INFORMATIONAL_GENERAL" || intentResult.intent === "INFORMATIONAL_SYMPTOMS")) {
      // Check if this is an identify question (general, not personal)
      const identifyGeneralPattern = /\b(how to identify|how do you identify|how can you identify|ways to identify|signs of|indicators of|how to detect|how can you tell|how to know)\b/i;
      const cancerKeywordPattern = /\b(cancer|lymphoma|tumou?r|symptom|sign|warning)\b/i;
      const isIdentifyQuestion = identifyGeneralPattern.test(dto.userText.toLowerCase()) && 
                                  cancerKeywordPattern.test(dto.userText.toLowerCase()) &&
                                  !ModeDetector.hasPersonalDiagnosisSignal(dto.userText);
      
      // Detect cancer type for cancer-type-specific responses
      const cancerType = isIdentifyQuestion ? detectCancerType(dto.userText) : null;
      
      // Generate response with Explain Mode prompt
      let responseText = await this.llm.generateWithCitations(
        "explain",
        "",
        dto.userText,
        evidenceChunks,
        isIdentifyQuestion,
        { hasGenerallyAsking, cancerType }
      );

      // Structure with explainModeFrame
      responseText = ResponseTemplates.explainModeFrame(responseText, dto.userText, evidenceChunks);

      // Validate response for ungrounded medical entities
      const validationResult = this.responseValidator.validate(responseText, evidenceChunks);
      if (validationResult.shouldAbstain) {
        this.logger.warn(
          `Response contains ungrounded entities: ${validationResult.ungroundedEntities.map(e => e.entity).join(", ")}`
        );
        // Check for red flags in user text
        const hasRedFlags = /\b(bleeding|blood|severe|emergency|urgent|difficulty breathing|chest pain|fainting)\b/i.test(dto.userText);
        const abstentionResponse = this.responseValidator.generateAbstentionResponse(hasRedFlags);
        
        const assistant = await this.prisma.message.create({
          data: {
            sessionId: dto.sessionId,
            role: "assistant",
            text: abstentionResponse,
            safetyClassification: "normal",
            kbDocIds: [],
            latencyMs: Date.now() - started,
            evidenceQuality: gateResult.quality,
            evidenceGatePassed: false
          }
        });

        await this.analytics.emit("abstention_response", {
          reason: "ungrounded_entities",
          ungroundedEntities: validationResult.ungroundedEntities.map(e => e.entity),
          intent: intentResult.intent,
          queryType
        }, dto.sessionId);

        return {
          sessionId: dto.sessionId,
          messageId: assistant.id,
          responseText: assistant.text,
          safety: { classification: "normal" as const, actions: [] },
          abstentionReason: "ungrounded_entities"
        };
      }

      // Validate identify question responses
      if (isIdentifyQuestion) {
        const validation = this.passesIdentifyRubric(responseText);
        if (!validation.ok) {
          this.logger.warn(`Identify response missing elements: ${validation.missing.join(", ")}`);
          // Regenerate with stricter prompt (cancerType already detected above)
          responseText = await this.llm.generateWithCitations(
            "explain",
            "",
            dto.userText,
            evidenceChunks,
            true,
            { hasGenerallyAsking, cancerType }
          );
          responseText = ResponseTemplates.explainModeFrame(responseText, dto.userText, evidenceChunks);
          
          // Re-validate after regeneration
          const revalidationResult = this.responseValidator.validate(responseText, evidenceChunks);
          if (revalidationResult.shouldAbstain) {
            this.logger.warn(`Regenerated response still contains ungrounded entities`);
            const hasRedFlags = /\b(bleeding|blood|severe|emergency|urgent|difficulty breathing|chest pain|fainting)\b/i.test(dto.userText);
            const abstentionResponse = this.responseValidator.generateAbstentionResponse(hasRedFlags);
            
            const assistant = await this.prisma.message.create({
              data: {
                sessionId: dto.sessionId,
                role: "assistant",
                text: abstentionResponse,
                safetyClassification: "normal",
                kbDocIds: [],
                latencyMs: Date.now() - started,
                evidenceQuality: gateResult.quality,
                evidenceGatePassed: false
              }
            });

            return {
              sessionId: dto.sessionId,
              messageId: assistant.id,
              responseText: assistant.text,
              safety: { classification: "normal" as const, actions: [] },
              abstentionReason: "ungrounded_entities"
            };
          }
        }
      }

      // Apply response formatting rules (E1, E2, E3)
      // Determine hasResolvedAnswer: true if we have a complete answer with citations
      const hasResolvedAnswer = citations.length >= 2 && citationValidation.confidenceLevel !== "RED";
      // Determine isMultiStepInteraction: true if this is a follow-up after clarification
      const recentAssistantMessages = await this.prisma.message.findMany({
        where: {
          sessionId: dto.sessionId,
          role: "assistant"
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { text: true }
      });
      const isMultiStepInteraction = recentAssistantMessages.some(m => m.text.includes("?"));
      
      responseText = ResponseFormatter.formatResponse(responseText, "explain", hasResolvedAnswer, isMultiStepInteraction);

      // Extract and validate citations
      let citations = this.citationService.extractCitations(responseText, evidenceChunks);
      
      // Log citation extraction results for debugging
      this.logger.log(`Extracted ${citations.length} citations from response. Response length: ${responseText.length}. Evidence chunks available: ${evidenceChunks.length}`);
      if (citations.length === 0 && evidenceChunks.length > 0) {
        // Check if response contains citation-like patterns that weren't matched
        const citationLikePatterns = responseText.match(/\[citation[^\]]*\]/gi);
        if (citationLikePatterns && citationLikePatterns.length > 0) {
          this.logger.warn(`Found ${citationLikePatterns.length} citation-like patterns but none matched: ${citationLikePatterns.slice(0, 3).join(", ")}`);
        } else {
          this.logger.warn(`No citation patterns found in response. Response preview: ${responseText.substring(0, 200)}...`);
        }
      }
      
      // Ensure minimum 2 citations for general education identify questions
      if (isIdentifyQuestion && hasGenerallyAsking && citations.length < 2) {
        this.logger.warn(`Only ${citations.length} citations for identify question, expected 2+`);
      }
      
      // For identify questions with general intent, pass flag to allow 0 citations with YELLOW
      const isIdentifyWithGeneralIntent = isIdentifyQuestion && hasGenerallyAsking;
      let citationValidation = this.citationService.validateCitations(
        citations, 
        evidenceChunks, 
        responseText,
        isIdentifyWithGeneralIntent
      );

      // Handle citation validation
      if (citationValidation.confidenceLevel === "RED") {
        this.logger.warn(`Citation validation RED: ${citationValidation.errors?.join(", ")}`);
        responseText = await this.llm.generateWithCitations("explain", "", dto.userText, evidenceChunks, isIdentifyQuestion, { hasGenerallyAsking, cancerType });
        responseText = ResponseTemplates.explainModeFrame(responseText, dto.userText, evidenceChunks);
        citations = this.citationService.extractCitations(responseText, evidenceChunks);
        citationValidation = this.citationService.validateCitations(
          citations, 
          evidenceChunks, 
          responseText,
          isIdentifyWithGeneralIntent
        );

        // For identify questions with general intent, allow response even if citations are RED (with strong disclaimer)
        if (citationValidation.confidenceLevel === "RED") {
          if (isIdentifyWithGeneralIntent) {
            // Allow response with strong disclaimer - don't abstain for identify questions with general intent
            this.logger.warn("Identify question with general intent has 0 citations after retry - allowing with strong disclaimer");
            citationValidation = {
              ...citationValidation,
              confidenceLevel: "YELLOW", // Override to YELLOW to allow response
              isValid: true
            };
          } else {
            // Non-identify questions: abstain as before
            const clarifyingQuestion = this.evidenceGate.generateClarifyingQuestion(dto.userText, queryType);
            const assistant = await this.prisma.message.create({
              data: {
                sessionId: dto.sessionId,
                role: "assistant",
                text: clarifyingQuestion,
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
      }

      // Handle YELLOW confidence
      if (citationValidation.confidenceLevel === "YELLOW") {
        // For identify questions with 0 citations, use stronger disclaimer
        if (isIdentifyWithGeneralIntent && citations.length === 0) {
          const strongDisclaimer = "**Important Note:** This information is provided for general educational purposes. I was unable to verify all sources with citations. Please consult with your healthcare provider for accurate, personalized medical information.\n\n";
          responseText = strongDisclaimer + responseText;
        } else {
          const uncertaintyPreamble = "**Note:** I have limited source material on this specific aspect, so this answer may not be comprehensive. Please verify with your healthcare provider.\n\n";
          responseText = uncertaintyPreamble + responseText;
        }
      }

      // Store assistant message
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

      // Store citations
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
        evidenceQuality: gateResult.quality,
        queryType,
        mode,
        intent: intentResult.intent
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

    // Navigate Mode: Template structure + RAG if available
    if (mode === "navigate" && intentResult.intent === "PERSONAL_SYMPTOMS") {
      // Use navigateModeFrame for structure
      let responseText = ResponseTemplates.navigateModeFrame(dto.userText);
      
      // If we have RAG chunks, add context
      if (evidenceChunks.length > 0) {
        // Generate brief context from RAG
        const ragContext = await this.llm.generateWithCitations(
          "navigate",
          "",
          `Provide brief context about ${dto.userText} to help frame the response. Keep it to 1-2 sentences.`,
          evidenceChunks.slice(0, 2)
        );
        responseText = ragContext + "\n\n" + responseText;
        
        // Validate response for ungrounded medical entities
        const validationResult = this.responseValidator.validate(responseText, evidenceChunks);
        if (validationResult.shouldAbstain) {
          this.logger.warn(
            `Navigate mode response contains ungrounded entities: ${validationResult.ungroundedEntities.map(e => e.entity).join(", ")}`
          );
          // Remove ungrounded context and use template only
          responseText = ResponseTemplates.navigateModeFrame(dto.userText);
        }
      }

      // Apply response formatting rules
      // For navigate mode, determine if this is a multi-step interaction
      const recentAssistantMessages = await this.prisma.message.findMany({
        where: {
          sessionId: dto.sessionId,
          role: "assistant"
        },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { text: true }
      });
      const isMultiStepInteraction = recentAssistantMessages.some(m => m.text.includes("?"));
      const hasResolvedAnswer = evidenceChunks.length > 0; // Navigate mode has answer if RAG chunks available
      
      responseText = ResponseFormatter.formatResponse(responseText, "navigate", hasResolvedAnswer, isMultiStepInteraction);

      const assistant = await this.prisma.message.create({
        data: {
          sessionId: dto.sessionId,
          role: "assistant",
          text: responseText,
          safetyClassification: "normal",
          kbDocIds: evidenceChunks.length > 0 ? kbDocIds : [],
          latencyMs: Date.now() - started,
          evidenceQuality: gateResult.quality,
          evidenceGatePassed: !gateResult.shouldAbstain
        }
      });

      await this.analytics.emit("navigate_mode_response", {
        intent: intentResult.intent,
        queryType,
        mode
      }, dto.sessionId);

      return {
        sessionId: dto.sessionId,
        messageId: assistant.id,
        responseText: assistant.text,
        safety: { classification: "normal" as const, actions: [] }
      };
    }

    // Fallback: Other intents (REPORT_TEXT_PROVIDED, etc.) - use existing LLM flow
    // 8. Generate response with citations (legacy flow for non-informational intents)
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

  /**
   * Validate identify question responses against rubric requirements
   * Checks for: biopsy mention, timeline, warning signs count, tests count, doctor questions count
   */
  private passesIdentifyRubric(text: string): { ok: boolean; missing: string[] } {
    const missing: string[] = [];

    // Check for biopsy mention
    const hasBiopsy = /\bbiopsy\b/i.test(text);
    if (!hasBiopsy) missing.push("biopsy");

    // Check for timeline "2-4 weeks"
    const hasTimeline = /\b2\s*[–-]\s*4\s*weeks\b/i.test(text);
    if (!hasTimeline) missing.push("timeline 2–4 weeks");

    // Count warning signs (improved regex to capture all bullet lines)
    const warningSignsSection = text.match(/(?:warning signs?|signs? to watch|symptoms?)[\s\S]*?(?=\n\n|\*\*|$)/i);
    let warningSignsCount = 0;
    if (warningSignsSection) {
      // Split by lines and count those starting with bullet markers
      const lines = warningSignsSection[0].split(/\n/);
      warningSignsCount = lines.filter(line => {
        const trimmed = line.trim();
        return /^[-*•]\s+/.test(trimmed);
      }).length;
    }
    if (warningSignsCount < 5) missing.push(`>=5 warning signs (found ${warningSignsCount})`);

    // Count diagnostic tests (keyword matching)
    const testKeywords = [
      /\bclinical\b.*\bexam\b/i,
      /\bmammogram\b/i,
      /\bultrasound\b/i,
      /\bmri\b/i,
      /\bbiopsy\b/i
    ];
    const testsCount = testKeywords.filter(regex => regex.test(text)).length;
    if (testsCount < 3) missing.push(`>=3 diagnostic tests (found ${testsCount})`);

    // Count doctor questions (improved regex to capture all bullet lines)
    const questionsSection = text.match(/(?:questions? to ask|ask (?:your )?doctor|questions? for (?:your )?doctor)[\s\S]*?(?=\n\n|\*\*|$)/i);
    let doctorQsCount = 0;
    if (questionsSection) {
      // Split by lines and count those starting with bullet markers
      const lines = questionsSection[0].split(/\n/);
      doctorQsCount = lines.filter(line => {
        const trimmed = line.trim();
        return /^[-*•]\s+/.test(trimmed);
      }).length;
    }
    if (doctorQsCount < 5) missing.push(`>=5 doctor questions (found ${doctorQsCount})`);

    return { ok: missing.length === 0, missing };
  }
}
