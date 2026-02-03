import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { envSchema } from "./config/env.validation";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { HealthModule } from "./modules/health/health.module";
import { CoreAiModule } from "./modules/core_ai/core-ai.module";
import { DraftModule } from "./modules/draft/draft.module";
import { PipelineModule } from "./modules/pipeline/pipeline.module";
import { SheetsModule } from "./modules/sheets/sheets.module";
import { DonorModule } from "./modules/donor/donor.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ApprovalsModule } from "./modules/approvals/approvals.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { SourceRegistryModule } from "./modules/source_registry/source-registry.module";
import { EvidenceIngestModule } from "./modules/evidence_ingest/evidence-ingest.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: (c) => envSchema.parse(c) }),
    PrismaModule,
    SheetsModule,
    HealthModule,
    CoreAiModule,
    SourceRegistryModule,
    EvidenceIngestModule,
    DraftModule,
    PipelineModule,
    ApprovalsModule,
    ReportsModule,
    DonorModule,
    AdminModule,
  ],
})
export class AppModule {}
