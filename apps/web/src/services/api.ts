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
  /**
   * Set to "timeout" when the API gave up on the turn after 55s and answered
   * with its fallback copy instead of a real answer (issue #171). There is no
   * stored message behind such a reply — it is not rateable.
   */
  error?: "timeout";
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

/**
 * The API answers a 55-second turn timeout with HTTP 504 whose *body* is still
 * user-facing: `chat.controller.ts` composes the Indian Cancer Society helpline
 * and the 112/108 emergency numbers there, and that is the only copy the server
 * produces on this path. axios rejects on 504, so without this the body is
 * dropped and the patient sees a generic "there was an error" (issue #171).
 *
 * Returns null for anything else — including a bodyless 504 from the
 * infrastructure (Cloud Run's own request cap, a proxy), which carries nothing
 * we can show a patient and must keep the generic error path.
 */
function timeoutFallbackFrom(err: unknown): ChatResponse | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 504) return null;

  const body = err.response.data as Record<string, unknown> | undefined;
  const responseText = body?.responseText;
  if (typeof responseText !== "string" || responseText.trim() === "") return null;

  const rawSafety = (body?.safety ?? {}) as Partial<ChatResponse["safety"]>;

  return {
    sessionId: typeof body?.sessionId === "string" ? body.sessionId : "",
    // The turn aborted before a message row was written, so there is no
    // server-side messageId. This one is a React render key only.
    messageId: `timeout-${Date.now()}`,
    responseText,
    safety: {
      classification: rawSafety.classification ?? "normal",
      actions: Array.isArray(rawSafety.actions) ? rawSafety.actions : [],
      ...(rawSafety.bannerText ? { bannerText: rawSafety.bannerText } : {})
    },
    error: "timeout"
  };
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
    try {
      const response = await api.post<ChatResponse>("/chat", data);
      return response.data;
    } catch (err) {
      const fallback = timeoutFallbackFrom(err);
      if (fallback) return fallback;
      throw err;
    }
  },

  async submitFeedback(data: FeedbackRequest): Promise<FeedbackResponse> {
    const response = await api.post<FeedbackResponse>("/feedback", data);
    return response.data;
  }
};





















