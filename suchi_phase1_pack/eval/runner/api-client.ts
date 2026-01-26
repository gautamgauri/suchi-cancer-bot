import axios, { AxiosInstance } from "axios";
import { ChatResponse } from "../types";

export class ApiClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private retries: number;

  constructor(baseUrl: string, timeoutMs: number = 120000, authorizationHeader?: string, retries: number = 2) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.retries = retries;
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    // Add authorization header if provided
    if (authorizationHeader) {
      headers["Authorization"] = `Bearer ${authorizationHeader}`;
    }
    
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers,
      timeout: timeoutMs,
    });
  }

  /**
   * Create a new session with retry logic for transient failures
   * @param channel Channel type (web, app, whatsapp)
   * @param cancerType Optional cancer type for session context (improves retrieval)
   * @param userContext Optional user context (general, patient, caregiver, post_diagnosis)
   */
  async createSession(
    channel: "web" | "app" | "whatsapp" = "web",
    cancerType?: string,
    userContext?: "general" | "patient" | "caregiver" | "post_diagnosis"
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const sessionData: Record<string, string> = { channel };
        if (cancerType) {
          sessionData.cancerType = cancerType;
        }
        if (userContext) {
          sessionData.userContext = userContext;
        }
        const response = await this.client.post<{ sessionId: string; createdAt: string }>("/sessions", sessionData);

        if (attempt > 0) {
          console.log(`  ✅ Session creation retry ${attempt} succeeded`);
        }

        return response.data.sessionId;
      } catch (error: any) {
        lastError = error;

        // Check if retryable (transient errors)
        const isRetryable =
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ECONNRESET' ||   // Connection reset
          error.response?.status === 500 || // Internal server error (cold start)
          error.response?.status === 502 || // Bad gateway
          error.response?.status === 503 || // Service unavailable
          error.response?.status === 504;   // Gateway timeout

        if (!isRetryable || attempt === this.retries) {
          throw new Error(`Failed to create session: ${error.message}`);
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`  ⚠️ Session creation attempt ${attempt + 1} failed (${error.message}), retrying in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(`Failed to create session after ${this.retries} retries: ${lastError?.message}`);
  }

  /**
   * Send a chat message with retry logic
   */
  async sendMessage(
    sessionId: string,
    userText: string,
    channel: "web" | "app" | "whatsapp" = "web"
  ): Promise<ChatResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.client.post<ChatResponse>("/chat", {
          sessionId,
          channel,
          userText,
        });
        
        if (attempt > 0) {
          console.log(`  ✅ Retry ${attempt} succeeded`);
        }
        
        return response.data;
      } catch (error: any) {
        lastError = error;
        
        // Check if retryable (transient errors)
        const isRetryable =
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ECONNRESET' ||   // Connection reset
          error.response?.status === 429 || // Rate limit
          error.response?.status === 500 || // Internal server error (cold start)
          error.response?.status === 502 || // Bad gateway
          error.response?.status === 503 || // Service unavailable
          error.response?.status === 504;   // Gateway timeout

        if (!isRetryable || attempt === this.retries) {
          throw new Error(`Failed to send message: ${error.message}`);
        }

        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        console.log(`  ⚠️ Attempt ${attempt + 1} failed (${error.message}), retrying in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(`Failed to send message after ${this.retries} retries: ${lastError?.message}`);
  }

  /**
   * Execute a multi-turn conversation
   * Returns the final response and all intermediate responses
   */
  async executeConversation(
    sessionId: string,
    userMessages: string[],
    channel: "web" | "app" | "whatsapp" = "web"
  ): Promise<{ 
    finalResponse: ChatResponse; 
    allResponses: ChatResponse[];
    timingMs: { perMessageMs: number[]; totalMs: number };
  }> {
    const allResponses: ChatResponse[] = [];
    const perMessageMs: number[] = [];
    const conversationStart = Date.now();

    for (const userMessage of userMessages) {
      const messageStart = Date.now();
      const response = await this.sendMessage(sessionId, userMessage, channel);
      const messageMs = Date.now() - messageStart;
      perMessageMs.push(messageMs);
      allResponses.push(response);
      
      // Small delay between messages to avoid rate limiting
      if (userMessages.indexOf(userMessage) < userMessages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const totalMs = Date.now() - conversationStart;
    return {
      finalResponse: allResponses[allResponses.length - 1],
      allResponses,
      timingMs: { perMessageMs, totalMs },
    };
  }

  /**
   * Extract response text from all responses (concatenated)
   */
  extractFullResponseText(responses: ChatResponse[]): string {
    return responses.map((r) => r.responseText).join("\n\n");
  }

  /**
   * Count clarifying questions in responses
   */
  countClarifyingQuestions(responses: ChatResponse[]): number {
    let count = 0;
    const questionPattern = /[?？]/;
    const interrogativePatterns = [
      /\bdo you\b/i,
      /\bare you\b/i,
      /\bhave you\b/i,
      /\bcan you\b/i,
      /\bwhen did\b/i,
      /\bhow long\b/i,
      /\bwhere\b/i,
      /\bwhich\b/i,
      /\bwhat\b.*\?/i,
      /\bwho\b.*\?/i,
    ];

    for (const response of responses) {
      const text = response.responseText;
      if (questionPattern.test(text)) {
        // Check if it contains interrogative patterns
        const hasInterrogative = interrogativePatterns.some((pattern) => pattern.test(text));
        if (hasInterrogative) {
          count++;
        }
      }
    }

    return count;
  }
}

