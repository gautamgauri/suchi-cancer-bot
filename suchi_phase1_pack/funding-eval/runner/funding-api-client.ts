import axios, { AxiosInstance, AxiosError } from "axios";
import type { FundingTestCase, EvidenceChunk, ConversationContext } from "../types.js";

// Re-export citation integrity functions from the dedicated module
export {
  countCitations,
  hasAbstain,
  hasPlaceholder,
  validateCitationIntegrity,
  type CitationIntegrityResult,
} from "./citation-integrity.js";

export interface FundingApiClientOptions {
  timeoutMs?: number;
  exportToken?: string;
}

export class FundingApiClient {
  private client: AxiosInstance;

  constructor(baseUrl: string, timeoutMs = 60_000, options: FundingApiClientOptions = {}) {
    const base = baseUrl.replace(/\/$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options?.exportToken) {
      headers["Authorization"] = `Bearer ${options.exportToken}`;
    }
    this.client = axios.create({
      baseURL: base,
      timeout: options?.timeoutMs ?? timeoutMs,
      headers,
    });
  }

  private v1(path: string): string {
    return path.startsWith("/v1") ? path : `/v1${path.startsWith("/") ? path : `/${path}`}`;
  }

  private qs(query?: Record<string, string | number>): string {
    if (!query || Object.keys(query).length === 0) return "";
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) s.set(k, String(v));
    }
    const str = s.toString();
    return str ? `?${str}` : "";
  }

  // --- Draft ---
  async draftNeedStatement(
    context: string,
    userMessage: string,
    chunks: FundingTestCase["chunks"] = [],
    conversationContext?: ConversationContext
  ): Promise<{ text: string }> {
    const { data } = await this.client.post<{ text: string }>(this.v1("/draft/need-statement"), {
      context,
      userMessage,
      chunks: chunks ?? [],
      conversationContext,
    });
    return data;
  }

  async draftNeedStatementRefine(
    context: string,
    userMessage: string,
    chunks: FundingTestCase["chunks"] = [],
    conversationContext?: ConversationContext
  ): Promise<{ draft: string; evaluation: { score: number; weaknesses: string[] }; refined: string; warning?: string }> {
    const { data } = await this.client.post<
      { draft: string; evaluation: { score: number; weaknesses: string[] }; refined: string; warning?: string }
    >(this.v1("/draft/need-statement/refine"), {
      context,
      userMessage,
      chunks: chunks ?? [],
      conversationContext,
    });
    return data;
  }

  async draftEmail(payload: {
    template: string;
    context: string;
    pipelineContext?: Record<string, string>;
    donorProfileSnippet?: string;
    chunks?: EvidenceChunk[];
  }): Promise<{ text: string }> {
    const { data } = await this.client.post<{ text: string }>(this.v1("/draft/email"), payload);
    return data;
  }

  // --- Donor ---
  async donorProfileGenerate(contextOrPayload: string | { orgName: string; urls?: string[]; notes?: string; chunks?: Array<{ content: string; title?: string; url?: string }> }): Promise<{ profile: unknown; evidenceGaps: string[] }> {
    const body = typeof contextOrPayload === "string"
      ? { orgName: contextOrPayload }
      : { orgName: contextOrPayload.orgName, urls: contextOrPayload.urls, notes: contextOrPayload.notes, chunks: contextOrPayload.chunks };
    const { data } = await this.client.post<{ profile: unknown; evidenceGaps: string[] }>(
      this.v1("/donor/profile/generate"),
      body
    );
    return data;
  }

  // --- Pipeline ---
  async pipelineList(): Promise<{ entries: unknown[] }> {
    const { data } = await this.client.get<{ entries: unknown[] }>(this.v1("/pipeline"));
    return data;
  }

  async pipelineGet(id: string): Promise<unknown> {
    const { data } = await this.client.get(this.v1(`/pipeline/${id}`));
    return data;
  }

  async pipelineCreate(body: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/pipeline"), body);
    return data;
  }

  async pipelineUpdate(id: string, body: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.patch(this.v1(`/pipeline/${id}`), body);
    return data;
  }

  async pipelineLogActivity(body: { donorId?: string; orgId?: string; type: string; notes?: string; timestamp?: string; createdBy?: string }): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/pipeline/activity"), body);
    return data;
  }

  async pipelineGetActivities(entryId: string): Promise<{ activities: unknown[] }> {
    const { data } = await this.client.get<{ activities: unknown[] }>(this.v1(`/pipeline/${entryId}/activities`));
    return data;
  }

  // --- Opportunity ---
  async opportunityList(query?: { status?: string; limit?: number; offset?: number }): Promise<{ items: unknown[]; total: number }> {
    const q = query ? this.qs(query as Record<string, string | number>) : "";
    const { data } = await this.client.get<{ items: unknown[]; total: number }>(this.v1("/opportunities") + q);
    return data;
  }

  async opportunityGet(id: string): Promise<unknown> {
    const { data } = await this.client.get(this.v1(`/opportunities/${id}`));
    return data;
  }

  async opportunityCreate(body: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/opportunities"), body);
    return data;
  }

  async opportunityUpdate(id: string, body: Record<string, unknown>): Promise<unknown> {
    const { data } = await this.client.patch(this.v1(`/opportunities/${id}`), body);
    return data;
  }

  async opportunityIngestFromEmail(messageId: string): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/opportunities/ingest-from-email"), { messageId });
    return data;
  }

  // --- Proposal ---
  // Proposal generation involves multiple sequential LLM calls (10+ sections, each with RAG + LLM + citation enforcement).
  // With improved prompts and citation tracking, total time is 6-8 minutes.
  async proposalGenerate(opportunityId: string, options?: Record<string, unknown>): Promise<{ runId: string; status?: string; sections?: unknown[] }> {
    const PROPOSAL_TIMEOUT_MS = 600_000; // 10 minutes for multi-step LLM pipeline with citations
    const { data } = await this.client.post<{ runId: string; status?: string; sections?: unknown[] }>(
      this.v1("/proposals/generate"),
      { opportunityId, options },
      { timeout: PROPOSAL_TIMEOUT_MS }
    );
    return data;
  }

  async proposalGetRun(runId: string): Promise<unknown> {
    const { data } = await this.client.get(this.v1(`/proposals/${runId}`));
    return data;
  }

  async proposalGetGaps(runId: string): Promise<unknown> {
    const { data } = await this.client.get(this.v1(`/proposals/${runId}/gaps`));
    return data;
  }

  async proposalRegenerateSection(runId: string, sectionName: string, body?: { additionalContext?: string; userNotes?: string }): Promise<unknown> {
    const { data } = await this.client.post(this.v1(`/proposals/${runId}/sections/${encodeURIComponent(sectionName)}/regenerate`), body ?? {});
    return data;
  }

  // --- Orchestrator ---
  async orchestratorRun(
    opportunityId: string,
    options?: {
      proposalOptions?: Record<string, unknown>;
      skipGmail?: boolean;
      skipBudget?: boolean;
      skipWebEvidence?: boolean;
      forceGenerate?: boolean;
    },
  ): Promise<{ runId?: string; proposalRunId?: string; fitScore?: number; fitDecision?: string; gmailBlocks?: number; budgetEnvelope?: unknown; webEvidenceChunks?: number; sections?: unknown[]; error?: string }> {
    const ORCHESTRATOR_TIMEOUT_MS = 900_000; // 15 minutes for full pipeline
    const { data } = await this.client.post(
      this.v1("/orchestrator/run"),
      { opportunityId, ...options },
      { timeout: ORCHESTRATOR_TIMEOUT_MS },
    );
    return data;
  }

  async orchestratorAssess(
    opportunityId: string,
  ): Promise<{ fitScore?: number; fitDecision?: string; gaps?: unknown[]; recommendations?: unknown[] }> {
    const ASSESS_TIMEOUT_MS = 120_000; // 2 minutes
    const { data } = await this.client.post(
      this.v1("/orchestrator/assess"),
      { opportunityId },
      { timeout: ASSESS_TIMEOUT_MS },
    );
    return data;
  }

  // --- Framework ---
  async frameworkRetrieve(body: {
    capabilities?: string[];
    miModalities?: string[];
    cardTypes?: ("method" | "pattern" | "comparable")[];
    targetGroup?: string;
    ageBand?: string;
    setting?: string;
    limit?: number;
  }): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/framework/retrieve"), body);
    return data;
  }

  async frameworkListMethodCards(query?: Record<string, string | number>): Promise<unknown> {
    const q = query ? this.qs(query) : "";
    const { data } = await this.client.get(this.v1("/framework/method-cards") + q);
    return data;
  }

  async frameworkRecommendMethods(query: { ageBand: string; setting: string; capabilities?: string; miModalities?: string; methodLimit?: number; patternLimit?: number }): Promise<unknown> {
    const { data } = await this.client.get(this.v1("/framework/recommend/methods") + this.qs(query as Record<string, string | number>));
    return data;
  }

  async frameworkCheckConsistency(body: { draftText: string; claimedCapabilities: string[]; projectId?: string; [key: string]: unknown }): Promise<{ overallScore?: number; passesQualityGate?: boolean; flags?: unknown[] }> {
    const { data } = await this.client.post(this.v1("/framework/check/consistency"), body);
    return data;
  }

  async frameworkGenerateMelPack(body: { capabilities: string[]; targetGroup: string; projectId?: string; [key: string]: unknown }): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/framework/generate/mel-pack"), body);
    return data;
  }

  // --- Evidence (optional export token) ---
  async evidenceRetrieve(body: { query: string; mode?: string; limit?: number; publicSafeOnly?: boolean; visibilityScope?: string }): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/evidence-ingest/retrieve"), body);
    return data;
  }

  async evidenceEval(body?: { mode?: string; limit?: number; queries?: string[] }): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/evidence-ingest/eval"), body ?? {});
    return data;
  }

  async evidenceRecallEval(body?: { mode?: string; limit?: number }): Promise<unknown> {
    const { data } = await this.client.post(this.v1("/evidence-ingest/eval/recall"), body ?? {});
    return data;
  }

  // --- Approvals ---
  async approvalsCreateArtifact(pipelineEntryId: string, type: string): Promise<{ id: string; pipelineEntryId: string; type: string }> {
    const { data } = await this.client.post<{ id: string; pipelineEntryId: string; type: string }>(this.v1("/approvals/artifacts"), { pipelineEntryId, type });
    return data;
  }

  async approvalsCreateVersion(artifactId: string, content: string, createdBy?: string): Promise<{ id: string; artifactId: string; content: string }> {
    const { data } = await this.client.post<{ id: string; artifactId: string; content: string }>(
      this.v1(`/approvals/artifacts/${artifactId}/versions`),
      { content, createdBy }
    );
    return data;
  }

  async approvalsSubmitApproval(versionId: string, status: string, decidedBy?: string, comment?: string): Promise<unknown> {
    const { data } = await this.client.post(this.v1(`/approvals/versions/${versionId}/approve`), { status, decidedBy, comment });
    return data;
  }

  async approvalsGetPendingForEntry(pipelineEntryId: string): Promise<{ pending: unknown[] }> {
    const { data } = await this.client.get<{ pending: unknown[] }>(this.v1(`/approvals/entries/${pipelineEntryId}/pending`));
    return data;
  }

  async approvalsGetArtifactsForEntry(pipelineEntryId: string): Promise<{ artifacts: unknown[] }> {
    const { data } = await this.client.get<{ artifacts: unknown[] }>(this.v1(`/approvals/entries/${pipelineEntryId}/artifacts`));
    return data;
  }

  async approvalsGetVersionsForArtifact(artifactId: string): Promise<{ versions: unknown[] }> {
    const { data } = await this.client.get<{ versions: unknown[] }>(this.v1(`/approvals/artifacts/${artifactId}/versions`));
    return data;
  }

  /** Get HTTP status from an axios error if present */
  static getStatus(err: unknown): number | undefined {
    if (err && typeof err === "object" && "response" in err) {
      const res = (err as AxiosError).response;
      return res && typeof res === "object" && "status" in res ? (res as { status: number }).status : undefined;
    }
    return undefined;
  }
}
