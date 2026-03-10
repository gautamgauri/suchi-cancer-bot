import { Module } from "@nestjs/common";
import { SccfIngestController } from "./sccf-ingest.controller";
import { SccfIngestService } from "./sccf-ingest.service";
import { SccfDriveClientService } from "./drive-client.service";
import { SccfGmailAttachmentService } from "./gmail-attachment.service";
import { PrismaModule } from "../prisma/prisma.module";
import { CoreAiModule } from "../core_ai/core-ai.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";

@Module({
  imports: [PrismaModule, CoreAiModule, EvidenceIngestModule],
  controllers: [SccfIngestController],
  providers: [SccfIngestService, SccfDriveClientService, SccfGmailAttachmentService],
})
export class SccfIngestModule {}
