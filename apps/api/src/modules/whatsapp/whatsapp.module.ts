import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ChatModule } from "../chat/chat.module";
import { SessionsModule } from "../sessions/sessions.module";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";

// §16 — full conversational WhatsApp channel over the Meta Cloud API.
// All inbound traffic is routed through ChatService.handle({channel:"whatsapp"}),
// reusing the same safety/RAG/citation pipeline as web and voice.
@Module({
  imports: [PrismaModule, ChatModule, SessionsModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
