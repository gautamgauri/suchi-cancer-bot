import { Module } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { SynonymService } from "./synonym-service";
import { QueryExpanderService } from "./query-expander.service";
import { RerankerService } from "./reranker.service";
import { RetrievalToolService } from "./retrieval-tool.service";
import { QueryDecomposerService } from "./query-decomposer.service";
import { CrossLingualService } from "./cross-lingual.service";

@Module({
  imports: [EmbeddingsModule],
  providers: [
    RagService,
    SynonymService,
    QueryExpanderService,
    RerankerService,
    RetrievalToolService,
    QueryDecomposerService,
    CrossLingualService,
  ],
  exports: [
    RagService,
    QueryExpanderService,
    RerankerService,
    RetrievalToolService,
    QueryDecomposerService,
    CrossLingualService,
  ],
})
export class RagModule {}
