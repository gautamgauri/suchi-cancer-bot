import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechClient } from '@google-cloud/speech';
import { SttProvider, SttResult } from '../interfaces/speech-provider.interface';
import { PHRASE_BOOST_LIST, PHRASE_BOOST_VALUE } from './phrase-sets';

@Injectable()
export class GoogleSttV2Provider implements SttProvider {
  private readonly logger = new Logger(GoogleSttV2Provider.name);
  private readonly client: SpeechClient;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new SpeechClient();
    this.model = this.config.get<string>('STT_MODEL') || 'latest_long';
  }

  async transcribe(audioBuffer: Buffer, languageCode = 'hi-IN'): Promise<SttResult> {
    const started = Date.now();

    const alternateLanguages = languageCode === 'hi-IN' ? ['en-IN'] : ['hi-IN'];

    const [response] = await this.client.recognize({
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
      audio: {
        content: audioBuffer.toString('base64'),
      },
    });

    const latencyMs = Date.now() - started;
    const topResult = response.results?.[0]?.alternatives?.[0];

    const transcript = topResult?.transcript || '';
    const confidence = topResult?.confidence ?? 0;
    const detectedLang =
      (response.results?.[0] as any)?.languageCode || languageCode;

    this.logger.log(
      `STT-V2 completed in ${latencyMs}ms | confidence=${confidence.toFixed(2)} | lang=${detectedLang} | model=${this.model}`,
    );

    return { transcript, confidence, languageCode: detectedLang };
  }
}
