import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ChunkingService } from "./chunking.service";
import { DriveClientService } from "./drive-client.service";
import { DownloadService } from "./download.service";
import { EmbeddingService } from "./embedding.service";
import { EvidenceIngestController } from "./evidence-ingest.controller";
import { EvidenceReportsService } from "./evidence-reports.service";
import { ExtractService } from "./extract.service";
import { InventoryService } from "./inventory.service";
import { PipelineService } from "./pipeline.service";
import { RetrievalService } from "./retrieval.service";
import { QueryExpanderService } from "./query-expander.service";
import { ReviewQueueService } from "./review-queue.service";

@Module({
  imports: [PrismaModule],
  controllers: [EvidenceIngestController],
  providers: [
    DriveClientService,
    InventoryService,
    DownloadService,
    ExtractService,
    PipelineService,
    EvidenceReportsService,
    ReviewQueueService,
    ChunkingService,
    EmbeddingService,
    RetrievalService,
    QueryExpanderService,
  ],
  exports: [
    DriveClientService,
    InventoryService,
    DownloadService,
    ExtractService,
    PipelineService,
    EvidenceReportsService,
    ReviewQueueService,
    ChunkingService,
    EmbeddingService,
    RetrievalService,
    QueryExpanderService,
  ],
})
export class EvidenceIngestModule {}
