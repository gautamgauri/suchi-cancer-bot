import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "/v1";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

export interface CreateSessionRequest {
  channel: "web" | "app" | "whatsapp";
  locale?: string;
  userType?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  createdAt: string;
}

export interface ChatRequest {
  sessionId: string;
  channel: "web" | "app" | "whatsapp";
  userText: string;
  locale?: string;
  userType?: string;
}

export interface ChatResponse {
  sessionId: string;
  messageId: string;
  responseText: string;
  safety: {
    classification: "normal" | "refusal" | "red_flag" | "self_harm";
    actions: Array<"show_emergency_banner" | "suggest_doctor_visit" | "end_conversation">;
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

export const apiService = {
  async createSession(data: CreateSessionRequest): Promise<CreateSessionResponse> {
    const response = await api.post<CreateSessionResponse>("/sessions", data);
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





















