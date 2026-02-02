import { Module } from "@nestjs/common";
import { DonorController } from "./donor.controller";
import { DonorService } from "./donor.service";
import { CoreAiModule } from "../core_ai/core-ai.module";

@Module({
  imports: [CoreAiModule],
  controllers: [DonorController],
  providers: [DonorService],
  exports: [DonorService],
})
export class DonorModule {}
