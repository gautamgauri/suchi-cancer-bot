import { Module } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { SynonymService } from "./synonym-service";
import { QueryExpanderService } from "./query-expander.service";

@Module({
  imports: [EmbeddingsModule],
  providers: [RagService, SynonymService, QueryExpanderService],
  exports: [RagService, QueryExpanderService]
})
export class RagModule {}
