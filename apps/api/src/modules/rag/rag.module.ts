import { Module } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { SynonymService } from "./synonym-service";
import { QueryExpanderService } from "./query-expander.service";
import { RerankerService } from "./reranker.service";
import { RetrievalToolService } from "./retrieval-tool.service";
import { QueryDecomposerService } from "./query-decomposer.service";
import { CrossLingualService } from "./cross-lingual.service";
import { KbFtsHealthService } from "./kb-fts-health.service";

@Module({
  imports: [EmbeddingsModule],
  providers: [
    RagService,
    KbFtsHealthService,
    SynonymService,
    QueryExpanderService,
    RerankerService,
    RetrievalToolService,
    QueryDecomposerService,
    CrossLingualService,
  ],
  exports: [
    RagService,
    KbFtsHealthService,
    QueryExpanderService,
    RerankerService,
    RetrievalToolService,
    QueryDecomposerService,
    CrossLingualService,
  ],
})
export class RagModule {}
