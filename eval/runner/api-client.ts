import axios, { AxiosInstance } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ChatResponse } from "../types";

export class ApiClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private retries: number;

  constructor(baseUrl: string, timeoutMs: number = 240000, authorizationHeader?: string, retries: number = 4) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.retries = retries;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Suchi-Eval": "true", // Mark all eval traffic for filtering in analytics
    };

    // Add authorization header if provided
    if (authorizationHeader) {
      headers["Authorization"] = `Bearer ${authorizationHeader}`;
    }

    // Use HTTPS proxy if configured (required in environments where DNS
    // resolution only works through a proxy, e.g. Cloud Code containers)
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
    const axiosConfig: any = {
      baseURL: this.baseUrl,
      headers,
      timeout: timeoutMs,
    };

    if (proxyUrl) {
      axiosConfig.httpsAgent = new HttpsProxyAgent(proxyUrl);
      // Disable axios's built-in proxy handling since we use the agent
      axiosConfig.proxy = false;
    }

    this.client = axios.create(axiosConfig);
  }

  /**
   * Check if an error is retryable (transient Cloud Run / LLM issues)
   */
  private isRetryableError(error: any): boolean {
    // Network-level errors
    if (error.code === 'ECONNABORTED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }

    const status = error.response?.status;

    // Standard retryable HTTP statuses
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
      return true;
    }

    return false;
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

        if (!this.isRetryableError(error) || attempt === this.retries) {
          throw new Error(`Failed to create session: ${error.message}`);
        }

        // Exponential backoff: 2s, 4s, 8s, 16s
        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        console.log(`  ⚠️ Session creation attempt ${attempt + 1} failed (${error.response?.status || error.code || error.message}), retrying in ${backoffMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(`Failed to create session after ${this.retries} retries: ${lastError?.message}`);
  }

  /**
   * Send a chat message with retry logic.
   * Retries transient Cloud Run / LLM failures with exponential backoff.
   * If every attempt times out, surface that as an explicit timeout failure
   * so eval reporting distinguishes infra latency from model quality.
   */
  async sendMessage(
    sessionId: string,
    userText: string,
    channel: "web" | "app" | "whatsapp" = "web"
  ): Promise<ChatResponse> {
    let lastError: Error | null = null;
    let allTimeouts = true;

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

        const isTimeout =
          error.code === 'ECONNABORTED' ||
          error.response?.status === 504;

        if (!isTimeout) {
          allTimeouts = false;
        }

        // Check if retryable (transient errors)
        const isRetryable =
          isTimeout ||
          error.code === 'ECONNRESET' ||   // Connection reset
          error.response?.status === 429 || // Rate limit
          error.response?.status === 500 || // Internal server error (cold start)
          error.response?.status === 502 || // Bad gateway
          error.response?.status === 503;   // Service unavailable

        if (!isRetryable || attempt === this.retries) {
          if (allTimeouts) {
            const err = new Error(
              `All ${attempt + 1} attempts timed out (504). API unreachable or overloaded.`
            );
            (err as any).timedOut = true;
            throw err;
          }
          throw new Error(`Failed to send message: ${error.message}`);
        }

        // Exponential backoff: 4s, 8s, 16s, 32s (longer delays for Cloud Run)
        const backoffMs = Math.pow(2, attempt + 2) * 1000;
        const reason = error.response?.status === 504 ? "504 LLM timeout" : (error.response?.status || error.code || error.message);
        console.log(`  ⚠️ Attempt ${attempt + 1} failed (${reason}), retrying in ${backoffMs / 1000}s...`);
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

      // Delay between messages to avoid rate limiting on Cloud Run
      if (userMessages.indexOf(userMessage) < userMessages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
   * Warm up the Cloud Run service by sending a simple request.
   * Retries multiple times with backoff since cold starts can take a while.
   * Returns true if the API is responsive, false otherwise.
   */
  async warmUp(maxAttempts: number = 3): Promise<boolean> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const sessionId = await this.createSession("web");
        const response = await this.sendMessage(sessionId, "hello", "web");
        // Check if we got a real response (not a timeout placeholder)
        if (response.responseText && !response.responseText.includes("high load")) {
          return true;
        }
        console.log(`  ⚠️ Warm-up attempt ${attempt + 1}: API responded but LLM timed out, retrying...`);
      } catch (error: any) {
        console.log(`  ⚠️ Warm-up attempt ${attempt + 1} failed: ${error.message}`);
      }
      // Wait before retry
      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    return false;
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
