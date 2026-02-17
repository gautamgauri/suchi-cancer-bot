import { Module } from "@nestjs/common";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";
import { AudioConverterService } from "./services/audio-converter.service";
import { VoiceResponseCondenser } from "./services/voice-response-condenser.service";
import { GcsStorageService } from "./services/gcs-storage.service";
import { GoogleSttProvider } from "./providers/google-stt.provider";
import { GoogleTtsProvider } from "./providers/google-tts.provider";
import { STT_PROVIDER, TTS_PROVIDER } from "./interfaces/speech-provider.interface";
import { ChatModule } from "../chat/chat.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [ChatModule, AnalyticsModule, PrismaModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    AudioConverterService,
    VoiceResponseCondenser,
    GcsStorageService,
    { provide: STT_PROVIDER, useClass: GoogleSttProvider },
    { provide: TTS_PROVIDER, useClass: GoogleTtsProvider },
  ],
})
export class VoiceModule {}
