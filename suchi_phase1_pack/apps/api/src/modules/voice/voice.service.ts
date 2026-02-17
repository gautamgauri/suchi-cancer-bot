import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { ChatService } from "../chat/chat.service";
import { AudioConverterService } from "./services/audio-converter.service";
import { VoiceResponseCondenser } from "./services/voice-response-condenser.service";
import { GcsStorageService } from "./services/gcs-storage.service";
import {
  STT_PROVIDER,
  TTS_PROVIDER,
  SttProvider,
  TtsProvider,
} from "./interfaces/speech-provider.interface";
import { VoiceRequestDto, VoiceResponse } from "./dto";

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  private readonly confidenceThreshold: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly chatService: ChatService,
    private readonly audioConverter: AudioConverterService,
    private readonly condenser: VoiceResponseCondenser,
    private readonly gcsStorage: GcsStorageService,
    @Inject(STT_PROVIDER) private readonly stt: SttProvider,
    @Inject(TTS_PROVIDER) private readonly tts: TtsProvider,
  ) {
    this.confidenceThreshold = this.config.get<number>("STT_CONFIDENCE_THRESHOLD") || 0.6;
  }

  async handleVoiceRequest(
    audioBuffer: Buffer,
    mimeType: string,
    dto: VoiceRequestDto,
  ): Promise<VoiceResponse> {
    const totalStarted = Date.now();

    // 1. Convert audio to LINEAR16
    const { wavBuffer, durationMs: audioDurationMs } = await this.audioConverter.convertToLinear16(
      audioBuffer,
      mimeType,
    );

    // 2. STT
    const sttStarted = Date.now();
    const sttResult = await this.stt.transcribe(wavBuffer, dto.locale || "hi-IN");
    const sttMs = Date.now() - sttStarted;

    this.logger.log({
      event: "voice_stt_complete",
      sessionId: dto.sessionId,
      confidence: sttResult.confidence,
      sttMs,
    });

    // 3. Low confidence → ask user to retry
    if (sttResult.confidence < this.confidenceThreshold) {
      const retryText = "माफ़ कीजिए, मैं आपकी बात स्पष्ट रूप से नहीं समझ पाई। कृपया दोबारा बोलें।";

      this.persistVoiceInteraction(dto.sessionId, {
        sttProvider: "google",
        sttConfidence: sttResult.confidence,
        transcript: sttResult.transcript,
        audioDurationMs,
        audioSizeBytes: audioBuffer.length,
        inputFormat: mimeType.split("/")[1],
        sttLatencyMs: sttMs,
        totalLatencyMs: Date.now() - totalStarted,
        error: "low_stt_confidence",
      });

      return {
        sessionId: dto.sessionId,
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        responseText: retryText,
        voiceResponseText: retryText,
        audioUrl: null,
        safety: { classification: "normal", actions: [] },
        latency: { sttMs, chatMs: 0, ttsMs: 0, totalMs: Date.now() - totalStarted },
      };
    }

    // 4. Chat pipeline
    const chatStarted = Date.now();
    const chatResponse = await this.chatService.handle({
      sessionId: dto.sessionId,
      channel: "voice",
      locale: dto.locale || "hi",
      userText: sttResult.transcript,
    });
    const chatMs = Date.now() - chatStarted;

    // 5. Condense for voice
    const { plainText: voiceText, ssml } = this.condenser.condense(chatResponse.responseText);

    // 6. TTS
    const ttsStarted = Date.now();
    let audioUrl: string | null = null;
    let ttsMs = 0;

    try {
      const ttsResult = await this.tts.synthesize(ssml);
      ttsMs = Date.now() - ttsStarted;

      // 7. Upload to GCS
      const { signedUrl } = await this.gcsStorage.uploadAndSign(
        ttsResult.audioContent,
        dto.sessionId,
        ttsResult.audioEncoding === "MP3" ? "mp3" : "ogg",
      );
      audioUrl = signedUrl;
    } catch (ttsError: any) {
      ttsMs = Date.now() - ttsStarted;
      this.logger.error(`TTS/GCS failed: ${ttsError.message}`, ttsError.stack);
    }

    const totalMs = Date.now() - totalStarted;

    // 8. Persist metadata (fire-and-forget)
    this.persistVoiceInteraction(dto.sessionId, {
      messageId: chatResponse.messageId,
      sttProvider: "google",
      sttConfidence: sttResult.confidence,
      transcript: sttResult.transcript,
      audioDurationMs,
      audioSizeBytes: audioBuffer.length,
      inputFormat: mimeType.split("/")[1],
      ttsProvider: "google",
      ttsAudioUrl: audioUrl,
      ttsVoiceName: this.config.get<string>("TTS_VOICE_NAME") || "hi-IN-Neural2-A",
      sttLatencyMs: sttMs,
      ttsLatencyMs: ttsMs,
      totalLatencyMs: totalMs,
    });

    // Analytics (non-blocking)
    this.analytics
      .emit("voice_turn_completed", { sttMs, chatMs, ttsMs, totalMs, confidence: sttResult.confidence, audioDurationMs }, dto.sessionId)
      .catch((err) => this.logger.warn(`Analytics emit failed: ${err.message}`));

    return {
      sessionId: dto.sessionId,
      messageId: chatResponse.messageId,
      transcript: sttResult.transcript,
      confidence: sttResult.confidence,
      responseText: chatResponse.responseText,
      voiceResponseText: voiceText,
      audioUrl,
      safety: chatResponse.safety ?? { classification: "normal", actions: [] },
      latency: { sttMs, chatMs, ttsMs, totalMs },
    };
  }

  private persistVoiceInteraction(sessionId: string, data: Record<string, any>) {
    this.prisma.voiceInteraction
      .create({ data: { session: { connect: { id: sessionId } }, ...data } as any })
      .catch((err) => this.logger.warn(`Failed to persist voice interaction: ${err.message}`));
  }
}
