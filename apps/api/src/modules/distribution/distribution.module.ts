import { Module } from "@nestjs/common";
import { DistributionController } from "./distribution.controller";

/** Only the retired-link page remains. See distribution.controller.ts. */
@Module({
  controllers: [DistributionController],
})
export class DistributionModule {}
