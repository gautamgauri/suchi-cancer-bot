export interface EvidenceChunk {
  chunkId: string;
  docId: string;
  content: string;
  document: {
    title: string;
    url?: string;
    source?: string | null;
    sourceType?: string | null;
    citation?: string | null;
  };
  similarity?: number;
}

export interface FundingConversationContext {
  funderName?: string;
  intent?: string;
  checklist?: string;
}
