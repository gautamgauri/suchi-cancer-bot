import { Module } from "@nestjs/common";
import { DistributionController } from "./distribution.controller";
import { DistributionApproveService } from "./distribution-approve.service";

@Module({
  controllers: [DistributionController],
  providers: [DistributionApproveService],
})
export class DistributionModule {}
