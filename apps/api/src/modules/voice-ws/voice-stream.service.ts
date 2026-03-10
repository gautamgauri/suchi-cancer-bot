import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechClient } from '@google-cloud/speech';
import { SttResult } from '../voice/interfaces/speech-provider.interface';
import { PHRASE_BOOST_LIST, PHRASE_BOOST_VALUE } from '../voice/providers/phrase-sets';

/**
 * Wraps Google Speech V2 streamingRecognize() for real-time audio streaming.
 * Provides write(chunk), onInterim(cb), and end() methods.
 */
@Injectable()
export class VoiceStreamService {
  private readonly logger = new Logger(VoiceStreamService.name);
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.model = this.config.get<string>('STT_MODEL') || 'latest_long';
  }

  /**
   * Create a new streaming recognition session.
   */
  createStream(
    languageCode = 'hi-IN',
    onInterim?: (transcript: string) => void,
  ): StreamingSession {
    const client = new SpeechClient();
    const alternateLanguages =
      languageCode === 'hi-IN' ? ['en-IN'] : ['hi-IN'];

    const recognizeStream = client.streamingRecognize({
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

    const session = new StreamingSession(recognizeStream, onInterim);

    recognizeStream.on('error', (err) => {
      this.logger.error(`Streaming STT error: ${err.message}`, err.stack);
      session.setError(err);
    });

    recognizeStream.on('data', (data: any) => {
      const result = data.results?.[0];
      if (!result) return;

      const transcript = result.alternatives?.[0]?.transcript || '';
      const confidence = result.alternatives?.[0]?.confidence ?? 0;
      const isFinal = result.isFinal;
      const detectedLang = result.languageCode || languageCode;

      if (isFinal) {
        session.setFinalResult({ transcript, confidence, languageCode: detectedLang });
      } else if (onInterim) {
        onInterim(transcript);
      }
    });

    return session;
  }
}

export class StreamingSession {
  private finalResult: SttResult | null = null;
  private error: Error | null = null;
  private resolvePromise: ((result: SttResult) => void) | null = null;
  private rejectPromise: ((err: Error) => void) | null = null;

  constructor(
    private readonly stream: any,
    private readonly onInterim?: (transcript: string) => void,
  ) {}

  /** Write a PCM audio chunk to the stream. */
  write(chunk: Buffer): void {
    if (!this.stream.destroyed) {
      this.stream.write(chunk);
    }
  }

  /** End the stream and wait for the final result. */
  async end(): Promise<SttResult> {
    return new Promise<SttResult>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;

      // If we already have a result or error, resolve immediately
      if (this.finalResult) {
        resolve(this.finalResult);
        return;
      }
      if (this.error) {
        reject(this.error);
        return;
      }

      this.stream.end();

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.finalResult && !this.error) {
          resolve({ transcript: '', confidence: 0, languageCode: 'hi-IN' });
        }
      }, 10000);
    });
  }

  /** @internal Called when final result arrives from stream */
  setFinalResult(result: SttResult): void {
    this.finalResult = result;
    if (this.resolvePromise) {
      this.resolvePromise(result);
    }
  }

  /** @internal Called when stream errors */
  setError(err: Error): void {
    this.error = err;
    if (this.rejectPromise) {
      this.rejectPromise(err);
    }
  }

  /** Destroy the stream (cleanup). */
  destroy(): void {
    if (!this.stream.destroyed) {
      this.stream.destroy();
    }
  }
}
