import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { RetrievalService } from "../evidence_ingest/retrieval.service";
import { QueryExpanderService } from "../evidence_ingest/query-expander.service";
import { OpportunityService } from "../opportunity/opportunity.service";
import { AnswerGeneratorService } from "../application/answer-generator.service";
import { EmailNotificationService } from "../notifications/email-notification.service";
import type { FellowshipDraftOptions } from "./fellowship.types";
import type {
  FellowshipInterpretation,
  ApplicantNarrative,
  FellowshipBridge,
  SectionPlan,
} from "./fellowship-pipeline.types";
import { FELLOWSHIP_SYSTEM_PROMPT, buildFellowshipUserPrompt, matchArchetype } from "./prompts/fellowship.prompts";
import { rewriteToFirstPerson } from "./utils/voice-rewriter";
import { stripPipelineTags } from "./utils/tag-stripper";
import { OpportunityInterpreterService } from "./services/opportunity-interpreter.service";
import { BridgeSelectorService } from "./services/bridge-selector.service";
import { NarrativeSynthesizerService } from "./services/narrative-synthesizer.service";
import { SectionPlannerService } from "./services/section-planner.service";
import { FellowshipCriticService } from "./services/fellowship-critic.service";

const NON_ESSAY_PATTERNS = [
  /interest rat/i, /focus area.*rating/i, /fields of expertise/i,
  /availability/i, /online course/i, /additional comment/i,
  /select.*field/i, /rate your interest/i,
];

function isNonEssaySection(name: string, guidance: string): boolean {
  const combined = `${name} ${guidance}`;
  return NON_ESSAY_PATTERNS.some((p) => p.test(combined));
}

@Injectable()
export class FellowshipService {
  private readonly logger = new Logger(FellowshipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: FundingLlmService,
    private readonly retrieval: RetrievalService,
    private readonly queryExpander: QueryExpanderService,
    private readonly opportunityService: OpportunityService,
    private readonly answerGenerator: AnswerGeneratorService,
    private readonly emailNotification: EmailNotificationService,
    private readonly opportunityInterpreter: OpportunityInterpreterService,
    private readonly bridgeSelector: BridgeSelectorService,
    private readonly narrativeSynthesizer: NarrativeSynthesizerService,
    private readonly sectionPlanner: SectionPlannerService,
    private readonly fellowshipCritic: FellowshipCriticService,
  ) {}

  /**
   * Strategy-first fellowship pipeline (12 stages):
   *   Load Opportunity → Load Context
   *     → Stage A: Interpret Opportunity
   *     → Stage B: Synthesize Narrative Assets
   *     → Stage C: Select Bridge/Angle
   *     → Stage D: Plan Sections
   *     → For each section: (retrieve with plan-derived queries → write with brief → condense)
   *     → Stage E: Critic Review
   *     → Tag cleanup
   *     → Email
   */
  async generateFellowship(
    opportunityId: string,
    options?: FellowshipDraftOptions,
  ) {
    const runStart = Date.now();

    // 1. Load opportunity
    const opportunity = await this.opportunityService.findByOpportunityId(opportunityId);
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    const oppPayload = opportunity.jsonBlob.opportunity;
    const funderName = oppPayload.funder.name;
    const programName = oppPayload.funder.programName || funderName;
    const fellowshipName = `${programName} (${funderName})`;

    // 2. Extract sections from opportunity
    const rawSections = oppPayload.extractedRequirements?.sections || [];
    const sections = rawSections.map((s) => ({
      name: s.name,
      guidance: s.mustAnswer?.length ? s.mustAnswer.join("; ") : s.name,
      wordLimit: s.targetWords,
    }));

    if (sections.length === 0) {
      throw new NotFoundException(
        `No sections found for opportunity "${opportunityId}". Run extraction first.`,
      );
    }

    const maxSections = options?.maxSectionsOverride ?? sections.length;
    const sectionsToDraft = sections.slice(0, maxSections);

    this.logger.log({
      message: "FELLOWSHIP_PIPELINE_START",
      opportunityId,
      fellowshipName,
      sectionCount: sectionsToDraft.length,
    });

    // 3. Create ProposalRun record
    const run = await this.prisma.proposalRun.create({
      data: {
        opportunityId: opportunity.id,
        status: "drafting",
        modelConfig: {
          pipeline: "fellowship-v2",
          fellowshipName,
          model: process.env.FUNDING_MODEL_DRAFT || "deepseek-chat",
        } as object,
      },
    });

    // 4. Load personal context
    let applicantProfile = "";
    let pastAnswers = "";
    let dbSnippets = "";

    try {
      applicantProfile = this.answerGenerator.formatProfileForLLM();
    } catch (err) {
      this.logger.warn(`Failed to load applicant profile (non-fatal): ${(err as Error).message}`);
    }

    try {
      pastAnswers = await this.answerGenerator.fetchPastAnswers(
        [], // no specific questions — fetch all approved answers
        "fellowship",
      );
    } catch (err) {
      this.logger.warn(`Failed to load past answers (non-fatal, table may not exist): ${(err as Error).message}`);
    }

    try {
      dbSnippets = await this.answerGenerator.fetchDbSnippets();
    } catch (err) {
      this.logger.warn(`Failed to load DB snippets (non-fatal): ${(err as Error).message}`);
    }

    this.logger.log({
      message: "FELLOWSHIP_CONTEXT_LOADED",
      profileLength: applicantProfile.length,
      pastAnswersLength: pastAnswers.length,
      dbSnippetsLength: dbSnippets.length,
    });

    // Combine profile with DB snippets
    const fullProfile = dbSnippets
      ? `${applicantProfile}\n\nADDITIONAL SNIPPETS:\n${dbSnippets}`
      : applicantProfile;

    // --- Stage A: Interpret Opportunity ---
    let interpretation: FellowshipInterpretation | undefined;
    try {
      const oppSummary = oppPayload.extractedRequirements?.summary || "";
      const themes = [
        ...(oppPayload.themes?.primary || []),
        ...(oppPayload.themes?.secondary || []),
      ];
      const evalCriteria = oppPayload.extractedRequirements?.evaluationCriteria;

      interpretation = await this.opportunityInterpreter.interpret({
        fellowshipName,
        summary: oppSummary,
        sections: sectionsToDraft.map((s) => ({ name: s.name, guidance: s.guidance })),
        themes,
        evaluationCriteria: evalCriteria,
      });

      this.logger.log({
        message: "FELLOWSHIP_STAGE_A_COMPLETE",
        intellectualCore: interpretation.intellectualCore?.substring(0, 100),
      });
    } catch (err) {
      this.logger.warn(`Stage A (interpret) failed (non-fatal, falling back): ${(err as Error).message}`);
    }

    // --- Stage B: Synthesize Narrative Assets ---
    let narrative: ApplicantNarrative | undefined;
    try {
      if (interpretation) {
        narrative = await this.narrativeSynthesizer.synthesize({
          applicantProfile: fullProfile,
          pastAnswers,
          dbSnippets,
          interpretation,
        });

        this.logger.log({
          message: "FELLOWSHIP_STAGE_B_COMPLETE",
          leadershipExamples: narrative.leadershipExamples?.length,
          numericFacts: narrative.numericFacts?.length,
        });
      }
    } catch (err) {
      this.logger.warn(`Stage B (narrative) failed (non-fatal): ${(err as Error).message}`);
    }

    // --- Stage C: Select Bridge/Angle ---
    let bridge: FellowshipBridge | undefined;
    try {
      if (interpretation) {
        bridge = await this.bridgeSelector.selectBridge({
          interpretation,
          applicantProfile: fullProfile,
          pastAnswers,
          sectionNames: sectionsToDraft.map((s) => s.name),
        });

        // Store bridge thesis in run metadata
        await this.prisma.proposalRun.update({
          where: { id: run.id },
          data: {
            modelConfig: {
              pipeline: "fellowship-v2",
              fellowshipName,
              model: process.env.FUNDING_MODEL_DRAFT || "deepseek-chat",
              bridgeThesis: bridge.thesis,
              bridgeType: bridge.bridgeType,
            } as object,
          },
        });

        this.logger.log({
          message: "FELLOWSHIP_STAGE_C_COMPLETE",
          thesis: bridge.thesis?.substring(0, 120),
        });
      }
    } catch (err) {
      this.logger.warn(`Stage C (bridge) failed (non-fatal): ${(err as Error).message}`);
    }

    // --- Stage D: Plan Sections ---
    let sectionPlan: SectionPlan | undefined;
    try {
      if (bridge && narrative && interpretation) {
        sectionPlan = await this.sectionPlanner.plan({
          bridge,
          narrative,
          interpretation,
          sections: sectionsToDraft.map((s) => ({
            name: s.name,
            guidance: s.guidance,
            wordLimit: s.wordLimit,
            archetype: matchArchetype(s.name),
          })),
        });

        this.logger.log({
          message: "FELLOWSHIP_STAGE_D_COMPLETE",
          plannedSections: sectionPlan.sections?.length,
        });
      }
    } catch (err) {
      this.logger.warn(`Stage D (plan) failed (non-fatal): ${(err as Error).message}`);
    }

    // 5. Draft each section with cross-section context accumulator
    const sectionSummaries: string[] = [];
    const concurrency = 3;

    for (let i = 0; i < sectionsToDraft.length; i += concurrency) {
      const batch = sectionsToDraft.slice(i, i + concurrency);
      const previousSummaries = [...sectionSummaries]; // snapshot for this batch

      const batchSummaries = await Promise.all(
        batch.map((section) => {
          // Look up section plan entry if available
          const planEntry = sectionPlan?.sections?.find(
            (p) => p.name.toLowerCase() === section.name.toLowerCase(),
          );

          return this.draftSection(
            run.id,
            section,
            fullProfile,
            pastAnswers,
            fellowshipName,
            previousSummaries,
            options,
            bridge,
            planEntry,
          );
        }),
      );

      // Accumulate summaries for subsequent batches
      sectionSummaries.push(...batchSummaries.filter(Boolean) as string[]);
    }

    // --- Stage E: Critic Review (non-blocking) ---
    if (!options?.skipCritic && interpretation && bridge) {
      try {
        const draftedForCritic = await this.prisma.proposalSection.findMany({
          where: { runId: run.id, status: "drafted" },
          orderBy: { createdAt: "asc" },
        });

        const criticSections = draftedForCritic
          .filter((s) => s.draftText)
          .map((s) => ({ name: s.name, text: s.draftText! }));

        if (criticSections.length > 0) {
          const criticResult = await this.fellowshipCritic.review({
            interpretation,
            bridge,
            sections: criticSections,
            verifiedFacts: narrative?.numericFacts,
          });

          // Store critic score in run metadata
          const currentConfig = (run.modelConfig as Record<string, unknown>) || {};
          await this.prisma.proposalRun.update({
            where: { id: run.id },
            data: {
              modelConfig: {
                ...currentConfig,
                criticScore: criticResult.overallScore,
                criticDimensions: criticResult.dimensions?.map(
                  (d) => `${d.dimension}:${d.score}`,
                ),
              } as object,
            },
          });

          this.logger.log({
            message: "FELLOWSHIP_STAGE_E_COMPLETE",
            overallScore: criticResult.overallScore,
            tagViolations: criticResult.tagViolations?.length,
          });
        }
      } catch (err) {
        this.logger.warn(`Stage E (critic) failed (non-fatal): ${(err as Error).message}`);
      }
    }

    // --- Tag Cleanup: Strip pipeline tags from DB-stored draftText ---
    try {
      const allSections = await this.prisma.proposalSection.findMany({
        where: { runId: run.id, status: "drafted" },
      });

      for (const sec of allSections) {
        if (sec.draftText) {
          const cleaned = stripPipelineTags(sec.draftText);
          if (cleaned !== sec.draftText) {
            await this.prisma.proposalSection.update({
              where: { id: sec.id },
              data: { draftText: cleaned },
            });
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Tag cleanup failed (non-fatal): ${(err as Error).message}`);
    }

    // 6. Send email notification with fellowship draft
    try {
      const draftedSections = await this.prisma.proposalSection.findMany({
        where: { runId: run.id, status: "drafted" },
        orderBy: { createdAt: "asc" },
      });

      const allGaps: string[] = [];
      const emailLines: string[] = [
        "FELLOWSHIP DRAFT COMPLETE",
        "=".repeat(50),
        "",
        `Fellowship: ${fellowshipName}`,
        `Opportunity ID: ${opportunityId}`,
        `Run ID: ${run.id}`,
        `Sections: ${draftedSections.length}`,
      ];

      if (bridge) {
        emailLines.push(`Strategic Thesis: ${bridge.thesis}`);
      }
      emailLines.push("");

      for (const sec of draftedSections) {
        const wordCount = sec.draftText?.split(/\s+/).length ?? 0;
        emailLines.push(`${"─".repeat(50)}`);
        emailLines.push(`${sec.name} (${wordCount} words)`);
        emailLines.push(`${"─".repeat(50)}`);
        emailLines.push(sec.draftText || "[empty]");
        emailLines.push("");

        const sectionGaps = (sec.gaps as string[]) || [];
        allGaps.push(...sectionGaps);
      }

      if (allGaps.length > 0) {
        emailLines.push("");
        emailLines.push(`⚠ GAPS REQUIRING MANUAL INPUT (${allGaps.length})`);
        emailLines.push("-".repeat(30));
        allGaps.forEach((g) => emailLines.push(`• ${g}`));
      }

      emailLines.push("");
      emailLines.push("Generated by Bodh AI Funding Bot");

      const emailResult = await this.emailNotification.sendGeneratedContent(
        "Fellowship Draft",
        fellowshipName,
        emailLines.join("\n"),
        undefined,
        { actorType: "agent", actorId: "fellowship_service_email" },
      );

      await this.opportunityService.appendAuditEvent(
        opportunity.id,
        "fellowship_email_delivery",
        emailResult.sent ? "allowed" : "blocked",
        {
          reason: emailResult.reason,
          guardDecision: emailResult.guardDecision,
          preview: emailResult.preview,
        },
      );

      this.logger.log({
        message: "FELLOWSHIP_EMAIL_SENT",
        runId: run.id,
        sent: emailResult.sent,
        reason: emailResult.reason,
      });
    } catch (err) {
      this.logger.warn(`Fellowship email delivery failed (non-fatal): ${(err as Error).message}`);
    }

    // 7. Mark run complete
    await this.prisma.proposalRun.update({
      where: { id: run.id },
      data: {
        status: "complete",
      },
    });

    const elapsed = Date.now() - runStart;
    this.logger.log({
      message: "FELLOWSHIP_PIPELINE_COMPLETE",
      runId: run.id,
      sectionCount: sectionsToDraft.length,
      elapsed_ms: elapsed,
    });

    return this.prisma.proposalRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { sections: true },
    });
  }

  /**
   * Draft a single fellowship section using strategy-first context when available.
   * Falls back to original behavior if bridge/plan are not provided.
   */
  private async draftSection(
    runId: string,
    section: { name: string; guidance: string; wordLimit?: number },
    applicantProfile: string,
    pastAnswers: string,
    fellowshipName: string,
    previousSummaries: string[],
    options?: FellowshipDraftOptions,
    bridge?: FellowshipBridge,
    planEntry?: SectionPlan["sections"][0],
  ): Promise<string | null> {
    const sectionStart = Date.now();

    // Create section record
    const sectionRecord = await this.prisma.proposalSection.create({
      data: {
        runId,
        name: section.name,
        targetWords: section.wordLimit ?? 400,
        status: "pending",
      },
    });

    try {
      // Short-answer path for non-essay sections (checkboxes, ratings, etc.)
      if (isNonEssaySection(section.name, section.guidance)) {
        this.logger.log({
          message: "FELLOWSHIP_NON_ESSAY_SECTION",
          section: section.name,
        });

        const shortPrompt = `Based on this applicant profile, answer the following question in 1-3 concise sentences.\n\nProfile:\n${applicantProfile}\n\nQuestion: ${section.name}\nGuidance: ${section.guidance}\n\nRespond as Gautam Gauri in first person. Be specific and direct.`;
        let shortAnswer = await this.llm.generatePlain(
          "You are answering a short-answer field on a fellowship application form. Be concise and specific.",
          "Answer this question:",
          shortPrompt,
          { maxTokens: 300 },
        );
        shortAnswer = rewriteToFirstPerson(shortAnswer);

        await this.prisma.proposalSection.update({
          where: { id: sectionRecord.id },
          data: {
            draftText: shortAnswer,
            status: "drafted",
            gaps: [] as unknown as object,
          },
        });

        return `- ${section.name}: [short-answer section]`;
      }

      // a. Build retrieval queries: use plan-derived hints when available, else original approach
      let queries: string[];
      if (planEntry?.retrievalHints?.length) {
        queries = planEntry.retrievalHints;
      } else {
        const baseQuery = `${section.name} ${section.guidance}`.substring(0, 200);
        const expandedQuery = this.queryExpander.expandQuery(baseQuery, section.name);
        queries = [baseQuery];
        if (expandedQuery !== baseQuery) {
          queries.push(expandedQuery);
        }
        queries.push(`Gautam Gauri ${section.name} experience background`);
      }

      // b. Retrieve from personal corpus only
      const allChunks = await Promise.all(
        queries.map((q) =>
          this.retrieval.retrieve(q, {
            mode: "proposal_drafting",
            orgId: "gautam",
            corpus: ["personal"],
            limit: 5,
            minScore: 0.3,
          }),
        ),
      );

      // Deduplicate by chunk ID, keep highest-scored version
      const chunkMap = new Map<string, (typeof allChunks)[0][0]>();
      for (const chunks of allChunks) {
        for (const chunk of chunks) {
          const existing = chunkMap.get(chunk.id);
          if (!existing || (chunk.score ?? 0) > (existing.score ?? 0)) {
            chunkMap.set(chunk.id, chunk);
          }
        }
      }
      const dedupedChunks = [...chunkMap.values()]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5);

      this.logger.log({
        message: "FELLOWSHIP_RETRIEVAL",
        section: section.name,
        queries: queries.length,
        totalRetrieved: allChunks.flat().length,
        deduped: dedupedChunks.length,
        usedPlanHints: !!planEntry?.retrievalHints?.length,
      });

      // c. Look up archetype and build cross-section summary
      const archetype = matchArchetype(section.name);
      const previousSectionsSummary = previousSummaries.length > 0
        ? previousSummaries.join("\n")
        : undefined;

      // d. Assemble prompt with strategy-first context
      const userPrompt = buildFellowshipUserPrompt({
        pastAnswers,
        applicantProfile,
        chunks: dedupedChunks,
        sectionName: section.name,
        sectionGuidance: section.guidance,
        wordLimit: section.wordLimit,
        fellowshipName,
        archetype,
        previousSectionsSummary,
        bridgeThesis: bridge?.thesis,
        applicantBringsToFellowship: bridge?.applicantBringsToFellowship,
        sectionAnchor: bridge?.sectionAnchors?.[section.name],
        sectionPlan: planEntry ? {
          thesis: planEntry.thesis,
          openingMove: planEntry.openingMove,
          assignedFacts: planEntry.assignedFacts || [],
          mustAvoidFrom: planEntry.mustAvoidFrom || [],
        } : undefined,
      });

      // e. Call LLM with minimal system prompt
      let draftText = await this.llm.generatePlain(
        FELLOWSHIP_SYSTEM_PROMPT,
        "Write this fellowship section:",
        userPrompt,
        { maxTokens: 4000 },
      );

      // f. Apply voice rewriter safety net
      draftText = rewriteToFirstPerson(draftText);

      // g. Condensation pass: if word count exceeds limit × 1.15, compress
      if (section.wordLimit && section.wordLimit > 0) {
        const wordCount = draftText.split(/\s+/).length;
        if (wordCount > Math.ceil(section.wordLimit * 1.15)) {
          draftText = await this.condenseSection(draftText, section.wordLimit, section.name);
        }
      }

      // Extract gaps
      const gapMatches = draftText.match(/\{\{MISSING:\s*([^}]+)\}\}/gi);
      const gaps = gapMatches
        ? gapMatches.map((m) => m.replace(/\{\{MISSING:\s*|\}\}/gi, "").trim())
        : [];

      const elapsed = Date.now() - sectionStart;
      this.logger.log({
        message: "FELLOWSHIP_SECTION_DRAFTED",
        section: section.name,
        draftLength: draftText.length,
        gaps: gaps.length,
        chunksUsed: dedupedChunks.length,
        elapsed_ms: elapsed,
      });

      // h. Store
      await this.prisma.proposalSection.update({
        where: { id: sectionRecord.id },
        data: {
          draftText,
          status: "drafted",
          gaps: gaps as unknown as object,
        },
      });

      // Return a one-line summary for cross-section dedup
      const firstSentence = draftText.split(/[.!?]\s/)[0] ?? "";
      return `- ${section.name}: ${firstSentence.substring(0, 120)}`;
    } catch (err) {
      this.logger.error(
        `Fellowship section "${section.name}" failed: ${(err as Error).message}`,
      );
      await this.prisma.proposalSection.update({
        where: { id: sectionRecord.id },
        data: {
          draftText: `## ${section.name}\n\nError: ${(err as Error).message}`,
          status: "failed",
        },
      });
      return null;
    }
  }

  /**
   * Condense an over-length fellowship section to the target word count.
   */
  private async condenseSection(
    draftText: string,
    targetWords: number,
    sectionName: string,
  ): Promise<string> {
    const originalWordCount = draftText.split(/\s+/).length;
    const prompt = `Condense the following fellowship section to exactly ${targetWords} words or fewer.

RULES:
- Keep personal anecdotes, specific details (names, dates, numbers), and citations [citation:...].
- Cut generic statements, repeated project descriptions, and any budget references.
- Maintain first-person singular voice throughout.
- Do NOT add new content — only cut and tighten existing text.
- Output ONLY the condensed section text, no preamble.

SECTION "${sectionName}":
${draftText}`;

    const condensed = await this.llm.generatePlain(
      "You are a precise editor. Condense text to the target word count while preserving voice and specifics.",
      "Condense this section:",
      prompt,
      { maxTokens: 4000 },
    );

    const condensedWordCount = condensed.split(/\s+/).length;
    this.logger.log({
      message: "FELLOWSHIP_CONDENSATION",
      section: sectionName,
      originalWords: originalWordCount,
      condensedWords: condensedWordCount,
      targetWords,
    });

    return condensed;
  }
}
