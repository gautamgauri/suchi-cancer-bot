export type FlowStep =
  | "start"
  | "select_state"
  | "select_cancer_type"
  | "select_affordability"
  | "select_language"
  | "show_results"
  | "end";

export type AffordabilityLevel = "government_only" | "mixed" | "any";

export type CancerTypeGroup =
  | "oral_head_neck"
  | "breast"
  | "cervical_gynae"
  | "blood_cancers"
  | "gi_cancers"
  | "pediatric"
  | "other";

export interface NavigatorSession {
  sessionId: string;
  phone: string;
  step: FlowStep;
  state?: string;
  cancerType?: CancerTypeGroup;
  affordability?: AffordabilityLevel;
  language?: "hindi" | "english" | "bengali";
  createdAt: Date;
  updatedAt: Date;
}

export interface NavigatorMessage {
  text: string;
  options?: Array<{ key: string; label: string }>;
}
