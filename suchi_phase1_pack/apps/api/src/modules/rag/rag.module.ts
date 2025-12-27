import { Module } from "@nestjs/common";
import { RagService } from "./rag.service";
import { EmbeddingsModule } from "../embeddings/embeddings.module";
import { SynonymService } from "./synonym-service";

@Module({
  imports: [EmbeddingsModule],
  providers: [RagService, SynonymService],
  exports: [RagService]
})
export class RagModule {}
