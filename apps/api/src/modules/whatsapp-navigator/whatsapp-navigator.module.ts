import { Module } from "@nestjs/common";
import { WhatsAppNavigatorController } from "./whatsapp-navigator.controller";
import { WhatsAppNavigatorFlowService } from "./whatsapp-navigator-flow.service";

@Module({
  controllers: [WhatsAppNavigatorController],
  providers: [WhatsAppNavigatorFlowService],
  exports: [WhatsAppNavigatorFlowService],
})
export class WhatsAppNavigatorModule {}
