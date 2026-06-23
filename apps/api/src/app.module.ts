import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { envSchema } from "./config/env.validation";

import { PrismaModule } from "./modules/prisma/prisma.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { SafetyModule } from "./modules/safety/safety.module";
import { RagModule } from "./modules/rag/rag.module";
import { LlmModule } from "./modules/llm/llm.module";
import { SessionsModule } from "./modules/sessions/sessions.module";
import { ChatModule } from "./modules/chat/chat.module";
import { FeedbackModule } from "./modules/feedback/feedback.module";
import { AdminModule } from "./modules/admin/admin.module";
import { HealthModule } from "./modules/health/health.module";
import { EmbeddingsModule } from "./modules/embeddings/embeddings.module";
import { YoutubeModule } from "./modules/youtube/youtube.module";
import { VoiceModule } from "./modules/voice/voice.module";
import { VoiceWsModule } from "./modules/voice-ws/voice-ws.module";
import { ReviewModule } from "./modules/review/review.module";
import { CopilotModule } from "./modules/copilot/copilot.module";
import { ObservabilityModule } from "./modules/observability/observability.module";
import { WhatsAppNavigatorModule } from "./modules/whatsapp-navigator/whatsapp-navigator.module";
import { WhatsAppModule } from "./modules/whatsapp/whatsapp.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (c) => envSchema.parse(c) }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        throttlers: [{
          ttl: (cfg.get<number>("RATE_LIMIT_TTL_SEC") ?? 60) * 1000,
          limit: cfg.get<number>("RATE_LIMIT_REQ_PER_TTL") ?? 20
        }]
      })
    }),
    ObservabilityModule,
    PrismaModule,
    AnalyticsModule,
    SafetyModule,
    RagModule,
    LlmModule,
    SessionsModule,
    ChatModule,
    FeedbackModule,
    AdminModule,
    HealthModule,
    EmbeddingsModule,
    YoutubeModule,
    VoiceModule,
    ReviewModule,
    CopilotModule,
    WhatsAppNavigatorModule,
    WhatsAppModule,
    ...(process.env.VOICE_WS_ENABLED === 'true' ? [VoiceWsModule] : []),
  ]
})
export class AppModule {}
