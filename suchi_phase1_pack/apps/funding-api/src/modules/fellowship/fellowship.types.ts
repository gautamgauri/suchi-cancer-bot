import type { RetrievalChunkDto } from "../evidence_ingest/retrieval.service";

export interface FellowshipDraftOptions {
  maxSectionsOverride?: number;
  skipCritic?: boolean;
}

export interface FellowshipContext {
  applicantProfile: string;
  pastAnswers: string;
  personalChunks: RetrievalChunkDto[];
  dbSnippets: string;
}
