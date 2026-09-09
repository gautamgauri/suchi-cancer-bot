import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { TtsProvider, TtsResult } from "../interfaces/speech-provider.interface";

@Injectable()
export class GoogleTtsProvider implements TtsProvider {
  private readonly logger = new Logger(GoogleTtsProvider.name);
  private readonly client: TextToSpeechClient;
  private readonly defaultVoice: string;
  private readonly speakingRate: number;

  constructor(private readonly config: ConfigService) {
    this.client = new TextToSpeechClient();
    this.defaultVoice = this.config.get<string>("TTS_VOICE_NAME") || "hi-IN-Chirp3-HD-Aoede";
    this.speakingRate = this.config.get<number>("TTS_SPEAKING_RATE") || 0.95;
  }

  async synthesize(ssml: string, voiceName?: string, locale?: string): Promise<TtsResult> {
    const started = Date.now();
    const voice = voiceName || (locale?.startsWith("en") ? "en-IN-Chirp3-HD-Zephyr" : this.defaultVoice);
    const languageCode = voice.slice(0, 5); // Extract "hi-IN" or "en-IN" from voice name

    const [response] = await this.client.synthesizeSpeech({
      input: { ssml },
      voice: {
        languageCode,
        name: voice,
      },
      audioConfig: {
        audioEncoding: "MP3" as any,
        speakingRate: this.speakingRate,
        pitch: 0,
        effectsProfileId: ["headphone-class-device"],
      },
    });

    const latencyMs = Date.now() - started;
    this.logger.log(`TTS completed in ${latencyMs}ms | voice=${voice}`);

    return {
      audioContent: Buffer.from(response.audioContent as Uint8Array),
      audioEncoding: "MP3",
    };
  }
}
