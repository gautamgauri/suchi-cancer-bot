import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechClient } from '@google-cloud/speech';
import { SttResult } from '../voice/interfaces/speech-provider.interface';
import { PHRASE_BOOST_LIST, PHRASE_BOOST_VALUE } from '../voice/providers/phrase-sets';

/** How long end() waits for the recognizer to flush after stream.end(). */
export const STREAM_END_TIMEOUT_MS = 10000;

/**
 * Wraps Google Speech streamingRecognize() for real-time audio streaming.
 * Provides write(chunk), onInterim(cb), and end() methods.
 *
 * One SpeechClient (gRPC channel) is shared by every stream this service
 * opens; it is created lazily and closed when the module is destroyed.
 */
@Injectable()
export class VoiceStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceStreamService.name);
  private readonly model: string;
  private client: SpeechClient | null = null;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('STT_MODEL') || 'latest_long';
  }

  private getClient(): SpeechClient {
    if (!this.client) {
      this.client = new SpeechClient();
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.close();
      } catch (err: any) {
        this.logger.warn(`SpeechClient close failed: ${err?.message}`);
      }
    }
  }

  /**
   * Create a new streaming recognition session.
   */
  createStream(
    languageCode = 'hi-IN',
    onInterim?: (transcript: string) => void,
  ): StreamingSession {
    const alternateLanguages =
      languageCode === 'hi-IN' ? ['en-IN'] : ['hi-IN'];

    const recognizeStream = this.getClient().streamingRecognize({
      config: {
        encoding: 'LINEAR16' as any,
        sampleRateHertz: 16000,
        languageCode,
        alternativeLanguageCodes: alternateLanguages,
        model: this.model,
        enableAutomaticPunctuation: true,
        adaptation: {
          phraseSets: [
            {
              phrases: PHRASE_BOOST_LIST.map((phrase) => ({
                value: phrase,
                boost: PHRASE_BOOST_VALUE,
              })),
            },
          ],
        },
      },
      interimResults: true,
    });

    const session = new StreamingSession(recognizeStream, languageCode, onInterim);

    recognizeStream.on('error', (err: Error) => {
      this.logger.error(`Streaming STT error: ${err.message}`, err.stack);
      session.setError(err);
    });

    recognizeStream.on('data', (data: any) => session.handleData(data));
    recognizeStream.on('end', () => session.handleStreamClosed());
    recognizeStream.on('close', () => session.handleStreamClosed());

    return session;
  }
}

interface FinalSegment {
  transcript: string;
  confidence: number;
  languageCode: string;
}

/**
 * One streaming recognition turn.
 *
 * Google streaming STT emits one final result per utterance, so a turn in
 * which the speaker pauses produces several finals. Every final is kept, in
 * order, and end() returns them joined — the whole of what was said is what
 * reaches the chat (and safety) pipeline, not just the last sentence.
 */
export class StreamingSession {
  private readonly finals: FinalSegment[] = [];
  private error: Error | null = null;
  private closed = false;
  private settled = false;
  private endPromise: Promise<SttResult> | null = null;
  private resolveEnd: ((result: SttResult) => void) | null = null;
  private rejectEnd: ((err: Error) => void) | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly stream: any,
    private readonly defaultLanguageCode: string = 'hi-IN',
    private readonly onInterim?: (transcript: string) => void,
    private readonly endTimeoutMs: number = STREAM_END_TIMEOUT_MS,
  ) {}

  /** Write a PCM audio chunk to the stream. */
  write(chunk: Buffer): void {
    if (this.endPromise || this.closed) return;
    if (!this.stream.destroyed && !this.stream.writableEnded) {
      this.stream.write(chunk);
    }
  }

  /**
   * Half-close the stream and wait for the recognizer to flush every
   * remaining final. Resolves on the stream's end/close, or after a bounded
   * timeout with whatever was accumulated. Idempotent.
   */
  end(): Promise<SttResult> {
    if (this.endPromise) return this.endPromise;

    this.endPromise = new Promise<SttResult>((resolve, reject) => {
      this.resolveEnd = resolve;
      this.rejectEnd = reject;
    });

    if (this.error) {
      this.settle();
      return this.endPromise;
    }
    if (this.closed) {
      this.settle();
      return this.endPromise;
    }

    try {
      if (!this.stream.destroyed && !this.stream.writableEnded) {
        this.stream.end();
      }
    } catch (err: any) {
      this.error = err instanceof Error ? err : new Error(String(err));
      this.settle();
      return this.endPromise;
    }

    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      this.settle();
    }, this.endTimeoutMs);

    return this.endPromise;
  }

  /** The ordered transcript accumulated so far (finals only). */
  getResult(): SttResult {
    const parts = this.finals.map((f) => f.transcript.trim()).filter(Boolean);
    if (parts.length === 0) {
      return { transcript: '', confidence: 0, languageCode: this.defaultLanguageCode };
    }
    const scored = this.finals.filter((f) => f.transcript.trim());
    const confidence =
      scored.reduce((sum, f) => sum + f.confidence, 0) / scored.length;
    return {
      transcript: parts.join(' '),
      confidence,
      languageCode: scored[0].languageCode,
    };
  }

  /** @internal Called for every 'data' event from the recognizer. */
  handleData(data: any): void {
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    let interim = '';
    for (const result of results) {
      const alt = result?.alternatives?.[0];
      const transcript: string = alt?.transcript || '';
      if (result?.isFinal) {
        if (transcript.trim()) {
          this.finals.push({
            transcript,
            confidence: alt?.confidence ?? 0,
            languageCode: result.languageCode || this.defaultLanguageCode,
          });
        }
      } else {
        interim += transcript;
      }
    }
    if (interim && this.onInterim) {
      // Show the whole turn so far, not just the utterance in progress.
      const soFar = this.getResult().transcript;
      this.onInterim(soFar ? `${soFar} ${interim.trim()}` : interim);
    }
  }

  /** @internal Called when the recognizer stream ends or closes. */
  handleStreamClosed(): void {
    this.closed = true;
    if (this.endPromise) this.settle();
  }

  /** @internal Called when stream errors */
  setError(err: Error): void {
    if (!this.error) this.error = err;
    if (this.endPromise) this.settle();
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.clearEndTimer();
    // A late error after speech was captured must not lose what was said.
    if (this.error && this.finals.length === 0) {
      this.rejectEnd?.(this.error);
    } else {
      this.resolveEnd?.(this.getResult());
    }
  }

  private clearEndTimer(): void {
    if (this.endTimer) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
  }

  /** Destroy the stream (cleanup). Safe to call more than once. */
  destroy(): void {
    this.clearEndTimer();
    if (this.endPromise && !this.settled) {
      // Anyone still awaiting end() gets what was accumulated.
      this.closed = true;
      this.settle();
    }
    if (!this.stream.destroyed) {
      this.stream.destroy();
    }
  }
}
