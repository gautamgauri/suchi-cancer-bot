import { Module } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { SynonymService } from "./synonym-service";
import { QueryExpanderService } from "./query-expander.service";
import { RerankerService } from "./reranker.service";

@Module({
  imports: [EmbeddingsModule],
  providers: [RagService, SynonymService, QueryExpanderService, RerankerService],
  exports: [RagService, QueryExpanderService, RerankerService]
})
export class RagModule {}
