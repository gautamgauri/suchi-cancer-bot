import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Logger,
  GatewayTimeoutException,
  Inject,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { VoiceRequestDto, VoiceResponse, TtsRequestDto, TtsResponse } from "./dto";
import { VoiceService } from "./voice.service";
import { VoiceResponseCondenser } from "./services/voice-response-condenser.service";
import { GcsStorageService } from "./services/gcs-storage.service";
import { TTS_PROVIDER, TtsProvider } from "./interfaces/speech-provider.interface";

const ALLOWED_MIME_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
];

@Controller("voice")
export class VoiceController {
  private readonly logger = new Logger(VoiceController.name);
  private readonly REQUEST_TIMEOUT_MS = 120_000;
  private readonly TTS_TIMEOUT_MS = 30_000;

  constructor(
    private readonly voice: VoiceService,
    private readonly condenser: VoiceResponseCondenser,
    private readonly gcsStorage: GcsStorageService,
    @Inject(TTS_PROVIDER) private readonly tts: TtsProvider,
  ) {}

  @Post("respond")
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  async respond(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: VoiceRequestDto,
  ): Promise<VoiceResponse> {
    if (!file) {
      throw new BadRequestException("Audio file is required (field name: 'audio')");
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported audio format: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("VOICE_REQUEST_TIMEOUT")), this.REQUEST_TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        this.voice.handleVoiceRequest(file.buffer, file.mimetype, dto),
        timeoutPromise,
      ]);
    } catch (error: any) {
      this.logger.error(`Voice error: ${error.message}`, error.stack);

      if (error.message === "VOICE_REQUEST_TIMEOUT") {
        throw new GatewayTimeoutException("Voice request timed out. Please try again.");
      }

      throw error;
    }
  }

  /**
   * Text-to-Speech endpoint: accepts text, returns a signed URL to the MP3 audio.
   * Used by the web frontend "Listen" button for high-quality server-side TTS.
   */
  @Post("tts")
  @Throttle({ default: { limit: 20, ttl: 60 } })
  async textToSpeech(@Body() dto: TtsRequestDto): Promise<TtsResponse> {
    if (!dto.text || dto.text.trim().length === 0) {
      throw new BadRequestException("Text is required");
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("TTS_REQUEST_TIMEOUT")), this.TTS_TIMEOUT_MS);
    });

    try {
      const result = await Promise.race([
        this.synthesizeAndUpload(dto.text, dto.locale),
        timeoutPromise,
      ]);
      return result;
    } catch (error: any) {
      this.logger.error(`TTS error: ${error.message}`, error.stack);

      if (error.message === "TTS_REQUEST_TIMEOUT") {
        throw new GatewayTimeoutException("TTS request timed out. Please try again.");
      }

      throw error;
    }
  }

  private async synthesizeAndUpload(text: string, locale?: string): Promise<TtsResponse> {
    const resolvedLocale = locale || "en-IN";

    // Condense and convert to SSML
    const { ssml } = this.condenser.condense(text);

    // Synthesize with Google Chirp 3 HD
    const ttsResult = await this.tts.synthesize(ssml, undefined, resolvedLocale);

    // Upload to GCS and get signed URL
    const sessionKey = `web-tts-${Date.now()}`;
    const { signedUrl } = await this.gcsStorage.uploadAndSign(
      ttsResult.audioContent,
      sessionKey,
      ttsResult.audioEncoding === "MP3" ? "mp3" : "ogg",
    );

    return { audioUrl: signedUrl };
  }
}
