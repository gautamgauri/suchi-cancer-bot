import { Module } from "@nestjs/common";
import { CitationService } from "./citation.service";

@Module({
  providers: [CitationService],
  exports: [CitationService]
})
export class CitationModule {}





