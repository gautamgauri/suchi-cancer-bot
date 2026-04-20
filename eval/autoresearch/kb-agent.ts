/**
 * Autoresearch — KB Agent (Phase 2 Stub)
 *
 * Specialized agent for knowledge base content improvement.
 * Handles failures where RAG retrieval returns sparse/irrelevant chunks
 * because the KB simply doesn't contain the needed information.
 *
 * Capabilities (to be implemented in Phase 2):
 *   1. Gap detection — query vector DB to confirm content is missing
 *   2. Content drafting — write/extend KB articles from authoritative sources
 *   3. Manifest update — register new articles in kb/manifest.json
 *   4. Re-ingestion — trigger ingest-kb.ts for new/modified articles
 *   5. Chunk quality — detect badly-chunked articles (too short, missing headers)
 *
 * Repairable surface: kb/en/**\/*.md + kb/manifest.json
 * Requires multi-step workflow: write → register → ingest → verify retrieval
 */

import type { FailureBucket, Hypothesis, PatchProposal } from "./types";

// ── KB Researcher (stub) ────────────────────────────────────────────────────

export class KBResearcher {
  constructor(_opts: {
    manifestPath: string;
    repoRoot: string;
    kbRoot: string;
    deepseekApiKey: string;
    deepseekBaseURL?: string;
    model?: string;
    apiBaseUrl?: string;
  }) {
    // Phase 2: initialize KB manifest reader, vector DB client, etc.
  }

  /**
   * Generate hypotheses for KB content gaps.
   *
   * Phase 2 implementation will:
   *   1. Extract the query from the failure bucket
   *   2. Run a retrieval query against the API to check chunk relevance
   *   3. If chunks are sparse/irrelevant, identify which KB article is missing
   *   4. Search NCI/NCG sources for authoritative content
   *   5. Return hypotheses like "Add article on X" or "Extend section Y in article Z"
   */
  async generateHypotheses(
    bucket: FailureBucket,
    _candidateFiles?: string[],
  ): Promise<Hypothesis[]> {
    console.warn(
      `KB Agent: generateHypotheses() is a Phase 2 stub. ` +
      `Bucket: ${bucket.failureType} (${bucket.count} failures). ` +
      `Returning empty hypotheses — this failure type needs KB content improvement.`,
    );
    return [];
  }
}

// ── KB Patcher (stub) ───────────────────────────────────────────────────────

export class KBPatcher {
  constructor(_opts: {
    manifestPath: string;
    repoRoot: string;
    kbRoot: string;
    deepseekApiKey: string;
    deepseekBaseURL?: string;
    model?: string;
  }) {
    // Phase 2: initialize KB paths, manifest writer, etc.
  }

  /**
   * Generate a KB content patch.
   *
   * Phase 2 implementation will:
   *   1. Draft markdown content for the new/modified article
   *   2. Add YAML frontmatter with proper metadata
   *   3. Update kb/manifest.json with the new entry
   *   4. Validate KB article structure (headers for good chunking)
   *   5. Optionally trigger ingestion pipeline
   *
   * Unlike prompt/config patches, KB patches involve multiple files:
   *   - The KB article itself (kb/en/.../*.md)
   *   - The manifest (kb/manifest.json)
   *   - Potentially the ingestion script invocation
   */
  async proposePatch(
    _hypothesis: Hypothesis,
    _experimentId: string,
  ): Promise<PatchProposal | null> {
    console.warn(
      "KB Agent: proposePatch() is a Phase 2 stub. Returning null.",
    );
    return null;
  }

  async applyPatch(_patch: PatchProposal): Promise<{ branch: string; commit: string | null }> {
    console.warn("KB Agent: applyPatch() is a Phase 2 stub.");
    return { branch: "", commit: null };
  }

  async revertPatch(_patch: PatchProposal): Promise<void> {
    console.warn("KB Agent: revertPatch() is a Phase 2 stub.");
  }
}
