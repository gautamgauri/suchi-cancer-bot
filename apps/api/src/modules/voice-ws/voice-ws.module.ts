import { Module } from '@nestjs/common';
import { VoiceWsGateway } from './voice-ws.gateway';
import { VoiceStreamService } from './voice-stream.service';
import { VoiceModule } from '../voice/voice.module';
import { ChatModule } from '../chat/chat.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [VoiceModule, ChatModule, PrismaModule],
  providers: [VoiceWsGateway, VoiceStreamService],
})
export class VoiceWsModule {}
