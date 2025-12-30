import { Module } from "@nestjs/common";
import { AbstentionService } from "./abstention.service";

@Module({
  providers: [AbstentionService],
  exports: [AbstentionService]
})
export class AbstentionModule {}





