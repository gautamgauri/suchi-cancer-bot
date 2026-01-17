import axios, { AxiosInstance } from "axios";
import { ChatResponse } from "../types";

export class ApiClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string, timeoutMs: number = 120000, authorizationHeader?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
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
   * Create a new session
   */
  async createSession(channel: "web" | "app" | "whatsapp" = "web"): Promise<string> {
    try {
      const response = await this.client.post<{ sessionId: string; createdAt: string }>("/sessions", {
        channel,
      });
      return response.data.sessionId;
    } catch (error: any) {
      throw new Error(`Failed to create session: ${error.message}`);
    }
  }

  /**
   * Send a chat message
   */
  async sendMessage(
    sessionId: string,
    userText: string,
    channel: "web" | "app" | "whatsapp" = "web"
  ): Promise<ChatResponse> {
    try {
      const response = await this.client.post<ChatResponse>("/chat", {
        sessionId,
        channel,
        userText,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Execute a multi-turn conversation
   * Returns the final response and all intermediate responses
   */
  async executeConversation(
    sessionId: string,
    userMessages: string[],
    channel: "web" | "app" | "whatsapp" = "web"
  ): Promise<{ finalResponse: ChatResponse; allResponses: ChatResponse[] }> {
    const allResponses: ChatResponse[] = [];

    for (const userMessage of userMessages) {
      const response = await this.sendMessage(sessionId, userMessage, channel);
      allResponses.push(response);
      
      // Small delay between messages to avoid rate limiting
      if (userMessages.indexOf(userMessage) < userMessages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return {
      finalResponse: allResponses[allResponses.length - 1],
      allResponses,
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

