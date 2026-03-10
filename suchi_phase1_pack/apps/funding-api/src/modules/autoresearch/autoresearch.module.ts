import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { EvidenceIngestModule } from "../evidence_ingest/evidence-ingest.module";
import { AutoresearchController } from "./autoresearch.controller";
import { RetrievalBenchmarkService } from "./retrieval-benchmark.service";

@Module({
  imports: [PrismaModule, EvidenceIngestModule],
  controllers: [AutoresearchController],
  providers: [RetrievalBenchmarkService],
  exports: [RetrievalBenchmarkService],
})
export class AutoresearchModule {}
