import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { AudioConverterService } from './services/audio-converter.service';
import { VoiceResponseCondenser } from './services/voice-response-condenser.service';
import { GcsStorageService } from './services/gcs-storage.service';
import { GoogleSttProvider } from './providers/google-stt.provider';
import { GoogleSttV2Provider } from './providers/google-stt-v2.provider';
import { GoogleTtsProvider } from './providers/google-tts.provider';
import { STT_PROVIDER, TTS_PROVIDER } from './interfaces/speech-provider.interface';
import { ChatModule } from '../chat/chat.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PrismaModule } from '../prisma/prisma.module';

const sttProvider = {
  provide: STT_PROVIDER,
  useClass:
    process.env.STT_VERSION === 'v1' ? GoogleSttProvider : GoogleSttV2Provider,
};

@Module({
  imports: [ChatModule, AnalyticsModule, PrismaModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    AudioConverterService,
    VoiceResponseCondenser,
    GcsStorageService,
    sttProvider,
    { provide: TTS_PROVIDER, useClass: GoogleTtsProvider },
  ],
  exports: [VoiceService, AudioConverterService, VoiceResponseCondenser, GcsStorageService, sttProvider, TTS_PROVIDER],
})
export class VoiceModule {}
