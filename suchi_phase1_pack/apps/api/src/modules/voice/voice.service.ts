import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { ChatService } from '../chat/chat.service';
import { AudioConverterService } from './services/audio-converter.service';
import { VoiceResponseCondenser } from './services/voice-response-condenser.service';
import { GcsStorageService } from './services/gcs-storage.service';
import {
  STT_PROVIDER,
  TTS_PROVIDER,
  SttProvider,
  TtsProvider,
} from './interfaces/speech-provider.interface';
import { VoiceRequestDto, VoiceResponse } from './dto';
import { detectLocation } from '../chat/utils/location-detector';

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
    this.confidenceThreshold =
      this.config.get<number>('STT_CONFIDENCE_THRESHOLD') || 0.6;
  }

  async handleVoiceRequest(
    audioBuffer: Buffer,
    mimeType: string,
    dto: VoiceRequestDto,
  ): Promise<VoiceResponse> {
    const totalStarted = Date.now();

    // 1. Convert audio to LINEAR16
    const { wavBuffer, durationMs: audioDurationMs } =
      await this.audioConverter.convertToLinear16(audioBuffer, mimeType);

    // 2. STT
    const sttStarted = Date.now();
    const locale = dto.locale || 'hi-IN';
    const sttResult = await this.stt.transcribe(wavBuffer, locale);
    const sttMs = Date.now() - sttStarted;

    this.logger.log({
      event: 'voice_stt_complete',
      sessionId: dto.sessionId,
      confidence: sttResult.confidence,
      sttMs,
    });

    // 3. Low confidence → ask user to retry
    if (sttResult.confidence < this.confidenceThreshold) {
      const retryText = locale.startsWith('en')
        ? "Sorry, I couldn't understand you clearly. Please try again."
        : 'माफ़ कीजिए, मैं आपकी बात स्पष्ट रूप से नहीं समझ पाई। कृपया दोबारा बोलें।';

      this.persistVoiceInteraction(dto.sessionId, {
        sttProvider: 'google',
        sttConfidence: sttResult.confidence,
        transcript: sttResult.transcript,
        audioDurationMs,
        audioSizeBytes: audioBuffer.length,
        inputFormat: mimeType.split('/')[1],
        sttLatencyMs: sttMs,
        totalLatencyMs: Date.now() - totalStarted,
        error: 'low_stt_confidence',
      });

      return {
        sessionId: dto.sessionId,
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        responseText: retryText,
        voiceResponseText: retryText,
        audioUrl: null,
        safety: { classification: 'normal', actions: [] },
        latency: {
          sttMs,
          chatMs: 0,
          ttsMs: 0,
          totalMs: Date.now() - totalStarted,
        },
      };
    }

    // 3b. Location detection (fire-and-forget, non-blocking)
    this.tryDetectAndUpdateLocation(dto.sessionId, sttResult.transcript);

    // 4-7. Run shared pipeline (Chat → TTS → GCS)
    const pipelineResult = await this.runPipeline(
      dto.sessionId,
      sttResult.transcript,
      locale,
    );

    const totalMs = Date.now() - totalStarted;

    // 8. Persist metadata (fire-and-forget)
    this.persistVoiceInteraction(dto.sessionId, {
      messageId: pipelineResult.messageId,
      sttProvider: 'google',
      sttConfidence: sttResult.confidence,
      transcript: sttResult.transcript,
      audioDurationMs,
      audioSizeBytes: audioBuffer.length,
      inputFormat: mimeType.split('/')[1],
      ttsProvider: 'google',
      ttsAudioUrl: pipelineResult.audioUrl,
      ttsVoiceName: locale.startsWith('en')
        ? 'en-IN-Neural2-A'
        : this.config.get<string>('TTS_VOICE_NAME') || 'hi-IN-Neural2-A',
      sttLatencyMs: sttMs,
      ttsLatencyMs: pipelineResult.ttsMs,
      totalLatencyMs: totalMs,
    });

    // Analytics (non-blocking)
    this.analytics
      .emit(
        'voice_turn_completed',
        {
          sttMs,
          chatMs: pipelineResult.chatMs,
          ttsMs: pipelineResult.ttsMs,
          totalMs,
          confidence: sttResult.confidence,
          audioDurationMs,
        },
        dto.sessionId,
      )
      .catch((err) =>
        this.logger.warn(`Analytics emit failed: ${err.message}`),
      );

    return {
      sessionId: dto.sessionId,
      messageId: pipelineResult.messageId,
      transcript: sttResult.transcript,
      confidence: sttResult.confidence,
      responseText: pipelineResult.responseText,
      voiceResponseText: pipelineResult.voiceText,
      audioUrl: pipelineResult.audioUrl,
      safety: pipelineResult.safety,
      latency: {
        sttMs,
        chatMs: pipelineResult.chatMs,
        ttsMs: pipelineResult.ttsMs,
        totalMs,
      },
    };
  }

  /**
   * Entry point for WebSocket path — receives pre-transcribed text, runs Chat → TTS → GCS.
   */
  async handleVoiceRequestFromTranscript(
    sessionId: string,
    transcript: string,
    locale: string,
  ): Promise<{
    messageId?: string;
    responseText: string;
    voiceText: string;
    audioUrl: string | null;
    safety: any;
    chatMs: number;
    ttsMs: number;
  }> {
    // Location detection (fire-and-forget)
    this.tryDetectAndUpdateLocation(sessionId, transcript);

    return this.runPipeline(sessionId, transcript, locale);
  }

  /**
   * Shared pipeline: Chat → Condense → TTS → GCS
   */
  private async runPipeline(
    sessionId: string,
    transcript: string,
    locale: string,
  ) {
    // Chat pipeline
    const chatStarted = Date.now();
    const chatResponse = await this.chatService.handle({
      sessionId,
      channel: 'voice',
      locale: locale.startsWith('en') ? 'en' : 'hi',
      userText: transcript,
    });
    const chatMs = Date.now() - chatStarted;

    // Condense for voice
    const { plainText: voiceText, ssml } = this.condenser.condense(
      chatResponse.responseText,
    );

    // TTS
    const ttsStarted = Date.now();
    let audioUrl: string | null = null;
    let ttsMs = 0;

    try {
      const ttsResult = await this.tts.synthesize(ssml, undefined, locale);
      ttsMs = Date.now() - ttsStarted;

      // Upload to GCS
      const { signedUrl } = await this.gcsStorage.uploadAndSign(
        ttsResult.audioContent,
        sessionId,
        ttsResult.audioEncoding === 'MP3' ? 'mp3' : 'ogg',
      );
      audioUrl = signedUrl;
    } catch (ttsError: any) {
      ttsMs = Date.now() - ttsStarted;
      this.logger.error(
        `TTS/GCS failed: ${ttsError.message}`,
        ttsError.stack,
      );
    }

    // Strip citation markers from responseText (same cleanup as chat controller)
    const cleanResponseText = chatResponse.responseText
      .replace(/\n\n\*\*Sources:\*\*\s*(\[citation:[^\]]+\]\s*)+/g, '')
      .replace(/\[citation:[^\]]+\]/g, '')
      .replace(/\s*\[\d{1,3}\]/g, '')
      .replace(/  +/g, ' ')
      .replace(/\*\*\s*\*\*/g, '')
      .trim();

    return {
      messageId: chatResponse.messageId,
      responseText: cleanResponseText,
      voiceText,
      audioUrl,
      safety: chatResponse.safety ?? { classification: 'normal', actions: [] },
      chatMs,
      ttsMs,
    };
  }

  /**
   * Fire-and-forget location detection and session update.
   */
  private tryDetectAndUpdateLocation(
    sessionId: string,
    transcript: string,
  ): void {
    try {
      const location = detectLocation(transcript);
      if (location) {
        this.logger.log({
          event: 'voice_location_detected',
          sessionId,
          city: location.city,
          state: location.state,
          confidence: location.confidence,
        });

        // Update session with detected location (fire-and-forget)
        this.prisma.session
          .update({
            where: { id: sessionId },
            data: {
              city: location.city,
              region: location.state,
            },
          })
          .catch((err) =>
            this.logger.warn(
              `Failed to update session location: ${err.message}`,
            ),
          );
      }
    } catch (err: any) {
      this.logger.warn(`Location detection failed: ${err.message}`);
    }
  }

  private persistVoiceInteraction(
    sessionId: string,
    data: Record<string, any>,
  ) {
    this.prisma.voiceInteraction
      .create({
        data: { session: { connect: { id: sessionId } }, ...data } as any,
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to persist voice interaction: ${err.message}`,
        ),
      );
  }
}
