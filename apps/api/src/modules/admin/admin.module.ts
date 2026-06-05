import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { NavigatorApproveService } from "./navigator-approve.service";
import { NavigatorResearchService } from "./navigator-research.service";
import { ContentApproveService } from "./content-approve.service";
import { ContentResearchService } from "./content-research.service";
import { SocialPostService } from "./social-post.service";
import { DraftExpiryService } from "./draft-expiry.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { EmailModule } from "../email/email.module";
import { LlmModule } from "../llm/llm.module";
import { RagModule } from "../rag/rag.module";

@Module({
  imports: [AnalyticsModule, EmailModule, LlmModule, RagModule],
  controllers: [AdminController],
  providers: [AdminService, NavigatorApproveService, NavigatorResearchService, ContentApproveService, ContentResearchService, SocialPostService, DraftExpiryService],
})
export class AdminModule {}
