import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { VoiceTransportResult } from '../types/voice';

/**
 * Voice API client — supports HTTP multipart and WebSocket transports.
 * Follows eval/runner/api-client.ts pattern with retry logic.
 */
export class VoiceApiClient {
  private httpClient: AxiosInstance;
  private baseUrl: string;
  private retries: number;

  constructor(
    baseUrl: string,
    timeoutMs = 120000,
    authBearer?: string,
    retries = 2,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.retries = retries;

    const headers: Record<string, string> = {
      'X-Suchi-Eval': 'true',
    };
    if (authBearer) {
      headers['Authorization'] = `Bearer ${authBearer}`;
    }

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      headers,
      timeout: timeoutMs,
    });
  }

  /**
   * Create a session for voice testing.
   */
  async createSession(channel = 'voice'): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.httpClient.post<{
          sessionId: string;
        }>('/sessions', { channel });
        return response.data.sessionId;
      } catch (error: any) {
        lastError = error;
        const isRetryable =
          error.code === 'ECONNABORTED' ||
          error.code === 'ECONNRESET' ||
          error.response?.status >= 500;

        if (!isRetryable || attempt === this.retries) {
          throw new Error(
            `Failed to create session: ${error.message}`,
          );
        }

        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(
          `  Retry session creation in ${backoffMs}ms...`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    throw new Error(
      `Failed to create session: ${lastError?.message}`,
    );
  }

  /**
   * Send audio via HTTP multipart POST to /voice/respond.
   */
  async sendVoiceHttp(
    sessionId: string,
    audioFilePath: string,
    locale = 'hi-IN',
  ): Promise<VoiceTransportResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('audio', fs.createReadStream(audioFilePath), {
          filename: path.basename(audioFilePath),
          contentType: 'audio/wav',
        });
        form.append('sessionId', sessionId);
        form.append('locale', locale);

        const response = await this.httpClient.post(
          '/voice/respond',
          form,
          {
            headers: {
              ...form.getHeaders(),
              'X-Suchi-Eval': 'true',
            },
            timeout: 120000,
          },
        );

        const data = response.data;
        return {
          transport: 'http',
          sessionId: data.sessionId,
          transcript: data.transcript,
          confidence: data.confidence,
          responseText: data.responseText,
          voiceResponseText: data.voiceResponseText,
          audioUrl: data.audioUrl,
          safety: data.safety,
          latency: data.latency,
          messageId: data.messageId,
        };
      } catch (error: any) {
        lastError = error;
        const isRetryable =
          error.code === 'ECONNABORTED' ||
          error.code === 'ECONNRESET' ||
          error.response?.status >= 500;

        if (!isRetryable || attempt === this.retries) {
          throw new Error(
            `HTTP voice request failed: ${error.message}`,
          );
        }

        const backoffMs = Math.pow(2, attempt + 1) * 1000;
        console.log(`  Retry voice request in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    throw new Error(
      `HTTP voice request failed: ${lastError?.message}`,
    );
  }

  /**
   * Send audio via WebSocket (socket.io) to /v1/voice/stream.
   */
  async sendVoiceWs(
    sessionId: string,
    audioFilePath: string,
    locale = 'hi-IN',
  ): Promise<VoiceTransportResult> {
    const { io } = await import('socket.io-client');

    return new Promise<VoiceTransportResult>((resolve, reject) => {
      const wsUrl = this.baseUrl.replace(/^http/, 'ws');
      const socket = io(`${wsUrl}/v1/voice/stream`, {
        transports: ['websocket'],
        timeout: 30000,
      });

      const timeout = setTimeout(() => {
        socket.disconnect();
        reject(new Error('WebSocket timeout after 30s'));
      }, 30000);

      socket.on('connect', () => {
        // Start audio session
        socket.emit('audio:start', { sessionId, locale });
      });

      socket.on('audio:ready', () => {
        // Send audio chunks
        const audioData = fs.readFileSync(audioFilePath);

        // Skip WAV header (44 bytes) and send PCM data in 4KB chunks
        const pcmData = audioData.slice(44);
        const chunkSize = 4096;

        for (let i = 0; i < pcmData.length; i += chunkSize) {
          const chunk = pcmData.slice(i, i + chunkSize);
          socket.emit('audio:chunk', chunk);
        }

        // Signal end of audio
        socket.emit('audio:end');
      });

      socket.on('response', (data: any) => {
        clearTimeout(timeout);
        socket.disconnect();

        resolve({
          transport: 'ws',
          sessionId,
          transcript: data.transcript,
          confidence: data.confidence,
          responseText: data.responseText,
          voiceResponseText: data.voiceResponseText,
          audioUrl: data.audioUrl,
          safety: data.safety,
          latency: data.latency,
          messageId: data.messageId,
        });
      });

      socket.on('error', (data: any) => {
        clearTimeout(timeout);
        socket.disconnect();
        reject(
          new Error(
            `WS error: ${data.code} - ${data.message}`,
          ),
        );
      });

      socket.on('connect_error', (err: Error) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `WS connection failed: ${err.message}`,
          ),
        );
      });
    });
  }

  /**
   * Check if an audio URL is reachable (HEAD request).
   */
  async isAudioUrlReachable(url: string): Promise<boolean> {
    try {
      const response = await axios.head(url, { timeout: 5000 });
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  }
}
