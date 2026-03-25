import axios, { AxiosInstance } from 'axios';
import { ApiTrace } from '../types';

export interface ApiClientConfig {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  channel: string;
}

export class SuchiApiClient {
  private http: AxiosInstance;
  private channel: string;
  private retries: number;

  constructor(config: ApiClientConfig) {
    this.channel = config.channel;
    this.retries = config.retries;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'X-Suchi-Eval': 'true',
      },
    });
  }

  async createSession(): Promise<string> {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.http.post('/sessions', { channel: this.channel });
        return res.data.sessionId;
      } catch (err: any) {
        if (attempt < this.retries) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        } else {
          throw err;
        }
      }
    }
    throw new Error('createSession: unreachable');
  }

  async sendQuery(sessionId: string, userText: string): Promise<ApiTrace> {
    const start = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.http.post('/chat', {
          sessionId,
          channel: this.channel,
          userText,
        });

        const data = res.data;
        return {
          sessionId,
          messageId: data.messageId,
          responseText: data.responseText || '',
          safety: data.safety || { classification: 'unknown', actions: [] },
          citations: data.citations || [],
          retrievedChunks: data.retrievedChunks || [],
          citationConfidence: data.citationConfidence,
          abstentionReason: data.abstentionReason || null,
          latencyMs: Date.now() - start,
        };
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status || 'no-status';
        const body = err.response?.data
          ? JSON.stringify(err.response.data).slice(0, 200)
          : err.message;
        console.error(`    [attempt ${attempt + 1}/${this.retries + 1}] HTTP ${status}: ${body}`);
        if (attempt < this.retries) {
          const delay = Math.pow(2, attempt + 1) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    const axiosErr = lastError as any;
    const status = axiosErr?.response?.status || 'unknown';
    const body = axiosErr?.response?.data
      ? JSON.stringify(axiosErr.response.data).slice(0, 300)
      : lastError?.message || 'Unknown error';

    return {
      sessionId,
      responseText: '',
      safety: { classification: 'error', actions: [] },
      citations: [],
      retrievedChunks: [],
      latencyMs: Date.now() - start,
      error: `HTTP ${status}: ${body}`,
    };
  }

  async runCase(userText: string): Promise<ApiTrace> {
    const sessionId = await this.createSession();
    return this.sendQuery(sessionId, userText);
  }
}
