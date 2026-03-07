import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { RetrievalService } from "../evidence_ingest/retrieval.service";
import { QueryExpanderService } from "../evidence_ingest/query-expander.service";
import { OpportunityService } from "../opportunity/opportunity.service";
import { AnswerGeneratorService } from "../application/answer-generator.service";
import type { FellowshipDraftOptions } from "./fellowship.types";
import { FELLOWSHIP_SYSTEM_PROMPT, buildFellowshipUserPrompt, matchArchetype } from "./prompts/fellowship.prompts";
import { rewriteToFirstPerson } from "./utils/voice-rewriter";

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
  ) {}

  /**
   * Generate a fellowship proposal with all-personal context.
   * Key difference from ProposalService: NO org profile, NO org-centric guidance.
   * All context is personal (profile, past answers, personal corpus).
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

    // 3. Create ProposalRun record (reuse existing model for eval compatibility)
    const run = await this.prisma.proposalRun.create({
      data: {
        opportunityId: opportunity.id,
        status: "drafting",
        modelConfig: {
          pipeline: "fellowship",
          fellowshipName,
          model: process.env.FUNDING_MODEL_DRAFT || "deepseek-chat",
        } as object,
      },
    });

    // 4. Load personal context (proven first-person builders from AnswerGeneratorService)
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

    // 5. Draft each section with cross-section context accumulator
    const sectionSummaries: string[] = [];
    const concurrency = 3;

    for (let i = 0; i < sectionsToDraft.length; i += concurrency) {
      const batch = sectionsToDraft.slice(i, i + concurrency);
      const previousSummaries = [...sectionSummaries]; // snapshot for this batch

      const batchSummaries = await Promise.all(
        batch.map((section) =>
          this.draftSection(
            run.id,
            section,
            fullProfile,
            pastAnswers,
            fellowshipName,
            previousSummaries,
            options,
          ),
        ),
      );

      // Accumulate summaries for subsequent batches
      sectionSummaries.push(...batchSummaries.filter(Boolean) as string[]);
    }

    // 6. Mark run complete
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
   * Draft a single fellowship section:
   *   1. Generate retrieval queries from section question
   *   2. Retrieve from personal corpus only (orgId: "gautam")
   *   3. Assemble all-personal context with archetype + cross-section dedup
   *   4. Call LLM with minimal system prompt
   *   5. Apply voice rewriter safety net
   *   6. Condensation pass if over word limit
   *   7. Store as ProposalSection
   *
   * Returns a one-line summary of the drafted section for cross-section dedup.
   */
  private async draftSection(
    runId: string,
    section: { name: string; guidance: string; wordLimit?: number },
    applicantProfile: string,
    pastAnswers: string,
    fellowshipName: string,
    previousSummaries: string[],
    options?: FellowshipDraftOptions,
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

      // a. Build retrieval queries: section question + 2 expanded variants
      const baseQuery = `${section.name} ${section.guidance}`.substring(0, 200);
      const expandedQuery = this.queryExpander.expandQuery(baseQuery, section.name);
      const queries = [baseQuery];
      if (expandedQuery !== baseQuery) {
        queries.push(expandedQuery);
      }
      // Add a personal-framing variant
      queries.push(`Gautam Gauri ${section.name} experience background`);

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
      });

      // c. Look up archetype and build cross-section summary
      const archetype = matchArchetype(section.name);
      const previousSectionsSummary = previousSummaries.length > 0
        ? previousSummaries.join("\n")
        : undefined;

      // d. Assemble prompt with all-personal context
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
