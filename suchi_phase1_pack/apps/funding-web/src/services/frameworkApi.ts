import { fundingApi } from "./fundingApi";

// Taxonomy
export interface FrameworkCapability {
  id: string;
  capabilityId: string;
  name: string;
  definitionShort: string;
  definitionLong?: string;
  subdimensions?: string[];
  biharContextExamples?: string[];
  measurementIdeas?: string[];
}

export interface FrameworkMI {
  id: string;
  miId: string;
  name: string;
  definitionShort: string;
  activitySignals?: string[];
  assessmentArtifacts?: string[];
}

// Project tags
export interface ProjectTagCapability {
  capabilityId: string;
  name: string;
  isPrimary: boolean;
  strength: number | null;
  isApplicable: boolean;
}

export interface ProjectTagsResponse {
  capabilities: ProjectTagCapability[];
}

/** Individual capability tag for a project */
export interface CapabilityTagInput {
  capabilityId: string;
  isPrimary: boolean;
  strength: number | null;
  isApplicable: boolean;
}

/** Payload for tagging a project with capabilities */
export interface TagProjectPayload {
  tags: CapabilityTagInput[];
}

// Method cards
export interface MethodCard {
  id: string;
  methodId: string;
  title: string;
  intent: string;
  steps: string[];
  whenToUse: string | null;
  whenNotToUse: string | null;
  ageBand: string | null;
  settingTags: string[];
  assessmentArtifacts: string[];
  miTagsPrimary: string[];
  miTagsSecondary: string[];
  capabilityLinks: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

// Pattern cards
export interface PatternCard {
  id: string;
  patternId: string;
  title: string;
  durationMins: number | null;
  materials: string[];
  facilitatorScript: string[];
  adaptations: string[];
  assessmentArtifacts: string[];
  miTagsPrimary: string[];
  miTagsSecondary: string[];
  capabilitiesPrimary: string[];
  capabilitiesSecondary: string[];
  evidenceLevel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// Comparable cases
export interface ComparableCase {
  id: string;
  caseId: string;
  programName: string;
  orgName: string;
  geography: string;
  targetGroup: string;
  deliveryModelTags: string[];
  outcomesSummary: string;
  indicatorsUsed: string[];
  costNotes: string | null;
  programConstraints: string | null;
  contextConstraints: string | null;
  transferabilityBihar: string | null;
  confidenceScore: number;
  capabilitiesPrimary: string[];
  capabilitiesSecondary: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const frameworkApi = {
  async listCapabilities(): Promise<FrameworkCapability[]> {
    const { data } = await fundingApi.get<FrameworkCapability[]>("/framework/capabilities");
    return data;
  },

  async listMIModalities(): Promise<FrameworkMI[]> {
    const { data } = await fundingApi.get<FrameworkMI[]>("/framework/mi-modalities");
    return data;
  },

  async getProjectTags(projectId: string): Promise<ProjectTagsResponse> {
    const { data } = await fundingApi.get<ProjectTagsResponse>(`/framework/project-tags/${projectId}`);
    return data;
  },

  async tagProject(projectId: string, payload: TagProjectPayload): Promise<ProjectTagsResponse> {
    const { data } = await fundingApi.post<ProjectTagsResponse>(
      `/framework/tag-project/${projectId}`,
      payload
    );
    return data;
  },

  async listMethodCards(params?: {
    capabilities?: string[];
    miModalities?: string[];
    ageBand?: string;
    setting?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<MethodCard[]> {
    const searchParams = new URLSearchParams();
    if (params?.capabilities?.length)
      searchParams.set("capabilities", params.capabilities.join(","));
    if (params?.miModalities?.length)
      searchParams.set("miModalities", params.miModalities.join(","));
    if (params?.ageBand) searchParams.set("ageBand", params.ageBand);
    if (params?.setting) searchParams.set("setting", params.setting);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit != null) searchParams.set("limit", String(params.limit));
    if (params?.offset != null) searchParams.set("offset", String(params.offset));
    const q = searchParams.toString();
    const { data } = await fundingApi.get<MethodCard[]>(
      `/framework/method-cards${q ? `?${q}` : ""}`
    );
    return data;
  },

  async getMethodCard(id: string): Promise<MethodCard | { error: string }> {
    const { data } = await fundingApi.get<MethodCard | { error: string }>(
      `/framework/method-cards/${id}`
    );
    return data;
  },

  async listPatternCards(params?: {
    capabilities?: string[];
    miModalities?: string[];
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<PatternCard[]> {
    const searchParams = new URLSearchParams();
    if (params?.capabilities?.length)
      searchParams.set("capabilities", params.capabilities.join(","));
    if (params?.miModalities?.length)
      searchParams.set("miModalities", params.miModalities.join(","));
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit != null) searchParams.set("limit", String(params.limit));
    if (params?.offset != null) searchParams.set("offset", String(params.offset));
    const q = searchParams.toString();
    const { data } = await fundingApi.get<PatternCard[]>(
      `/framework/pattern-cards${q ? `?${q}` : ""}`
    );
    return data;
  },

  async getPatternCard(id: string): Promise<PatternCard | { error: string }> {
    const { data } = await fundingApi.get<PatternCard | { error: string }>(
      `/framework/pattern-cards/${id}`
    );
    return data;
  },

  async listComparableCases(params?: {
    capabilities?: string[];
    targetGroup?: string;
    geography?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<ComparableCase[]> {
    const searchParams = new URLSearchParams();
    if (params?.capabilities?.length)
      searchParams.set("capabilities", params.capabilities.join(","));
    if (params?.targetGroup) searchParams.set("targetGroup", params.targetGroup);
    if (params?.geography) searchParams.set("geography", params.geography);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit != null) searchParams.set("limit", String(params.limit));
    if (params?.offset != null) searchParams.set("offset", String(params.offset));
    const q = searchParams.toString();
    const { data } = await fundingApi.get<ComparableCase[]>(
      `/framework/comparable-cases${q ? `?${q}` : ""}`
    );
    return data;
  },

  async getComparableCase(id: string): Promise<ComparableCase | { error: string }> {
    const { data } = await fundingApi.get<ComparableCase | { error: string }>(
      `/framework/comparable-cases/${id}`
    );
    return data;
  },
};
