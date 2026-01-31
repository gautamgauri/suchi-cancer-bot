import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AnalyticsModule } from "../analytics/analytics.module";
import { EmailModule } from "../email/email.module";

@Module({
  imports: [AnalyticsModule, EmailModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
