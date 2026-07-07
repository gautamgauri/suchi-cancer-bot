import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SpeechClient } from "@google-cloud/speech";
import { SttProvider, SttResult } from "../interfaces/speech-provider.interface";

@Injectable()
export class GoogleSttProvider implements SttProvider {
  private readonly logger = new Logger(GoogleSttProvider.name);
  private readonly client: SpeechClient;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.client = new SpeechClient();
    this.model = this.config.get<string>("STT_MODEL") || "latest_short";
  }

  async transcribe(audioBuffer: Buffer, languageCode = "hi-IN"): Promise<SttResult> {
    const started = Date.now();

    const [response] = await this.client.recognize({
      config: {
        encoding: "LINEAR16" as any,
        sampleRateHertz: 16000,
        languageCode,
        model: this.model,
        enableAutomaticPunctuation: true,
      },
      audio: {
        content: audioBuffer.toString("base64"),
      },
    });

    const latencyMs = Date.now() - started;
    const topResult = response.results?.[0]?.alternatives?.[0];

    const transcript = topResult?.transcript || "";
    const confidence = topResult?.confidence ?? 0;

    this.logger.log(`STT completed in ${latencyMs}ms | confidence=${confidence.toFixed(2)} | lang=${languageCode}`);

    return { transcript, confidence, languageCode };
  }
}
