import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { logStructured } from "../../common/structured-logger";
import { PrismaService } from "../prisma/prisma.service";
import { OpportunityService } from "../opportunity/opportunity.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { RetrievalService } from "../evidence_ingest/retrieval.service";
import { EvidenceChunk } from "../core_ai/types";
import { RfpParserService } from "./services/rfp-parser.service";
import { PlannerService } from "./services/planner.service";
import { QueryGeneratorService } from "./services/query-generator.service";
import { SectionWriterService } from "./services/section-writer.service";
import { QaReviewerService } from "./services/qa-reviewer.service";
import { ArtifactExporterService } from "./services/artifact-exporter.service";
import { SlackClientService } from "./services/slack-client.service";
import { CitationRepairService } from "./services/citation-repair.service";
import { EmailNotificationService } from "../notifications/email-notification.service";
import { GovernanceDeliveryGuard } from "../notifications/governance-delivery.guard";
import { ApprovalContextDto } from "./proposal.dto";
import { DIKSHA_ORG_PROFILE, PROGRAM_SNAPSHOT_MD } from "./prompts/org-profile";
import { resolveCitations } from "./utils/citation-resolver";
import { getCorpusRoute } from "./utils/corpus-router";
import { computeRetrievalConfidence } from "./utils/retrieval-confidence";
import {
  ProposalRunStatus,
  ProposalSectionStatus,
  ProposalOutline,
  ProposalScope,
  ProposalRunModelConfig,
  GenerateProposalOptions,
  RegenerateSectionOptions,
  ProposalGap,
  ProposalRunArtifacts,
} from "./proposal.types";
import { ApprovalConfirmationContract } from "../contracts/funding-contracts.types";
import { ActivityRegistryService } from "../activity_registry/activity-registry.service";

@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunityService: OpportunityService,
    private readonly pipelineService: PipelineService,
    private readonly retrieval: RetrievalService,
    private readonly rfpParser: RfpParserService,
    private readonly planner: PlannerService,
    private readonly queryGenerator: QueryGeneratorService,
    private readonly sectionWriter: SectionWriterService,
    private readonly qaReviewer: QaReviewerService,
    private readonly artifactExporter: ArtifactExporterService,
    private readonly slackClient: SlackClientService,
    private readonly citationRepair: CitationRepairService,
    private readonly emailNotification: EmailNotificationService,
    private readonly governanceGuard: GovernanceDeliveryGuard,
    private readonly activityRegistry: ActivityRegistryService,
  ) {}

  private mapApproval(approval?: ApprovalContextDto): ApprovalConfirmationContract | undefined {
    if (!approval?.approvalToken) return undefined;
    return {
      approvalToken: approval.approvalToken,
      interactionId: approval.interactionId || "api",
      outcome: approval.outcome || "approved",
      actor: approval.actor || { actorType: "human", actorId: "api_user" },
      reason: approval.reason,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate full proposal from opportunity.
   */
  async generateProposal(
    opportunityId: string,
    options?: GenerateProposalOptions,
    approval?: ApprovalContextDto
  ) {
    const runStart = Date.now();
    const mappedApproval = this.mapApproval(approval);
    // 1. Load opportunity
    const opportunity = await this.opportunityService.findByOpportunityId(opportunityId);
    if (!opportunity) {
      throw new NotFoundException(`Opportunity ${opportunityId} not found`);
    }

    // Gate: institutional opportunities must have funding lane set before draft/email
    if (opportunity.pipelineEntryId) {
      const pipelineEntry = await this.pipelineService.getEntry(
        opportunity.pipelineEntryId,
      );
      if (!pipelineEntry.fundingLane) {
        throw new BadRequestException(
          `Set funding lane for this org before generating proposal. Use /funding set-lane <org> <DOMESTIC_80G|CSR|FCRA>.`,
        );
      }
    }

    const oppPayload = opportunity.jsonBlob.opportunity;
    const funderName = oppPayload.funder.name;
    const programName = oppPayload.funder.programName || "";

    // Extract hard constraints from opportunity
    const grantCeilingINR: number | null = oppPayload.keyConstraints?.maxGrantAmountINR ?? null;
    const funderThemes: { primary?: string[]; secondary?: string[] } | null = oppPayload.themes ?? null;

    this.logger.log({
      diagnostic: "OPPORTUNITY_CONSTRAINTS",
      grantCeilingINR,
      funderThemesPrimary: funderThemes?.primary ?? [],
      funderThemesSecondary: funderThemes?.secondary ?? [],
    });

    // 2. Parse RFP if not already extracted
    let rfpText = "";
    if (oppPayload.source.attachments && oppPayload.source.attachments.length > 0) {
      // Extract text from first PDF/DOCX attachment if available
      // For now, use extracted requirements summary
      rfpText = oppPayload.extractedRequirements?.summary || "";
    }

    // Structured org profile from canonical source
    const orgProfileSummary = DIKSHA_ORG_PROFILE;

    // Budget ceiling: user-supplied takes priority, then auto-read from opportunity constraints
    const effectiveBudgetCeiling = options?.budgetCeiling
      || (grantCeilingINR ? `INR ${grantCeilingINR.toLocaleString("en-IN")}` : "");

    // Build activities context with capability mappings and latest metrics from fortnightly reports
    const activitiesContext = await this.activityRegistry.buildActivitiesContext("diksha");
    const activityFacts = await this.activityRegistry.buildActivityFacts("diksha");
    if (activitiesContext) {
      this.logger.log({
        diagnostic: "ACTIVITIES_CONTEXT_BUILT",
        contextLength: activitiesContext.length,
        preview: activitiesContext.substring(0, 200),
        hasActivityFacts: !!activityFacts,
        factsCenters: activityFacts?.centers,
      });
    }

    const userOverrides = [
      options?.focusGeography ? `Focus geography: ${options.focusGeography}` : "",
      options?.targetGroup ? `Target group: ${options.targetGroup}` : "",
      effectiveBudgetCeiling ? `Budget ceiling (HARD CONSTRAINT — do NOT exceed): ${effectiveBudgetCeiling}` : "",
      options?.dontMention?.length ? `Don't mention: ${options.dontMention.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Extract mandatory sections from opportunity (RfpSectionRequirement uses 'name', map to 'title')
    const rawSections = oppPayload.extractedRequirements?.sections || [];
    const mandatorySections: Array<{ title: string; description?: string }> =
      rawSections.map((s) => ({
        title: s.name,
        description: s.mustAnswer?.length ? s.mustAnswer.join("; ") : undefined,
      }));

    // === DIAGNOSTIC: Step A — log mandatory sections from opportunity ===
    this.logger.log({
      diagnostic: "STEP_A_OPPORTUNITY_SECTIONS",
      opportunityId,
      extractedRequirementsSectionsCount: rawSections.length,
      mandatorySectionsCount: mandatorySections.length,
      mandatorySectionTitles: mandatorySections.map((s) => s.title),
    });

    // === GATE 1: Hard fail if mandatory sections not extracted ===
    if (mandatorySections.length === 0) {
      throw new NotFoundException(
        `Cannot generate proposal: RFP sections not extracted for opportunity "${opportunityId}". ` +
        `Run extraction first or populate extractedRequirements.sections.`,
      );
    }

    // Create ProposalRun record
    const modelConfig: ProposalRunModelConfig = {
      planner: "deepseek-chat",
      writer: "deepseek-chat",
      reviewer: "deepseek-chat",
      retriever: "hybrid",
    };

    const run = await this.prisma.proposalRun.create({
      data: {
        opportunityId: opportunity.id,
        status: "planning",
        modelConfig: modelConfig as object,
      },
    });

    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/e36a6ac1-51ba-43e8-bd5c-a488ce3f53fd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "apps/funding-api/src/modules/proposal/proposal.service.ts:122",
        message: "PROPOSAL_DEBUG_RFP_AND_SECTIONS",
        data: {
          opportunityId,
          runId: run.id,
          funderName,
          programName,
          rfpTextLength: rfpText?.length ?? 0,
          hasAttachments: !!(oppPayload.source.attachments && oppPayload.source.attachments.length > 0),
          mandatorySectionCount: mandatorySections.length,
          mandatorySectionTitles: mandatorySections.map((s) => s.title),
        },
        timestamp: Date.now(),
        runId: run.id,
        hypothesisId: "H1_H2",
      }),
    }).catch(() => {});
    // #endregion

    try {
      // 3. Generate outline + retrieval plan
      await this.slackClient.postProgress({
        opportunityId,
        stage: "planning",
        message: "Generating proposal outline...",
        approval: mappedApproval,
      });

      const outline = await this.planner.generateOutline({
        rfpText: rfpText || JSON.stringify(oppPayload.extractedRequirements || {}),
        orgProfileSummary,
        userOverrides,
        capabilityContext: options?.capabilityContext,
        mandatorySections: mandatorySections.length > 0 ? mandatorySections : undefined,
        funderName,
        funderThemes: funderThemes ?? undefined,
        activitiesContext: activitiesContext || undefined,
      });

      // Log proposal scope if planner produced one
      if (outline.proposal_scope) {
        this.logger.log({
          diagnostic: "PLANNER_SCOPE_RAW",
          programName: outline.proposal_scope.programName,
          centersCount: outline.proposal_scope.centers.length,
          centers: outline.proposal_scope.centers.map(c => typeof c === "string" ? c : c.name),
          beneficiaries: outline.proposal_scope.totalDirectBeneficiaries,
          geography: outline.proposal_scope.geographicScope,
          grantPeriod: outline.proposal_scope.grantPeriod,
          budgetCeiling: outline.proposal_scope.budgetCeiling,
          deliverablesCount: outline.proposal_scope.deliverables?.length ?? 0,
          missingInputs: outline.proposal_scope.missing_inputs?.length ?? 0,
        });

        // === DETERMINISTIC REGISTRY FALLBACK ===
        // If planner missed fields that the activity registry clearly has, fill them from registry
        if (activityFacts) {
          const scope = outline.proposal_scope;
          const patched: string[] = [];

          // Centers: registry has specific center names
          const registryCenters = (activityFacts.centers as string[]) || [];
          const scopeCenterNames = scope.centers.map(c => typeof c === "string" ? c : c.name);
          const hasGenericCenters = scope.centers.length <= 1 || scopeCenterNames.some(n => /hub|center/i.test(n) && !/patna|bihta|sarai/i.test(n));
          if (registryCenters.length > scope.centers.length || hasGenericCenters) {
            scope.centers = registryCenters.map(name => ({ name }));
            patched.push(`centers: ${registryCenters.join(", ")}`);
          }

          // Beneficiaries: registry has total count. Also override if planner gave generic text without a number.
          const hasNumericBeneficiaries = scope.totalDirectBeneficiaries && /\d/.test(scope.totalDirectBeneficiaries);
          if (!hasNumericBeneficiaries && activityFacts.totalDirectBeneficiaries) {
            scope.totalDirectBeneficiaries = `${activityFacts.totalDirectBeneficiaries} students`;
            patched.push(`beneficiaries: ${scope.totalDirectBeneficiaries}`);
          }

          // Geography: infer from center names
          if (!scope.geographicScope && registryCenters.length > 0) {
            // Extract location hints from center names (e.g. "KHEL Patna" → "Patna")
            const locations = registryCenters.map(c => c.replace(/^KHEL\s*/i, "").trim()).filter(Boolean);
            scope.geographicScope = locations.length > 0 ? `${locations.join(", ")} — Bihar, India` : "Bihar, India";
            patched.push(`geography: ${scope.geographicScope}`);
          }

          // Staffing: registry has staff info
          const registryStaff = activityFacts.staffing as string[] | undefined;
          if (!scope.staffing && registryStaff?.length) {
            scope.staffing = { totalStaff: null, keyRoles: registryStaff };
            patched.push(`staffing: ${registryStaff.length} roles`);
          }

          if (patched.length > 0) {
            this.logger.log({
              diagnostic: "SCOPE_REGISTRY_FALLBACK",
              patched,
              message: `Patched ${patched.length} scope fields from activity registry`,
            });
          }
        }
      } else if (effectiveBudgetCeiling) {
        // Planner didn't produce a valid scope, but we have a budget ceiling constraint.
        // Inject a minimal scope so section writers at least respect the ceiling.
        this.logger.warn({
          diagnostic: "INJECTING_MINIMAL_SCOPE",
          budgetCeiling: effectiveBudgetCeiling,
          reason: "Planner did not produce a valid proposal_scope",
        });
        outline.proposal_scope = {
          programName: "",
          centers: [],
          totalDirectBeneficiaries: "",
          geographicScope: "",
          grantPeriod: "",
          budgetCeiling: effectiveBudgetCeiling,
          deliverables: [],
          keyDeliverables: [],
        };
      }

      // === GATE 2: Validate planner output contains all mandatory titles ===
      const plannedTitles = new Set(outline.outline.map((s) => s.section.toLowerCase().trim()));
      const mandatoryTitles = mandatorySections.map((s) => s.title);
      const missingFromPlan = mandatoryTitles.filter((t) => !plannedTitles.has(t.toLowerCase().trim()));
      const extraInPlan = outline.outline
        .map((s) => s.section)
        .filter((t) => !mandatoryTitles.some((m) => m.toLowerCase().trim() === t.toLowerCase().trim()));

      this.logger.log({
        diagnostic: "GATE_2_OUTLINE_VALIDATION",
        plannedSectionCount: outline.outline.length,
        mandatorySectionCount: mandatoryTitles.length,
        missingFromPlan: missingFromPlan,
        extraInPlan: extraInPlan,
        match: missingFromPlan.length === 0 ? "PASS" : "FAIL",
      });

      // If planner missed mandatory sections, inject them
      if (missingFromPlan.length > 0) {
        this.logger.warn(`Planner missed ${missingFromPlan.length} mandatory sections — injecting them`);
        for (const title of missingFromPlan) {
          const desc = mandatorySections.find((s) => s.title === title)?.description;
          outline.outline.push({
            section: title,
            target_words: 400,
            must_answer: desc ? [desc] : [],
          });
          outline.retrieval_plan.push({
            section: title,
            query_intents: [title, desc || ""].filter(Boolean),
            required_evidence_types: ["org_data", "program_report"],
          });
        }
      }

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
      const allEvidencePack: Array<{ chunkId: string; docId: string; text: string; title?: string; url?: string }> = [];
      const citationMap: Record<string, string> = {};

      // Parallel section drafting with concurrency pool (3 concurrent, configurable)
      const SECTION_CONCURRENCY = 3;
      type SectionResult = { index: number; draftText: string; gaps: string[]; evidenceChunks: Array<EvidenceChunk & { score?: number }> };
      const sectionResults: SectionResult[] = [];

      // Worker function for a single section
      const draftOneSection = async (sectionOutline: typeof sectionsToDraft[0], index: number): Promise<SectionResult> => {
        const sectionStart = Date.now();
        const sectionName = sectionOutline.section;
        this.logger.log(`Drafting section [${index + 1}/${sectionsToDraft.length}]: ${sectionName}`);

        const sectionRecord = await this.prisma.proposalSection.create({
          data: {
            runId: run.id,
            name: sectionName,
            targetWords: sectionOutline.target_words,
            status: "pending",
          },
        });

        try {
          const retrievalPlanItem = outline.retrieval_plan.find((r) => r.section === sectionName);

          const queries = await this.queryGenerator.generateQueries({
            sectionName,
            mustAnswer: sectionOutline.must_answer || [],
            evidenceTypes: retrievalPlanItem?.required_evidence_types || [],
            orgName: "Diksha Foundation",
            funderName,
            funderThemes: funderThemes?.primary?.length
              ? funderThemes.primary.join(", ")
              : undefined,
          });

          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: { retrievalQueries: queries as object, status: "retrieved" },
          });

          // Retrieve chunks (combine results from all queries, limit to 8-12 per section)
          const corpusRoute = getCorpusRoute(sectionName);
          const allChunks = new Map<string, EvidenceChunk & { score?: number }>();
          for (const query of queries.slice(0, 5)) {
            const chunks = await this.retrieval.retrieve(query, {
              mode: "proposal_drafting",
              limit: corpusRoute.limit ?? 3,
              minScore: 0.3,
              orgId: "diksha",
              corpus: corpusRoute.corpus,
              docTypes: corpusRoute.docTypes,
            });
            chunks.forEach((chunk) => {
              const existing = allChunks.get(chunk.id);
              if (!existing || (chunk.score ?? 0) > (existing.score ?? 0)) {
                allChunks.set(chunk.id, {
                  chunkId: chunk.id,
                  docId: chunk.source,
                  content: chunk.text,
                  score: chunk.score,
                  document: {
                    title: chunk.title || "",
                    url: chunk.urlOrPath,
                  },
                });
              }
            });
          }

          const evidenceChunks = Array.from(allChunks.values())
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, 12);

          // Retrieval confidence gate
          const confidence = computeRetrievalConfidence(
            evidenceChunks.map((c) => ({ score: c.score, docId: c.docId })),
          );
          this.logger.log(
            `[${sectionName}] Retrieval confidence: ${confidence.level} (avg=${confidence.avgScore.toFixed(3)}, chunks=${confidence.chunkCount}, docs=${confidence.uniqueDocCount}, corpus=${corpusRoute.corpus.join(",") || "all"})`,
          );
          if (confidence.level === "low") {
            this.logger.warn(`[${sectionName}] LOW retrieval confidence: ${confidence.reason}`);
          }

          // Enhanced retrieval diagnostics
          const scores = evidenceChunks.map((c) => c.score ?? 0);
          this.logger.log({
            section: sectionName,
            queriesUsed: queries.slice(0, 5).length,
            chunksRetrieved: allChunks.size,
            chunksPassedToWriter: evidenceChunks.length,
            scoreMin: scores.length ? Math.min(...scores).toFixed(3) : "N/A",
            scoreMax: scores.length ? Math.max(...scores).toFixed(3) : "N/A",
            scoreAvg: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : "N/A",
            docTitles: [...new Set(evidenceChunks.map((c) => c.document.title))].slice(0, 5),
          });

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
          const themeSuffix = funderThemes?.primary?.length
            ? ` | Themes: ${funderThemes.primary.join(", ")}${funderThemes.secondary?.length ? ` + ${funderThemes.secondary.join(", ")}` : ""}`
            : "";
          const funderContext = `${funderName}${programName ? " — " + programName : ""}${themeSuffix}`;
          // Build org context with activity facts as a compact, structured block
          let orgCtx = orgProfileSummary;
          if (activityFacts) {
            orgCtx += `\n\nACTIVITY FACTS (you MUST use these wherever relevant — if you do not use them, explain why):\n${JSON.stringify(activityFacts, null, 2)}`;
          }
          if (activitiesContext) {
            orgCtx += `\n\nStructured Activities Registry:\n${activitiesContext}`;
          }

          const { draftText: rawDraft, gaps } = await this.sectionWriter.draftSection({
            sectionName,
            sectionGuidance,
            chunks: evidenceChunks,
            orgContext: orgCtx,
            funderContext,
            proposalScope: outline.proposal_scope,
          });

          // Auto-repair: soften unsupported hard claims
          const repairResult = this.citationRepair.repairSection(rawDraft);
          const draftText = repairResult.repaired;

          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: {
              draftText,
              citations: [] as object,
              gaps: gaps as object,
              status: "drafted",
            },
          });

          logStructured.log("section_draft_complete", {
            context: "ProposalService",
            runId: run.id,
            section: sectionName,
            index,
            section_ms: Date.now() - sectionStart,
            queries_used: queries.slice(0, 5).length,
            chunks_retrieved: allChunks.size,
            chunks_passed: evidenceChunks.length,
            draft_chars: draftText.length,
            gaps_count: gaps.length,
            citation_count: (draftText.match(/\[citation:[^\]]+\]/g) || []).length,
          });

          return { index, draftText, gaps, evidenceChunks };
        } catch (e) {
          this.logger.error(`Failed to draft section ${sectionName}`, (e as Error).message);
          await this.prisma.proposalSection.update({
            where: { id: sectionRecord.id },
            data: {
              draftText: `Error: ${(e as Error).message}`,
              status: "drafted",
            },
          });
          return { index, draftText: `Error: ${(e as Error).message}`, gaps: [(e as Error).message], evidenceChunks: [] };
        }
      };

      // Execute with concurrency pool
      const pending = new Set<Promise<SectionResult>>();
      const queue = sectionsToDraft.map((s, i) => ({ sectionOutline: s, index: i }));

      while (queue.length > 0 || pending.size > 0) {
        // Fill up to SECTION_CONCURRENCY
        while (queue.length > 0 && pending.size < SECTION_CONCURRENCY) {
          const item = queue.shift()!;
          const p = draftOneSection(item.sectionOutline, item.index).then((result) => {
            pending.delete(p);
            sectionResults.push(result);
            return result;
          });
          pending.add(p);
        }
        // Wait for at least one to complete
        if (pending.size > 0) {
          await Promise.race(pending);
        }
      }

      // Sort results back to original section order
      sectionResults.sort((a, b) => a.index - b.index);

      // Budget arithmetic validation — run BEFORE placeholder gate so ceiling breaches are always caught
      const budgetWarnings = this.validateBudgetArithmetic(sectionResults, sectionsToDraft.map(s => s.section), grantCeilingINR);
      if (budgetWarnings.length > 0) {
        this.logger.warn({ diagnostic: "BUDGET_ARITHMETIC", warnings: budgetWarnings });
      }
      const hasCeilingBreach = budgetWarnings.some(w => w.startsWith("CEILING BREACH"));

      // === SPLIT PLACEHOLDER COUNTING ===
      // Hard missing: {{MISSING:}}, {{VERIFY:}}, {{INSERT:}} — these block submission
      // Soft numeric flags: [UNVERIFIED_NUMERIC_CLAIM] — these warn but don't block
      const hardPlaceholders: Array<{ section: string; placeholder: string; field: string }> = [];
      const emptyTableCells: Array<{ section: string; placeholder: string; field: string }> = [];

      for (const result of sectionResults) {
        const sectionName = sectionsToDraft[result.index].section;

        // Detect explicit hard placeholders
        const matches = result.draftText.matchAll(/\{\{(?:MISSING|VERIFY|INSERT):\s*([^}]+)\}\}/gi);
        for (const m of matches) {
          hardPlaceholders.push({
            section: sectionName,
            placeholder: m[0],
            field: m[1].trim(),
          });
        }

        // Detect empty table cells (blank, "-", "TBD", "N/A" in data rows)
        const tableRows = result.draftText.match(/^\|.+\|$/gm) || [];
        for (const row of tableRows) {
          if (/^\|[\s\-:]+\|$/.test(row)) continue;
          const cells = row.split("|").slice(1, -1);
          cells.forEach((cell, cellIdx) => {
            const trimmed = cell.trim();
            if (trimmed === "" || trimmed === "-" || /^(TBD|N\/A|tbd|n\/a)$/i.test(trimmed)) {
              emptyTableCells.push({
                section: sectionName,
                placeholder: `Empty table cell (col ${cellIdx + 1})`,
                field: `Empty cell in table row: ${row.substring(0, 80)}`,
              });
            }
          });
        }
      }

      // Combine hard placeholders + empty table cells for the blocking gate
      const placeholderHits = [...hardPlaceholders, ...emptyTableCells];

      // Count soft [UNVERIFIED_NUMERIC_CLAIM] flags (added by governance guard later, but also pre-existing)
      // These are NON-BLOCKING — just a warning
      let softNumericFlagCount = 0;
      for (const result of sectionResults) {
        const softMatches = result.draftText.match(/\[UNVERIFIED_NUMERIC_CLAIM[^\]]*\]/gi);
        softNumericFlagCount += softMatches?.length ?? 0;
      }

      this.logger.log({
        diagnostic: "PLACEHOLDER_SPLIT",
        hardMissing: hardPlaceholders.length,
        emptyTableCells: emptyTableCells.length,
        softNumericFlags: softNumericFlagCount,
        totalBlocking: placeholderHits.length,
        hasCeilingBreach,
      });

      if (placeholderHits.length > 0 || hasCeilingBreach) {
        if (placeholderHits.length > 0) {
          this.logger.warn({
            gate: "PLACEHOLDER_HARD_GATE",
            hardMissing: hardPlaceholders.length,
            emptyTableCells: emptyTableCells.length,
            sections: [...new Set(placeholderHits.map(h => h.section))],
            placeholders: placeholderHits.slice(0, 20),
          });
        }
        if (hasCeilingBreach) {
          this.logger.warn({ gate: "CEILING_BREACH_HARD_GATE", warnings: budgetWarnings });
        }

        const missingInputs = [
          ...placeholderHits.map(h => ({
            field: h.field,
            section: h.section,
            question: `Missing data: ${h.field}`,
            priority: "high" as const,
          })),
          ...budgetWarnings.filter(w => w.startsWith("CEILING BREACH")).map(w => ({
            field: "Detailed Budget",
            section: "Budget",
            question: w,
            priority: "high" as const,
          })),
        ];

        // Build evidence pack for citation resolution in blocked path
        const blockedEvidencePack: Array<{ chunkId: string; docId: string; text: string; title?: string; url?: string }> = [];
        for (const result of sectionResults) {
          (result.evidenceChunks as Array<EvidenceChunk & { score?: number }>).forEach((c) => {
            if (!blockedEvidencePack.find((e) => e.chunkId === c.chunkId)) {
              blockedEvidencePack.push({
                chunkId: c.chunkId, docId: c.docId,
                text: c.content.substring(0, 500),
                title: c.document.title, url: c.document.url,
              });
            }
          });
        }

        // Build annotated draft with visual gate warnings + resolve citations
        const rawBlockedDraft = this.formatBlockedProposal(
          sectionResults,
          sectionsToDraft.map(s => s.section),
          placeholderHits,
        );
        const blockedCitationResult = resolveCitations(rawBlockedDraft, blockedEvidencePack);
        const blockedDraftText = this.governanceGuard.enforceNumericClaimDiscipline(
          blockedCitationResult.resolvedText,
        ).text;

        await this.prisma.proposalRun.update({
          where: { id: run.id },
          data: {
            status: "blocked_missing_inputs",
            gaps: missingInputs as object,
            complianceReport: {
              blockedDraftFormatted: blockedDraftText,
              placeholderHits,
              hardMissingCount: hardPlaceholders.length,
              emptyTableCellCount: emptyTableCells.length,
              softNumericFlagCount,
              budgetWarnings,
              citationReferences: blockedCitationResult.references,
            } as object,
          },
        });

        await this.opportunityService.update(opportunity.id, {
          status: "blocked_missing_inputs",
          missingInputs,
        });

        return await this.prisma.proposalRun.findUnique({
          where: { id: run.id },
          include: { sections: true },
        });
      }

      // Build final draft texts and accumulate evidence/citations
      const allDraftTexts: string[] = [];
      for (const result of sectionResults) {
        allDraftTexts.push(result.draftText);
        sectionGaps.push({ section: sectionsToDraft[result.index].section, gaps: result.gaps });

        // Extract citations
        const citationMatches = result.draftText.match(/\[citation:([^:]+):([^\]]+)\]/g);
        if (citationMatches) {
          citationMatches.forEach((match) => {
            const m = match.match(/\[citation:([^:]+):([^\]]+)\]/);
            if (m) citationMap[match] = `${m[1]}:${m[2]}`;
          });
        }

        // Add to evidence pack
        result.evidenceChunks.forEach((c) => {
          if (!allEvidencePack.find((e) => e.chunkId === c.chunkId)) {
            allEvidencePack.push({
              chunkId: c.chunkId,
              docId: c.docId,
              text: c.content.substring(0, 500),
              title: c.document.title,
              url: c.document.url,
            });
          }
        });
      }

      // 5. Run QA review
      await this.slackClient.postProgress({
        opportunityId,
        stage: "qa",
        message: "Running QA review...",
        approval: mappedApproval,
      });

      // Assemble: Program Snapshot preamble + section drafts
      const assembledSections = [PROGRAM_SNAPSHOT_MD, ...allDraftTexts];
      const citationResult = resolveCitations(
        assembledSections.join("\n\n"),
        allEvidencePack,
      );
      const numericCheck = this.governanceGuard.enforceNumericClaimDiscipline(
        citationResult.resolvedText,
      );
      const fullDraftText = numericCheck.text;
      if (numericCheck.flaggedCount > 0) {
        this.governanceGuard.logAudit({
          eventId: `evt_${Date.now()}_proposal_numeric_claims`,
          eventType: "funding.numeric_claims.marked",
          module: "proposal",
          action: "update",
          entityType: "proposal_run",
          entityId: run.id,
          actor: { actorType: "agent", actorId: "proposal_service" },
          timestamp: new Date().toISOString(),
          status: "accepted",
          metadata: {
            enforcement: "BR-GOV-02",
            flaggedCount: numericCheck.flaggedCount,
          },
        });
      }

      this.logger.log({
        diagnostic: "CITATION_RESOLUTION",
        uniqueCitationsResolved: citationResult.references.length,
      });

      // Build QA requirements with explicit mandatory section list, ceiling, and themes
      const generatedSectionTitles = outline.outline.map((s) => s.section);
      const requirementsJson = JSON.stringify({
        sections: outline.outline,
        mandatorySections: mandatorySections.map((s) => s.title),
        compliance: outline.compliance_checklist,
        evaluationCriteria: oppPayload.extractedRequirements?.evaluationCriteria || [],
        maxGrantAmountINR: grantCeilingINR ?? undefined,
        budgetCeiling: effectiveBudgetCeiling || undefined,
        funderThemes: funderThemes ?? undefined,
      });

      // === DIAGNOSTIC: Step D — QA input ===
      this.logger.log({
        diagnostic: "STEP_D_QA_INPUT",
        mandatorySectionsCount: mandatorySections.length,
        generatedSectionsCount: generatedSectionTitles.length,
        mandatorySectionTitles: mandatorySections.map((s) => s.title),
        generatedSectionTitles,
      });

      const qaResult = await this.qaReviewer.reviewProposal({
        requirementsJson,
        draftText: fullDraftText,
        citationMap: JSON.stringify(citationMap),
      });

      // Deterministic coverage: compute from mandatory sections present in draft headings
      const draftHeadings = fullDraftText.match(/^#+\s+(.+)$/gm)?.map((h) => h.replace(/^#+\s+/, "").trim().toLowerCase()) || [];
      const mandatoryMatched = mandatorySections.filter((s) =>
        draftHeadings.some((h) => h.includes(s.title.toLowerCase()) || s.title.toLowerCase().includes(h)),
      );
      const deterministicCoverage = mandatorySections.length > 0
        ? mandatoryMatched.length / mandatorySections.length
        : 0;
      const missingMandatory = mandatorySections
        .filter((s) => !draftHeadings.some((h) => h.includes(s.title.toLowerCase()) || s.title.toLowerCase().includes(h)))
        .map((s) => s.title);

      // Override LLM coverage score with deterministic calculation
      if (deterministicCoverage > 0) {
        qaResult.coverage_score = deterministicCoverage;
      }
      if (missingMandatory.length > 0) {
        qaResult.missing_requirements = [
          ...missingMandatory.map((t) => `MANDATORY SECTION MISSING: "${t}"`),
          ...qaResult.missing_requirements,
        ];
      }

      this.logger.log({
        diagnostic: "STEP_D_QA_COVERAGE",
        deterministicCoverage: Math.round(deterministicCoverage * 100),
        mandatoryMatched: mandatoryMatched.length,
        totalMandatory: mandatorySections.length,
        missingMandatorySections: missingMandatory,
        llmCoverageScore: qaResult.coverage_score,
      });

      // #region agent log
      fetch("http://127.0.0.1:7243/ingest/e36a6ac1-51ba-43e8-bd5c-a488ce3f53fd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: "apps/funding-api/src/modules/proposal/proposal.service.ts:395",
          message: "PROPOSAL_DEBUG_QA_SUMMARY",
          data: {
            opportunityId,
            runId: run.id,
            deterministicCoverage,
            mandatoryMatched: mandatoryMatched.length,
            totalMandatory: mandatorySections.length,
            missingMandatorySections: missingMandatory,
            coverageScore: qaResult.coverage_score,
            missingRequirementsCount: qaResult.missing_requirements?.length ?? 0,
            ungroundedClaimsCount: qaResult.ungrounded_claims?.length ?? 0,
          },
          timestamp: Date.now(),
          runId: run.id,
          hypothesisId: "H4",
        }),
      }).catch(() => {});
      // #endregion

      // Extract gaps
      const gaps = this.qaReviewer.extractGaps(qaResult, sectionGaps);

      await this.prisma.proposalRun.update({
        where: { id: run.id },
        data: {
          complianceReport: {
            ...qaResult,
            rawDraftText: citationResult.rawDraftText,
            citationReferences: citationResult.references,
            budgetArithmeticWarnings: budgetWarnings,
          } as object,
          gaps: gaps as object,
          status: "qa",
        },
      });

      // 6. Export artifacts
      if (opportunity.driveFolderId && this.artifactExporter.isConfigured()) {
        const exportApproval = this.governanceGuard.requireWriteApproval({
          module: "proposal",
          action: "create",
          entityType: "proposal_artifacts",
          entityId: run.id,
          actor: { actorType: "agent", actorId: "proposal_service" },
          reason: "Export proposal artifacts to Drive",
          before: null,
          after: {
            opportunityFolderId: opportunity.driveFolderId,
            runId: run.id,
            funderName,
            programName,
          },
          approval: mappedApproval,
        });
        await this.opportunityService.appendAuditEvent(opportunity.id, "proposal_export_guard", exportApproval.approved ? "allowed" : "blocked", {
          preview: exportApproval.preview,
          decisionReason: exportApproval.reason,
        });

        if (!exportApproval.approved) {
          await this.prisma.proposalRun.update({
            where: { id: run.id },
            data: {
              complianceReport: {
                ...(qaResult as object),
                exportPreview: exportApproval.preview,
                exportBlockedReason: exportApproval.reason,
              } as object,
            },
          });
        } else {
        await this.slackClient.postProgress({
          opportunityId,
          stage: "export",
          message: "Exporting artifacts to Drive...",
          approval: mappedApproval,
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
      }

      // 7. Send Slack summary
      const runArtifacts = opportunity.driveFolderId && this.artifactExporter.isConfigured()
        ? (await this.prisma.proposalRun.findUnique({ where: { id: run.id } }))?.artifacts as ProposalRunArtifacts | undefined
        : undefined;

      const slackSummaryResult = await this.slackClient.postSummary({
        opportunityId,
        funderName,
        status: "complete",
        artifacts: runArtifacts,
        gaps,
        coverageScore: qaResult.coverage_score,
        approval: mappedApproval,
      });
      await this.opportunityService.appendAuditEvent(
        opportunity.id,
        "proposal_slack_summary",
        slackSummaryResult.sent ? "allowed" : "blocked",
        {
          reason: slackSummaryResult.reason,
          guardDecision: slackSummaryResult.guardDecision,
          preview: slackSummaryResult.preview,
        },
      );

      // 8. Send email notification to review recipients
      const proposalTitle = `${funderName}${programName ? ` - ${programName}` : ""}`;
      const emailBody = this.formatProposalEmailBody({
        opportunityId,
        funderName,
        programName,
        coverageScore: qaResult.coverage_score,
        gaps,
        draftText: fullDraftText,
        artifacts: runArtifacts,
      });
      const emailResult = await this.emailNotification.sendGeneratedContent(
        "Proposal Generated",
        proposalTitle,
        emailBody,
        mappedApproval,
        { actorType: "agent", actorId: "proposal_service_email" }
      );
      await this.opportunityService.appendAuditEvent(
        opportunity.id,
        "proposal_email_delivery",
        emailResult.sent ? "allowed" : "blocked",
        {
          reason: emailResult.reason,
          guardDecision: emailResult.guardDecision,
          preview: emailResult.preview,
        },
      );

      // 9. Update status to complete
      await this.prisma.proposalRun.update({
        where: { id: run.id },
        data: { status: "complete" },
      });

      logStructured.log("proposal_run_complete", {
        context: "ProposalService",
        runId: run.id,
        opportunityId,
        total_ms: Date.now() - runStart,
        sections_count: sectionsToDraft.length,
        total_chars: fullDraftText.length,
        coverage_score: qaResult.coverage_score,
        gaps_count: gaps.length,
        status: "complete",
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

    // Extract funder context from opportunity
    const regenOppBlob = run.opportunity?.jsonBlob as { opportunity?: { funder?: { name?: string; programName?: string } } } | undefined;
    const regenFunderName = regenOppBlob?.opportunity?.funder?.name || "";
    const regenProgramName = regenOppBlob?.opportunity?.funder?.programName || "";

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
      orgName: "Diksha Foundation",
      funderName: regenFunderName,
    });

    // Retrieve chunks
    const regenCorpusRoute = getCorpusRoute(sectionName);
    const allChunks = new Map<string, EvidenceChunk>();
    for (const query of queries.slice(0, 5)) {
      const chunks = await this.retrieval.retrieve(query, {
        mode: "proposal_drafting",
        limit: regenCorpusRoute.limit ?? 3,
        minScore: 0.3,
        orgId: "diksha",
        corpus: regenCorpusRoute.corpus,
        docTypes: regenCorpusRoute.docTypes,
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

    // Retrieval confidence for regeneration
    const regenConfidence = computeRetrievalConfidence(
      evidenceChunks.map((c) => ({ score: (c as any).score, docId: c.docId })),
    );
    this.logger.log(
      `[regen:${sectionName}] Retrieval confidence: ${regenConfidence.level} (avg=${regenConfidence.avgScore.toFixed(3)}, chunks=${regenConfidence.chunkCount}, docs=${regenConfidence.uniqueDocCount})`,
    );

    // Draft section with additional context
    const sectionGuidance = `${sectionOutline.target_words ? `Target words: ${sectionOutline.target_words}. ` : ""}Must answer: ${sectionOutline.must_answer.join(", ") || "N/A"}${options?.additionalContext ? `. Additional context: ${options.additionalContext}` : ""}${options?.userNotes ? `. User notes: ${options.userNotes}` : ""}`;

    const regenFunderContext = `${regenFunderName}${regenProgramName ? " — " + regenProgramName : ""}`;
    const { draftText: rawDraft, gaps } = await this.sectionWriter.draftSection({
      sectionName,
      sectionGuidance,
      chunks: evidenceChunks,
      orgContext: DIKSHA_ORG_PROFILE,
      funderContext: regenFunderContext,
      proposalScope: outline?.proposal_scope,
    });

    // Auto-repair: soften unsupported hard claims
    const repairResult = this.citationRepair.repairSection(rawDraft);
    const draftText = repairResult.repaired;

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

  /**
   * Validate budget arithmetic: check that line item amounts sum to stated total.
   * Returns warning strings (empty array = no issues detected).
   */
  private validateBudgetArithmetic(
    sectionResults: Array<{ index: number; draftText: string }>,
    sectionNames: string[],
    ceilingINR?: number | null,
  ): string[] {
    const warnings: string[] = [];
    const budgetIdx = sectionNames.findIndex(n => n.toLowerCase().includes("budget"));
    if (budgetIdx === -1) return warnings;

    const budgetResult = sectionResults.find(r => r.index === budgetIdx);
    if (!budgetResult) return warnings;

    const text = budgetResult.draftText;

    // Strategy 1: Extract line items from markdown tables (most reliable)
    const tableLineItems = this.extractBudgetTableItems(text);

    // Strategy 2: Extract all inline INR amounts as fallback
    const amountMatches = [...text.matchAll(/INR\s*([\d,]+)/gi)];
    const allAmounts = amountMatches.map(m => ({
      raw: m[0],
      value: parseInt(m[1].replace(/,/g, ""), 10),
    })).filter(a => !isNaN(a.value) && a.value > 0);

    // Determine line item sum and stated total
    let lineItemSum: number;
    let statedTotal: number;

    if (tableLineItems.length >= 3) {
      // Table-based extraction: last row with "total" in it is the stated total
      const totalRow = tableLineItems.find(item => /total/i.test(item.name));
      const nonTotalItems = tableLineItems.filter(item => !/total/i.test(item.name));
      lineItemSum = nonTotalItems.reduce((s, item) => s + item.amount, 0);
      statedTotal = totalRow?.amount ?? lineItemSum;
    } else if (allAmounts.length >= 3) {
      // Fallback: largest amount is the stated total, rest are line items
      const largest = Math.max(...allAmounts.map(a => a.value));
      const lineItems = allAmounts.filter(a => a.value < largest * 0.5);
      lineItemSum = lineItems.reduce((s, a) => s + a.value, 0);
      statedTotal = largest;
    } else {
      return warnings;
    }

    // Check: line items vs stated total
    if (statedTotal > 0 && Math.abs(lineItemSum - statedTotal) > statedTotal * 0.01) {
      warnings.push(
        `Line items sum to INR ${lineItemSum.toLocaleString("en-IN")} but stated total is INR ${statedTotal.toLocaleString("en-IN")} (diff: INR ${Math.abs(lineItemSum - statedTotal).toLocaleString("en-IN")})`,
      );

      // AUTO-REPAIR: Replace the stated total with the computed sum
      const computedTotal = lineItemSum;
      const computedFormatted = `INR ${computedTotal.toLocaleString("en-IN")}`;

      // Find the line with "total" and the wrong amount, replace it
      const totalLinePattern = /(total[^|]*\|[^|]*?)INR\s*[\d,]+/gi;
      const repaired = budgetResult.draftText.replace(totalLinePattern, `$1${computedFormatted}`);
      if (repaired !== budgetResult.draftText) {
        budgetResult.draftText = repaired;
        warnings.push(`AUTO-REPAIRED: Total replaced with computed sum ${computedFormatted}`);
      }
    }

    // Check for multiple different "total" amounts
    const totalPattern = /total[^:]*:\s*INR\s*([\d,]+)/gi;
    const totalMatches = [...text.matchAll(totalPattern)];
    const totalValues = [...new Set(totalMatches.map(m => parseInt(m[1].replace(/,/g, ""), 10)))];
    if (totalValues.length > 1) {
      warnings.push(
        `Multiple different totals found: ${totalValues.map(v => `INR ${v.toLocaleString("en-IN")}`).join(", ")}`,
      );
    }

    // Check for mixed durations (e.g. 24 months in a 12-month grant)
    const durationMatches = [...text.matchAll(/(\d+)\s*months?/gi)];
    const durations = [...new Set(durationMatches.map(m => parseInt(m[1], 10)))].filter(d => d >= 6);
    if (durations.length > 1 && durations.some(d => d > 12) && durations.some(d => d <= 12)) {
      warnings.push(
        `Mixed durations in budget: ${durations.sort((a, b) => a - b).join(", ")} months. Verify all lines match grant period.`,
      );
    }

    // Check against grant ceiling (hard constraint)
    const effectiveTotal = lineItemSum || statedTotal;
    if (ceilingINR && ceilingINR > 0 && effectiveTotal > ceilingINR) {
      warnings.push(
        `CEILING BREACH: Proposed budget INR ${effectiveTotal.toLocaleString("en-IN")} exceeds grant ceiling INR ${ceilingINR.toLocaleString("en-IN")} by INR ${(effectiveTotal - ceilingINR).toLocaleString("en-IN")}`,
      );
    }

    return warnings;
  }

  /**
   * Extract budget line items from markdown tables.
   * Looks for rows with INR amounts in the last numeric column.
   */
  private extractBudgetTableItems(text: string): Array<{ name: string; amount: number }> {
    const items: Array<{ name: string; amount: number }> = [];
    const tableRows = text.match(/^\|.+\|$/gm) || [];

    for (const row of tableRows) {
      // Skip header separator rows
      if (/^\|[\s\-:]+\|$/.test(row)) continue;

      const cells = row.split("|").slice(1, -1).map(c => c.trim());
      if (cells.length < 2) continue;

      // Find the cell with the largest INR amount (typically the total for that row)
      let maxAmount = 0;
      let name = cells[0].replace(/\*\*/g, "").trim();

      for (const cell of cells) {
        const amountMatch = cell.match(/(?:INR\s*)?(\d[\d,]*)/);
        if (amountMatch) {
          const val = parseInt(amountMatch[1].replace(/,/g, ""), 10);
          if (val > maxAmount) maxAmount = val;
        }
      }

      if (maxAmount > 0 && name) {
        items.push({ name, amount: maxAmount });
      }
    }

    return items;
  }

  /**
   * Format draft sections with visual warnings when placeholders are detected.
   */
  private formatBlockedProposal(
    sectionResults: Array<{ index: number; draftText: string; gaps: string[]; evidenceChunks: unknown[] }>,
    sectionNames: string[],
    placeholderHits: Array<{ section: string; placeholder: string; field: string }>,
  ): string {
    const lines: string[] = [];

    // Global warning header
    lines.push("## DRAFT — DO NOT SUBMIT");
    lines.push("");
    lines.push("This proposal draft contains unresolved placeholders and is **not ready for submission**.");
    lines.push("");
    lines.push("| # | Section | Missing Field |");
    lines.push("|---|---------|---------------|");
    placeholderHits.forEach((hit, idx) => {
      lines.push(`| ${idx + 1} | ${hit.section} | ${hit.field} |`);
    });
    lines.push("");
    lines.push("---");
    lines.push("");

    // Program Snapshot preamble
    lines.push(PROGRAM_SNAPSHOT_MD);
    lines.push("");

    // Per-section output with callouts on affected sections
    const hitsBySection = new Map<string, Array<{ placeholder: string; field: string }>>();
    for (const hit of placeholderHits) {
      const arr = hitsBySection.get(hit.section) || [];
      arr.push(hit);
      hitsBySection.set(hit.section, arr);
    }

    for (const result of sectionResults) {
      const sectionName = sectionNames[result.index];
      const sectionHits = hitsBySection.get(sectionName);

      if (sectionHits && sectionHits.length > 0) {
        lines.push(`> **This section contains unresolved placeholders:**`);
        for (const hit of sectionHits) {
          lines.push(`> - ${hit.field}`);
        }
        lines.push("");
      }

      lines.push(result.draftText);
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Format proposal content for email notification body.
   */
  private formatProposalEmailBody(params: {
    opportunityId: string;
    funderName: string;
    programName?: string;
    coverageScore?: number;
    gaps?: ProposalGap[];
    draftText: string;
    artifacts?: ProposalRunArtifacts;
  }): string {
    const lines: string[] = [
      "PROPOSAL GENERATION COMPLETE",
      "=" .repeat(50),
      "",
      `Opportunity ID: ${params.opportunityId}`,
      `Funder: ${params.funderName}`,
    ];

    if (params.programName) {
      lines.push(`Program: ${params.programName}`);
    }

    if (params.coverageScore !== undefined) {
      lines.push(`Coverage Score: ${(params.coverageScore * 100).toFixed(0)}%`);
    }

    if (params.artifacts?.driveFolderUrl) {
      lines.push("");
      lines.push("ARTIFACTS");
      lines.push("-".repeat(30));
      lines.push(`Proposal Pack: ${params.artifacts.driveFolderUrl}`);
      if (params.artifacts.docUrl) {
        lines.push(`Draft Document: ${params.artifacts.docUrl}`);
      }
    }

    if (params.gaps && params.gaps.length > 0) {
      lines.push("");
      lines.push(`MISSING INPUTS (${params.gaps.length})`);
      lines.push("-".repeat(30));
      params.gaps.forEach((gap) => {
        const section = gap.section ? ` [${gap.section}]` : "";
        const priority = gap.priority ? ` (${gap.priority})` : "";
        lines.push(`• ${gap.question}${section}${priority}`);
      });
    }

    lines.push("");
    lines.push("GENERATED PROPOSAL");
    lines.push("=".repeat(50));
    lines.push("");
    lines.push(params.draftText);
    lines.push("");
    lines.push("-".repeat(50));
    lines.push("This is an automated notification from the Bodh AI Funding Bot.");
    lines.push("Please review and provide feedback.");

    return lines.join("\n");
  }
}
