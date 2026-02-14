import { Module } from "@nestjs/common";
import { PipelineModule } from "../pipeline/pipeline.module";
import { AuditController } from "./audit.controller";
import { ExportController } from "./export.controller";

@Module({
  imports: [PipelineModule],
  controllers: [ExportController, AuditController],
})
export class AdminModule {}
