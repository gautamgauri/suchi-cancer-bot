import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TtsProvider, TtsResult } from "../interfaces/speech-provider.interface";

/**
 * Sarvam AI TTS provider using the Bulbul model.
 * API docs: https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
 *
 * Pricing (as of Mar 2026):
 *   - Bulbul v2: Rs 15 / 10K chars
 *   - Bulbul v3: Rs 30 / 10K chars
 *   - Free tier: Rs 1,000 credits on signup
 *   - Startup program: 6-12 months of credits (apply at sarvam.ai/startup-program)
 */
@Injectable()
export class SarvamTtsProvider implements TtsProvider {
  private readonly logger = new Logger(SarvamTtsProvider.name);
  private readonly apiKey: string;
  private readonly speaker: string;
  private readonly model: string;

  private static readonly API_URL = "https://api.sarvam.ai/text-to-speech";

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>("SARVAM_API_KEY") || "";
    this.speaker = this.config.get<string>("SARVAM_TTS_SPEAKER") || "meera";
    this.model = this.config.get<string>("SARVAM_TTS_MODEL") || "bulbul:v2";

    if (!this.apiKey) {
      this.logger.warn(
        "SARVAM_API_KEY not set — Sarvam TTS calls will fail. " +
        "Get a key at https://dashboard.sarvam.ai"
      );
    }
  }

  async synthesize(ssml: string, voiceName?: string, locale?: string): Promise<TtsResult> {
    const started = Date.now();

    // Strip SSML tags — Sarvam API accepts plain text, not SSML
    const plainText = this.stripSsml(ssml);

    // Map locale to Sarvam BCP-47 language code
    const targetLanguageCode = this.resolveLanguageCode(locale);
    const speaker = voiceName || this.speaker;

    const body = {
      inputs: [plainText],
      target_language_code: targetLanguageCode,
      speaker,
      model: this.model,
      audio_format: "mp3",
      speech_sample_rate: 22050,
    };

    const response = await fetch(SarvamTtsProvider.API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-Subscription-Key": this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Sarvam TTS failed (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();

    // Response contains { audios: ["<base64-encoded-audio>"] }
    const base64Audio: string = data.audios?.[0];
    if (!base64Audio) {
      throw new Error("Sarvam TTS returned empty audio");
    }

    const audioContent = Buffer.from(base64Audio, "base64");
    const latencyMs = Date.now() - started;
    this.logger.log(
      `Sarvam TTS completed in ${latencyMs}ms | speaker=${speaker} | lang=${targetLanguageCode} | model=${this.model} | chars=${plainText.length}`
    );

    return {
      audioContent,
      audioEncoding: "MP3",
    };
  }

  /**
   * Strip SSML tags to get plain text.
   * Sarvam's API does not support SSML — it expects raw text.
   */
  private stripSsml(ssml: string): string {
    return ssml
      .replace(/<[^>]+>/g, "") // Remove all XML/SSML tags
      .replace(/\s+/g, " ")    // Collapse whitespace
      .trim();
  }

  /**
   * Map locale string to Sarvam BCP-47 language code.
   * Defaults to hi-IN for Hindi (the primary Suchi user base).
   */
  private resolveLanguageCode(locale?: string): string {
    if (!locale) return "hi-IN";
    if (locale.startsWith("en")) return "en-IN";
    if (locale.startsWith("hi")) return "hi-IN";
    if (locale.startsWith("bn")) return "bn-IN";
    if (locale.startsWith("ta")) return "ta-IN";
    if (locale.startsWith("te")) return "te-IN";
    if (locale.startsWith("mr")) return "mr-IN";
    if (locale.startsWith("gu")) return "gu-IN";
    if (locale.startsWith("kn")) return "kn-IN";
    if (locale.startsWith("ml")) return "ml-IN";
    if (locale.startsWith("pa")) return "pa-IN";
    if (locale.startsWith("od") || locale.startsWith("or")) return "od-IN";
    return "hi-IN";
  }
}
