import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  Body,
  BadRequestException,
  Logger,
  GatewayTimeoutException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { VoiceRequestDto, VoiceResponse } from "./dto";
import { VoiceService } from "./voice.service";

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
  private readonly REQUEST_TIMEOUT_MS = 45_000;

  constructor(private readonly voice: VoiceService) {}

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
}
