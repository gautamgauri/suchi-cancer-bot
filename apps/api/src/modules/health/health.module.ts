import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { RagModule } from "../rag/rag.module";

@Module({
  // RagModule is imported for KbFtsHealthService: retrieval readiness (issue #92)
  // is reported by the module that owns the query, not re-derived here.
  imports: [RagModule],
  controllers: [HealthController],
  providers: [HealthService]
})
export class HealthModule {}





















