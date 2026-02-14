import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RetrievalService } from "../evidence_ingest/retrieval.service";
import { PipelineService } from "../pipeline/pipeline.service";
import type { PipelineStage } from "../pipeline/pipeline.types";
import { resolveCitations } from "../proposal/utils/citation-resolver";

export interface DigestOverdueItem {
  id: string;
  orgName: string;
  nextAction?: string;
  nextActionDate: string;
  owner?: string;
}

export interface DigestReport {
  generatedAt: string;
  pipeline: {
    total: number;
    byStage: Record<string, number>;
  };
  overdue: {
    count: number;
    entries: DigestOverdueItem[];
  };
  kpis?: {
    pctWithNextActionAndDue: number;
    pctStale: number;
    totalActive: number;
    withNextActionAndDue: number;
    staleCount: number;
  };
}

type EntryWithMeta = Awaited<ReturnType<PipelineService["getEntries"]>>[number] & {
  id?: string;
  stage?: string;
  nextAction?: string;
  nextActionDate?: string;
  assignedTo?: string;
};

export interface StalledProspectNudge {
  entryId: string;
  orgName: string;
  stage: PipelineStage;
  owner?: string;
  staleThresholdDays: number;
  daysSinceLastActivity: number | null;
  lastActivityAt?: string;
  recommendations: string[];
  slackMessagePreview: string;
}

export interface MeetingPrepBrief {
  generatedAt: string;
  entryId: string;
  orgName: string;
  stage: PipelineStage;
  /** One-line summary for Slack/digest (e.g. "Meeting prep for Org X: stage Y, focus on ask strategy.") */
  summaryForSlack?: string;
  donorProfile: string;
  priorInteractions: string[];
  proposalStatus: string;
  askStrategy: string;
  suggestedQuestions: string[];
  briefText: string;
  references: Array<{
    number: number;
    docId: string;
    chunkId: string;
    title: string;
    url?: string;
  }>;
}

function daysSinceIso(isoDate: string | undefined, now: Date): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly configService: ConfigService,
    private readonly retrievalService: RetrievalService,
  ) {}

  private getStaleThresholdDays(overrideDays?: number): number {
    if (overrideDays && Number.isFinite(overrideDays) && overrideDays > 0) {
      return Math.floor(overrideDays);
    }
    return this.configService.get<number>("FUNDING_STALLED_PROSPECT_DAYS") ?? 30;
  }

  async getDigest(): Promise<DigestReport> {
    const entries = (await this.pipelineService.getEntries()) as EntryWithMeta[];
    const now = new Date();
    const staleThresholdDays = this.getStaleThresholdDays();
    const staleCutoff = new Date(now);
    staleCutoff.setDate(staleCutoff.getDate() - staleThresholdDays);

    const byStage: Record<string, number> = {};
    const overdueEntries: DigestOverdueItem[] = [];
    let withNextActionAndDue = 0;
    let staleCount = 0;
    const activeEntries = entries.filter((e) => e.stage !== "lost");
    const totalActive = activeEntries.length;

    for (const e of entries) {
      const stage = e.stage ?? "unknown";
      byStage[stage] = (byStage[stage] ?? 0) + 1;

      const nextActionDate = e.nextActionDate;
      if (nextActionDate) {
        const d = new Date(nextActionDate);
        if (d < now) {
          overdueEntries.push({
            id: e.id ?? "",
            orgName: e.orgName,
            nextAction: e.nextAction,
            nextActionDate,
            owner: e.assignedTo,
          });
        }
      }

      if (e.stage !== "lost") {
        if (e.nextAction && e.nextActionDate) withNextActionAndDue++;
        const lastContact = e.lastContactDate
          ? new Date(e.lastContactDate)
          : null;
        if (!lastContact || lastContact < staleCutoff) staleCount++;
      }
    }

    const pctWithNextActionAndDue =
      totalActive > 0 ? (withNextActionAndDue / totalActive) * 100 : 0;
    const pctStale = totalActive > 0 ? (staleCount / totalActive) * 100 : 0;

    return {
      generatedAt: now.toISOString(),
      pipeline: {
        total: entries.length,
        byStage,
      },
      overdue: {
        count: overdueEntries.length,
        entries: overdueEntries.sort(
          (a, b) =>
            new Date(a.nextActionDate).getTime() -
            new Date(b.nextActionDate).getTime(),
        ),
      },
      kpis: {
        pctWithNextActionAndDue,
        pctStale,
        totalActive,
        withNextActionAndDue,
        staleCount,
      },
    };
  }

  async getCsrPack(orgOrId: string) {
    return this.pipelineService.getCsrPack(orgOrId);
  }

  async getCsrDueNext30Days() {
    const entries = await this.pipelineService.getCsrDueInNextDays(30);
    return {
      generatedAt: new Date().toISOString(),
      count: entries.length,
      entries: entries.map((e) => ({
        orgName: e.orgName,
        ucDueDate: e.ucDueDate,
        impactReportDueDate: e.impactReportDueDate,
        reportingCadence: e.reportingCadence,
      })),
    };
  }

  async getNextBestActionsForOrgOrId(orgOrId: string) {
    const trimmed = orgOrId?.trim();
    if (!trimmed) {
      throw new NotFoundException("orgOrId is required");
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const entryId = isUuid
      ? trimmed
      : (await this.pipelineService.findEntryByOrgName(trimmed))?.id;
    if (!entryId) {
      throw new NotFoundException(`No pipeline entry found for org or id: ${trimmed}`);
    }
    return this.pipelineService.getNextBestActions(entryId);
  }

  async getStalledProspects(days?: number): Promise<{
    generatedAt: string;
    staleThresholdDays: number;
    count: number;
    nudges: StalledProspectNudge[];
  }> {
    const entries = (await this.pipelineService.getEntries()) as EntryWithMeta[];
    const now = new Date();
    const staleThresholdDays = this.getStaleThresholdDays(days);
    const activeEntries = entries.filter((e) => e.stage !== "lost" && e.stage !== "won");
    const nudges: StalledProspectNudge[] = [];

    for (const entry of activeEntries) {
      const daysSinceLastActivity = daysSinceIso(entry.lastContactDate, now);
      const stale =
        daysSinceLastActivity === null || daysSinceLastActivity >= staleThresholdDays;
      if (!stale || !entry.id) continue;

      const nextBestAction = await this.pipelineService.getNextBestActions(entry.id);
      const recommendations = nextBestAction.suggestions.map((s) => s.title).slice(0, 3);
      const ageText =
        daysSinceLastActivity === null
          ? "no recorded recent activity"
          : `${daysSinceLastActivity} days since last activity`;
      const recommendationBullets = recommendations.map((r) => `• ${r}`).join("\n");
      const slackMessagePreview =
        `*Stalled Prospect Nudge*\n` +
        `Org: ${entry.orgName}\n` +
        `Stage: ${entry.stage}\n` +
        `Signal: ${ageText} (threshold ${staleThresholdDays}d)\n` +
        `Recommended next actions:\n${recommendationBullets}`;

      nudges.push({
        entryId: entry.id,
        orgName: entry.orgName,
        stage: entry.stage as PipelineStage,
        owner: entry.assignedTo,
        staleThresholdDays,
        daysSinceLastActivity,
        lastActivityAt: entry.lastContactDate,
        recommendations,
        slackMessagePreview,
      });
    }

    return {
      generatedAt: now.toISOString(),
      staleThresholdDays,
      count: nudges.length,
      nudges,
    };
  }

  /**
   * Resolve org name or entry UUID to entry id, then return meeting prep brief.
   */
  async getMeetingPrepBriefForOrgOrId(orgOrId: string): Promise<MeetingPrepBrief> {
    const trimmed = orgOrId?.trim();
    if (!trimmed) {
      throw new NotFoundException("orgOrId is required");
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const entryId = isUuid
      ? trimmed
      : (await this.pipelineService.findEntryByOrgName(trimmed))?.id;
    if (!entryId) {
      throw new NotFoundException(`No pipeline entry found for org or id: ${trimmed}`);
    }
    return this.getMeetingPrepBrief(entryId);
  }

  async getMeetingPrepBrief(entryId: string): Promise<MeetingPrepBrief> {
    const entry = await this.pipelineService.getEntry(entryId);
    const activities = await this.pipelineService.getActivitiesForEntry(entryId);
    const topActivities = activities.slice(0, 5);
    const retrievalQuery = [
      entry.orgName,
      entry.stage,
      "donor profile",
      "prior interactions",
      "proposal context",
      "ask strategy",
    ].join(" ");
    const chunks = await this.retrievalService.retrieve(retrievalQuery, {
      mode: "org_background",
      limit: 8,
    });

    const citationTokens = chunks
      .slice(0, 3)
      .map((c) => `[citation:${c.source}:${c.id}]`);
    const citationSuffix = citationTokens.length ? ` ${citationTokens.join(" ")}` : "";

    const donorProfile =
      `Org: ${entry.orgName}` +
      `${entry.contactName ? `; Primary contact: ${entry.contactName}` : ""}` +
      `${entry.contactEmail ? ` (${entry.contactEmail})` : ""}` +
      `${entry.geography ? `; Geography: ${entry.geography}` : ""}` +
      `${entry.sectorTags?.length ? `; Focus: ${entry.sectorTags.join(", ")}` : ""}` +
      citationSuffix;

    const priorInteractions =
      topActivities.length > 0
        ? topActivities.map((a) => {
            const notes = a.notes ? ` - ${a.notes}` : "";
            return `${new Date(a.timestamp).toISOString()}: ${a.type}${notes}`;
          })
        : ["No prior interactions logged."];

    const proposalStatus =
      `Stage: ${entry.stage}.` +
      `${entry.nextAction ? ` Next action: ${entry.nextAction}.` : ""}` +
      `${entry.nextActionDate ? ` Due: ${entry.nextActionDate}.` : ""}` +
      `${entry.deadline ? ` External deadline: ${entry.deadline}.` : ""}` +
      citationSuffix;

    const askStrategy =
      entry.stage === "proposal_sent"
        ? `Focus on decision process, objections, and close plan. Confirm timeline and required clarifications.${citationSuffix}`
        : `Align ask with funder priorities, quantify outcomes, and confirm fit and compliance needs.${citationSuffix}`;

    const suggestedQuestions = [
      "What outcomes are most important for your next funding cycle?",
      "Which decision criteria will carry the most weight for this opportunity?",
      "Are there compliance or governance constraints we should address upfront?",
      "What level of budget detail do you need before decision?",
      "What is the expected decision timeline and review cadence?",
    ];

    const rawBrief = [
      "## Meeting Prep Brief",
      "",
      `### Donor Profile`,
      donorProfile,
      "",
      `### Prior Interactions`,
      ...priorInteractions.map((line) => `- ${line}`),
      "",
      `### Proposal Status`,
      proposalStatus,
      "",
      `### Ask Strategy`,
      askStrategy,
      "",
      `### Suggested Questions`,
      ...suggestedQuestions.map((q) => `- ${q}`),
    ].join("\n");

    const evidencePack = chunks.map((c) => ({
      chunkId: c.id,
      docId: c.source,
      text: c.text,
      title: c.title,
      url: c.urlOrPath,
    }));
    const resolved = resolveCitations(rawBrief, evidencePack);

    const summaryForSlack =
      `Meeting prep for *${entry.orgName}*: stage \`${entry.stage}\`. ` +
      (entry.nextAction ? `Next: ${entry.nextAction}. ` : "") +
      (entry.stage === "proposal_sent"
        ? "Focus: decision process and close plan."
        : "Focus: align ask with priorities and confirm fit.");

    return {
      generatedAt: new Date().toISOString(),
      entryId,
      orgName: entry.orgName,
      stage: entry.stage,
      summaryForSlack,
      donorProfile,
      priorInteractions,
      proposalStatus,
      askStrategy,
      suggestedQuestions,
      briefText: resolved.resolvedText,
      references: resolved.references,
    };
  }
}
