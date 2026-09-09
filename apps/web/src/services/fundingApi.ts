import axios, { AxiosInstance } from "axios";

const DEFAULT_BASE_URL =
  import.meta.env.VITE_FUNDING_API_URL ?? "http://localhost:3001/v1";

const STORAGE_KEY = "funding_api_base_url";

function getStoredBaseURL(): string {
  try {
    const u = localStorage.getItem(STORAGE_KEY);
    if (u && u.trim()) return u.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_BASE_URL;
}

export function getFundingApiBaseURL(): string {
  return getStoredBaseURL();
}

export function setFundingApiBaseURL(url: string): void {
  const trimmed = url.trim();
  if (trimmed) {
    try {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* ignore */
    }
  }
  fundingApi.defaults.baseURL = trimmed || DEFAULT_BASE_URL;
}

export const fundingApi: AxiosInstance = axios.create({
  baseURL: getStoredBaseURL(),
  headers: { "Content-Type": "application/json" },
});

// Pipeline
export type PipelineStage =
  | "RFP_received"
  | "lead"
  | "qualified"
  | "proposal_sent"
  | "won"
  | "lost";

export interface PipelineEntry {
  id: string;
  orgName: string;
  contactName?: string;
  contactEmail?: string;
  stage: PipelineStage;
  owner?: string;
  assignedTo?: string;
  nextAction?: string;
  nextActionDate?: string;
  lastContactDate?: string;
  probability?: number;
  notes?: string;
  sectorTags?: string[];
  geography?: string;
  estimatedGrantSize?: string;
  deadline?: string;
  submissionEmail?: string;
  driveFolderUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
}

export type ActivityType =
  | "email_sent"
  | "call"
  | "meeting"
  | "proposal_submitted"
  | "note";

export interface ActivityRecord {
  id: string;
  donorId?: string;
  orgId?: string;
  type: ActivityType;
  notes?: string;
  timestamp: string;
  createdBy?: string;
}

export interface LogActivityPayload {
  donorId?: string;
  orgId?: string;
  type: ActivityType;
  notes?: string;
  timestamp?: string;
  createdBy?: string;
}

export interface PipelineResponse {
  entries: PipelineEntry[];
}

export interface ActivitiesResponse {
  activities: ActivityRecord[];
}

// Draft
export type EmailTemplate =
  | "intro"
  | "follow_up"
  | "meeting_request"
  | "proposal_nudge"
  | "thank_you";

export interface DraftEmailRequest {
  template: EmailTemplate;
  context: string;
  pipelineContext?: {
    orgName?: string;
    contactName?: string;
    stage?: string;
    nextAction?: string;
    notes?: string;
  };
  donorProfileSnippet?: string;
  chunks?: Array<{ id: string; source: string; text: string; title?: string; urlOrPath?: string }>;
}

export interface DraftNeedStatementRequest {
  context: string;
  userMessage: string;
  chunks: Array<{ id: string; source: string; text: string; title?: string; urlOrPath?: string }>;
  conversationContext?: { funderName?: string; intent?: string; checklist?: string };
}

export interface DraftEmailResponse {
  text: string;
}

export interface DraftRefineResponse {
  draft: string;
  evaluation: { score: number; weaknesses: string[] };
  refined: string;
}

export const fundingApiService = {
  getBaseURL: () => getFundingApiBaseURL(),

  async getHealth(): Promise<{ ok: boolean }> {
    const { data } = await fundingApi.get<{ ok: boolean }>("/health");
    return data;
  },

  async getVersion(): Promise<{ service: string; gitSha?: string }> {
    const { data } = await fundingApi.get<{ service: string; gitSha?: string }>("/version");
    return data;
  },

  async getPipeline(): Promise<PipelineResponse> {
    const { data } = await fundingApi.get<PipelineResponse>("/pipeline");
    return data;
  },

  async getEntry(id: string): Promise<PipelineEntry> {
    const { data } = await fundingApi.get<PipelineEntry>(`/pipeline/${id}`);
    return data;
  },

  async getActivitiesForEntry(id: string): Promise<ActivitiesResponse> {
    const { data } = await fundingApi.get<ActivitiesResponse>(`/pipeline/${id}/activities`);
    return data;
  },

  async logActivity(payload: LogActivityPayload): Promise<ActivityRecord> {
    const { data } = await fundingApi.post<ActivityRecord>("/pipeline/activity", payload);
    return data;
  },

  async draftEmail(body: DraftEmailRequest): Promise<DraftEmailResponse> {
    const { data } = await fundingApi.post<DraftEmailResponse>("/draft/email", body);
    return data;
  },

  async draftNeedStatementRefine(
    body: DraftNeedStatementRequest
  ): Promise<DraftRefineResponse> {
    const { data } = await fundingApi.post<DraftRefineResponse>(
      "/draft/need-statement/refine",
      body
    );
    return data;
  },
};
