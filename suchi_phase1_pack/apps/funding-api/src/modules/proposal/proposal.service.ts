import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { OpportunityService } from "../opportunity/opportunity.service";
import { RetrievalService } from "../evidence_ingest/retrieval.service";
import { EvidenceChunk } from "../core_ai/types";
import { RfpParserService } from "./services/rfp-parser.service";
import { PlannerService } from "./services/planner.service";
import { QueryGeneratorService } from "./services/query-generator.service";
import { SectionWriterService } from "./services/section-writer.service";
import { QaReviewerService } from "./services/qa-reviewer.service";
import { ArtifactExporterService } from "./services/artifact-exporter.service";
import { SlackClientService } from "./services/slack-client.service";
import {
  ProposalRunStatus,
  ProposalSectionStatus,
  ProposalOutline,
  ProposalRunModelConfig,
  GenerateProposalOptions,
  RegenerateSectionOptions,
  ProposalGap,
  ProposalRunArtifacts,
} from "./proposal.types";

@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunityService: OpportunityService,
    private readonly retrieval: RetrievalService,
    private readonly rfpParser: RfpParserService,
    private readonly planner: PlannerService,
    private readonly queryGenerator: QueryGeneratorService,
    private readonly sectionWriter: SectionWriterService,
    private readonly qaReviewer: QaReviewerService,
    private readonly artifactExporter: ArtifactExporterService,
    private readonly slackClient: SlackClientService,
  ) {}

  /**
   * Generate full proposal from opportunity.
   */
  async generateProposal(opportunityId: string, options?: GenerateProposalOptions) {
    // 1. Load opportunity
    const opportunity = await this.opportunityService.findByOpportunityId(opportunityId);
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    const oppPayload = opportunity.jsonBlob.opportunity;
    const funderName = oppPayload.funder.name;
    const programName = oppPayload.funder.programName || "";

    // 2. Parse RFP if not already extracted
    let rfpText = "";
    if (oppPayload.source.attachments && oppPayload.source.attachments.length > 0) {
      // Extract text from first PDF/DOCX attachment if available
      // For now, use extracted requirements summary
      rfpText = oppPayload.extractedRequirements?.summary || "";
    }

    // Get org profile summary (placeholder - should come from a canonical org profile doc)
    const orgProfileSummary = `Organization: Diksha Foundation / SCCF\nPrograms: KHEL, Life Skills, Fellowship\nGeography: India (Bihar, Delhi, etc.)`;

    const userOverrides = options
      ? [
          options.focusGeography ? `Focus geography: ${options.focusGeography}` : "",
          options.targetGroup ? `Target group: ${options.targetGroup}` : "",
          options.budgetCeiling ? `Budget ceiling: ${options.budgetCeiling}` : "",
          options.dontMention?.length ? `Don't mention: ${options.dontMention.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

    // Create ProposalRun record
    const modelConfig: ProposalRunModelConfig = {
      planner: "deepseek-reasoner",
      writer: "deepseek-reasoner",
      reviewer: "deepseek-reasoner",
      retriever: "hybrid",
    };

    const run = await this.prisma.proposalRun.create({
      data: {
        opportunityId: opportunity.id,
        status: "planning",
        modelConfig: modelConfig as object,
      },
    });

    try {
      // 3. Generate outline + retrieval plan
      await this.slackClient.postProgress({
        opportunityId,
        stage: "planning",
        message: "Generating proposal outline...",
      });

      const outline = await this.planner.generateOutline({
        rfpText: rfpText || JSON.stringify(oppPayload.extractedRequirements || {}),
        orgProfileSummary,
        userOverrides,
        capabilityContext: options?.capabilityContext,
      });

      await this.prisma.proposalRun.update({
        where: { id: run.id },
        data: {
          outline: outline as object,
          retrievalPlan: outline.retrieval_plan as object,
          status: "drafting",
        },
      });

      // 4. For each section: generate queries, retrieve, draft
      const sectionsToDraft = options?.sectionOnly
        ? outline.outline.filter((s) => s.section.toLowerCase().includes(options.sectionOnly!.toLowerCase()))
        : outline.outline;

      const sectionGaps: Array<{ section: string; gaps: string[] }> = [];
      const allDraftTexts: string[] = [];
      const allEvidencePack: Array<{ chunkId: string; docId: string; text: string; title?: string }> = [];
      const citationMap: Record<string, string> = {};

      for (const sectionOutline of sectionsToDraft) {
        const sectionName = sectionOutline.section;
        this.logger.log(`Drafting section: ${sectionName}`);

        // Create ProposalSection record
        const sectionRecord = await this.prisma.proposalSection.create({
          data: {
            runId: run.id,
            name: sectionName,
            targetWords: sectionOutline.target_words,
            status: "pending",
          },
        });

        try {
          // Find retrieval plan for this section
          const retrievalPlanItem = outline.retrieval_plan.find((r) => r.section === sectionName);

          // Generate queries
          const queries = await this.queryGenerator.generateQueries({
            sectionName,
            mustAnswer: sectionOutline.must_answer || [],
            evidenceTypes: retrievalPlanItem?.required_evidence_types || [],
          });

          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: { retrievalQueries: queries as object, status: "retrieved" },
          });

          // Retrieve chunks (combine results from all queries, limit to 8-12 per section)
          const allChunks = new Map<string, EvidenceChunk>();
          for (const query of queries.slice(0, 5)) {
            const chunks = await this.retrieval.retrieve(query, {
              mode: "proposal_drafting",
              limit: 3,
            });
            chunks.forEach((chunk) => {
              if (!allChunks.has(chunk.id)) {
                allChunks.set(chunk.id, {
                  chunkId: chunk.id,
                  docId: chunk.source,
                  content: chunk.text,
                  document: {
                    title: chunk.title || "",
                    url: chunk.urlOrPath,
                  },
                });
              }
            });
          }

          const evidenceChunks = Array.from(allChunks.values()).slice(0, 12);

          // Store retrieved chunks
          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: {
              retrievedChunks: evidenceChunks.map((c) => ({
                chunkId: c.chunkId,
                docId: c.docId,
              })) as object,
            },
          });

          // Draft section
          const sectionGuidance = `Target words: ${sectionOutline.target_words || 0}. Must answer: ${sectionOutline.must_answer.join(", ") || "N/A"}`;
          const { draftText, gaps } = await this.sectionWriter.draftSection({
            sectionName,
            sectionGuidance,
            chunks: evidenceChunks,
          });

          sectionGaps.push({ section: sectionName, gaps });
          allDraftTexts.push(draftText);

          // Extract citations
          const citationMatches = draftText.match(/\[citation:([^:]+):([^\]]+)\]/g);
          if (citationMatches) {
            citationMatches.forEach((match) => {
              const m = match.match(/\[citation:([^:]+):([^\]]+)\]/);
              if (m) {
                citationMap[match] = `${m[1]}:${m[2]}`;
              }
            });
          }

          // Add to evidence pack
          evidenceChunks.forEach((c) => {
            if (!allEvidencePack.find((e) => e.chunkId === c.chunkId)) {
              allEvidencePack.push({
                chunkId: c.chunkId,
                docId: c.docId,
                text: c.content.substring(0, 500),
                title: c.document.title,
              });
            }
          });

          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: {
              draftText,
              citations: Object.keys(citationMap).map((marker) => ({
                inlineMarker: marker,
                chunkId: citationMap[marker].split(":")[1],
                docId: citationMap[marker].split(":")[0],
              })) as object,
              gaps: gaps as object,
              status: "drafted",
            },
          });
        } catch (e) {
          this.logger.error(`Failed to draft section ${sectionName}`, (e as Error).message);
          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: {
              draftText: `Error: ${(e as Error).message}`,
              status: "drafted",
            },
          });
        }
      }

      // 5. Run QA review
      await this.slackClient.postProgress({
        opportunityId,
        stage: "qa",
        message: "Running QA review...",
      });

      const fullDraftText = allDraftTexts.join("\n\n");
      const requirementsJson = JSON.stringify({
        sections: outline.outline,
        compliance: outline.compliance_checklist,
        evaluationCriteria: oppPayload.extractedRequirements?.evaluationCriteria || [],
      });

      const qaResult = await this.qaReviewer.reviewProposal({
        requirementsJson,
        draftText: fullDraftText,
        citationMap: JSON.stringify(citationMap),
      });

      // Extract gaps
      const gaps = this.qaReviewer.extractGaps(qaResult, sectionGaps);

      await this.prisma.proposalRun.update({
        where: { id: run.id },
        data: {
          complianceReport: qaResult as object,
          gaps: gaps as object,
          status: "qa",
        },
      });

      // 6. Export artifacts
      if (opportunity.driveFolderId && this.artifactExporter.isConfigured()) {
        await this.slackClient.postProgress({
          opportunityId,
          stage: "export",
          message: "Exporting artifacts to Drive...",
        });

        const artifacts = await this.artifactExporter.exportArtifacts({
          opportunityFolderId: opportunity.driveFolderId,
          runId: run.id,
          draftText: fullDraftText,
          evidencePack: allEvidencePack,
          runLog: {
            runId: run.id,
            opportunityId,
            outline,
            modelConfig,
            createdAt: run.createdAt.toISOString(),
          },
          complianceReport: qaResult as unknown as Record<string, unknown>,
          funderName,
          programName,
        });

        await this.prisma.proposalRun.update({
          where: { id: run.id },
          data: { artifacts: artifacts as object },
        });
      }

      // 7. Send Slack summary
      await this.slackClient.postSummary({
        opportunityId,
        funderName,
        status: "complete",
        artifacts: opportunity.driveFolderId && this.artifactExporter.isConfigured()
          ? (await this.prisma.proposalRun.findUnique({ where: { id: run.id } }))?.artifacts as ProposalRunArtifacts | undefined
          : undefined,
        gaps,
        coverageScore: qaResult.coverage_score,
      });

      // 8. Update status to complete
      await this.prisma.proposalRun.update({
        where: { id: run.id },
        data: { status: "complete" },
      });

      // Update opportunity status
      await this.opportunityService.update(opportunity.id, {
        status: "draft_generated",
        missingInputs: gaps.length > 0 ? (gaps as Array<{ field: string; question: string; priority: string }>) : undefined,
      });

      return await this.prisma.proposalRun.findUnique({
        where: { id: run.id },
        include: { sections: true },
      });
    } catch (e) {
      this.logger.error("Proposal generation failed", (e as Error).message);
      await this.prisma.proposalRun.update({
        where: { id: run.id },
        data: { status: "failed" },
      });
      throw e;
    }
  }

  /**
   * Regenerate a single section.
   */
  async regenerateSection(runId: string, sectionName: string, options?: RegenerateSectionOptions) {
    const run = await this.prisma.proposalRun.findUnique({
      where: { id: runId },
      include: { sections: true, opportunity: true },
    });
    if (!run) {
      throw new NotFoundException(`ProposalRun ${runId} not found`);
    }

    const section = run.sections.find((s) => s.name === sectionName);
    if (!section) {
      throw new NotFoundException(`Section ${sectionName} not found in run ${runId}`);
    }

    const outline = run.outline as unknown as ProposalOutline | null;
    const sectionOutline = outline?.outline.find((s) => s.section === sectionName);
    if (!sectionOutline) {
      throw new NotFoundException(`Section outline for ${sectionName} not found`);
    }

    // Regenerate queries if needed
    const retrievalPlanItem = outline?.retrieval_plan.find((r) => r.section === sectionName);
    const queries = await this.queryGenerator.generateQueries({
      sectionName,
      mustAnswer: sectionOutline.must_answer || [],
      evidenceTypes: retrievalPlanItem?.required_evidence_types || [],
    });

    // Retrieve chunks
    const allChunks = new Map<string, EvidenceChunk>();
    for (const query of queries.slice(0, 5)) {
      const chunks = await this.retrieval.retrieve(query, {
        mode: "proposal_drafting",
        limit: 3,
      });
      chunks.forEach((chunk) => {
        if (!allChunks.has(chunk.id)) {
          allChunks.set(chunk.id, {
            chunkId: chunk.id,
            docId: chunk.source,
            content: chunk.text,
            document: {
              title: chunk.title || "",
              url: chunk.urlOrPath,
            },
          });
        }
      });
    }

    const evidenceChunks = Array.from(allChunks.values()).slice(0, 12);

    // Draft section with additional context
    const sectionGuidance = `${sectionOutline.target_words ? `Target words: ${sectionOutline.target_words}. ` : ""}Must answer: ${sectionOutline.must_answer.join(", ") || "N/A"}${options?.additionalContext ? `. Additional context: ${options.additionalContext}` : ""}${options?.userNotes ? `. User notes: ${options.userNotes}` : ""}`;

    const { draftText, gaps } = await this.sectionWriter.draftSection({
      sectionName,
      sectionGuidance,
      chunks: evidenceChunks,
    });

    // Update section
    await this.prisma.proposalSection.update({
      where: { id: section.id },
      data: {
        retrievalQueries: queries as object,
        retrievedChunks: evidenceChunks.map((c) => ({
          chunkId: c.chunkId,
          docId: c.docId,
        })) as object,
        draftText,
        gaps: gaps as object,
        status: "drafted",
      },
    });

    return await this.prisma.proposalSection.findUnique({
      where: { id: section.id },
    });
  }

  /**
   * Get proposal run by ID.
   */
  async getRun(runId: string) {
    const run = await this.prisma.proposalRun.findUnique({
      where: { id: runId },
      include: { sections: true, opportunity: true },
    });
    if (!run) {
      throw new NotFoundException(`ProposalRun ${runId} not found`);
    }
    return run;
  }

  /**
   * Get gaps for a proposal run.
   */
  async getGaps(runId: string): Promise<ProposalGap[]> {
    const run = await this.prisma.proposalRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new NotFoundException(`ProposalRun ${runId} not found`);
    }
    return (run.gaps as unknown as ProposalGap[]) || [];
  }
}
