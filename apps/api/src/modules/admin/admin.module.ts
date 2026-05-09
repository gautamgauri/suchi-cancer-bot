import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { NavigatorApproveService } from "./navigator-approve.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { EmailModule } from "../email/email.module";

@Module({
  imports: [AnalyticsModule, EmailModule],
  controllers: [AdminController],
  providers: [AdminService, NavigatorApproveService],
})
export class AdminModule {}
