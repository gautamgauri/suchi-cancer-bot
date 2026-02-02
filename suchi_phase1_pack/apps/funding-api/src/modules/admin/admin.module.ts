import { Module } from "@nestjs/common";
import { PipelineModule } from "../pipeline/pipeline.module";
import { ExportController } from "./export.controller";

@Module({
  imports: [PipelineModule],
  controllers: [ExportController],
})
export class AdminModule {}
