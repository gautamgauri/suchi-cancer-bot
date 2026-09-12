import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/v1";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

export type UserRole = "patient_caregiver" | "community_member" | "field_worker" | "unknown";

export interface CreateSessionRequest {
  channel: "web" | "app" | "whatsapp";
  locale?: string;
  userType?: string;
  userRole?: UserRole;
}

export interface CreateSessionResponse {
  sessionId: string;
  createdAt: string;
}

export type InputMode = "typed" | "voice";

export interface ChatRequest {
  sessionId: string;
  channel: "web" | "app" | "whatsapp";
  userText: string;
  locale?: string;
  userType?: string;
  /** "voice" when the text came from the browser mic (Web Speech API); lets the API apply speech cleanup only to spoken input. */
  inputMode?: InputMode;
}

export interface ChatResponse {
  sessionId: string;
  messageId: string;
  responseText: string;
  safety: {
    classification: "normal" | "refusal" | "red_flag" | "self_harm";
    actions: Array<"show_emergency_banner" | "suggest_doctor_visit" | "end_conversation">;
    /**
     * Escalation copy for the emergency banner, sent with
     * `show_emergency_banner`. Optional: older API builds omit it, and the
     * client then slices `responseText` instead (see resolveEscalationText).
     */
    bannerText?: string;
  };
}

export interface FeedbackRequest {
  sessionId: string;
  messageId?: string;
  rating: "up" | "down";
  reason?: string;
  comment?: string;
}

export interface FeedbackResponse {
  id: string;
  createdAt: string;
}

export interface SessionInfo {
  sessionId: string;
  createdAt: string;
  greetingCompleted: boolean;
  currentGreetingStep: number | null;
  userContext: string | null;
  cancerType: string | null;
}

export const apiService = {
  async createSession(data: CreateSessionRequest): Promise<CreateSessionResponse> {
    const response = await api.post<CreateSessionResponse>("/sessions", data);
    return response.data;
  },

  async getSession(sessionId: string): Promise<SessionInfo> {
    const response = await api.get<SessionInfo>(`/sessions/${sessionId}`);
    return response.data;
  },

  async sendMessage(data: ChatRequest): Promise<ChatResponse> {
    const response = await api.post<ChatResponse>("/chat", data);
    return response.data;
  },

  async submitFeedback(data: FeedbackRequest): Promise<FeedbackResponse> {
    const response = await api.post<FeedbackResponse>("/feedback", data);
    return response.data;
  }
};





















