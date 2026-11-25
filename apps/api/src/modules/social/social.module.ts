import { Module } from "@nestjs/common";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";
import { EmailModule } from "../email/email.module";
import { LlmModule } from "../llm/llm.module";

@Module({
  imports: [EmailModule, LlmModule],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
