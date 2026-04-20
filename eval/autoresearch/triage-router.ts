/**
 * Autoresearch — Triage Router
 *
 * Routes failure buckets to the appropriate repair agent based on
 * failure type, severity, and retrieval quality signals.
 *
 * Agent dispatch:
 *   - Prompt Agent: tone, completeness, safety instruction issues
 *   - KB Agent: grounding failures where content is missing from KB
 *   - Config Agent: citation formatting, routing, retrieval tuning
 */

import type { FailureBucket, TriageDecision, RepairAgentType } from "./types";

// ── Failure type → agent mapping ────────────────────────────────────────────

/**
 * Primary mapping: which agent handles which failure types.
 *
 * Design rationale:
 *   - `tone`, `completeness` → almost always a prompt instruction problem
 *   - `grounding` → could be KB gap OR prompt not using chunks well;
 *     we default to KB but allow override via retrieval quality signal
 *   - `citation` → usually a retrieval config or prompt citation format issue
 *   - `safety`, `disclaimer` → config agent (bounded, high-risk files)
 *   - `abstention` → routing/config issue
 */
const FAILURE_TYPE_AGENT_MAP: Record<string, RepairAgentType> = {
  tone: "prompt",
  completeness: "prompt",
  grounding: "kb",
  citation: "config",
  safety: "config",
  disclaimer: "config",
  abstention: "config",
  // Voice-specific failure types
  voice_formatting: "prompt",
  voice_length: "prompt",
  voice_naturalness: "prompt",
};

// ── Agent-specific file hints ───────────────────────────────────────────────

const AGENT_FILE_HINTS: Record<RepairAgentType, Record<string, string[]>> = {
  prompt: {
    tone: ["prompts/navigate-mode.md", "prompts/explain-mode.md"],
    completeness: ["prompts/explain-mode.md", "prompts/identify-requirements.md", "prompts/navigate-mode.md"],
    voice_formatting: ["prompts/explain-mode.md", "prompts/navigate-mode.md"],
    voice_length: ["prompts/explain-mode.md", "prompts/navigate-mode.md"],
    voice_naturalness: ["prompts/navigate-mode.md", "prompts/explain-mode.md"],
    // Prompt agent can also handle grounding if retrieval is adequate
    grounding: ["prompts/explain-mode.md", "prompts/navigate-mode.md"],
  },
  kb: {
    grounding: [],  // KB agent discovers files dynamically via gap analysis
    completeness: [],
  },
  config: {
    citation: ["config/retrieval.json", "prompts/explain-mode.md"],
    safety: ["prompts/explain-mode.md", "prompts/navigate-mode.md", "config/disclaimer.json"],
    disclaimer: ["config/disclaimer.json", "prompts/explain-mode.md", "prompts/navigate-mode.md"],
    abstention: ["config/routing.json", "prompts/explain-mode.md"],
    grounding: ["config/retrieval.json"],
  },
};

// ── Triage Router ───────────────────────────────────────────────────────────

export class TriageRouter {
  /**
   * Route a failure bucket to the appropriate repair agent.
   *
   * @param bucket - The failure bucket to route
   * @param retrievalQuality - Optional signal: average retrieval similarity
   *   score for the affected cases (0-1). If provided and high (>= 0.5),
   *   grounding failures are routed to Prompt Agent instead of KB Agent
   *   (the content exists, the prompt just isn't using it well).
   */
  route(
    bucket: FailureBucket,
    retrievalQuality?: number,
  ): TriageDecision {
    const failureType = bucket.failureType;

    // 1. Check explicit mapping
    let agent = FAILURE_TYPE_AGENT_MAP[failureType] ?? "config";

    // 2. Override: grounding failures with good retrieval → prompt agent
    //    (KB has the content, but prompt isn't leveraging it)
    if (failureType === "grounding" && retrievalQuality !== undefined && retrievalQuality >= 0.5) {
      agent = "prompt";
    }

    // 3. Override: completeness failures where the representative mentions
    //    "no relevant" or "missing content" → KB agent
    if (failureType === "completeness") {
      const reason = bucket.representative.failureReason.toLowerCase();
      if (reason.includes("no relevant") || reason.includes("missing content") || reason.includes("not found in kb")) {
        agent = "kb";
      }
    }

    // 4. Build candidate files
    const agentHints = AGENT_FILE_HINTS[agent] ?? {};
    const candidateFiles = agentHints[failureType] ?? [];

    // 5. Compute confidence
    const confidence = this.computeConfidence(agent, failureType, retrievalQuality);

    return {
      agent,
      confidence,
      reason: this.buildReason(agent, failureType, retrievalQuality),
      candidateFiles,
    };
  }

  /**
   * Route all buckets and return them grouped by agent.
   */
  routeAll(
    buckets: FailureBucket[],
    retrievalQualities?: Map<string, number>,
  ): Map<RepairAgentType, Array<{ bucket: FailureBucket; decision: TriageDecision }>> {
    const grouped = new Map<RepairAgentType, Array<{ bucket: FailureBucket; decision: TriageDecision }>>();

    for (const bucket of buckets) {
      // Use per-bucket retrieval quality if available
      const quality = retrievalQualities?.get(bucket.failureType);
      const decision = this.route(bucket, quality);

      const group = grouped.get(decision.agent) ?? [];
      group.push({ bucket, decision });
      grouped.set(decision.agent, group);
    }

    return grouped;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private computeConfidence(
    agent: RepairAgentType,
    failureType: string,
    retrievalQuality?: number,
  ): number {
    // High confidence for direct mappings
    const directMappings: Record<string, RepairAgentType> = {
      tone: "prompt",
      disclaimer: "config",
      safety: "config",
      abstention: "config",
      voice_formatting: "prompt",
      voice_length: "prompt",
      voice_naturalness: "prompt",
    };

    if (directMappings[failureType] === agent) {
      return 0.9;
    }

    // Grounding with retrieval signal → high confidence
    if (failureType === "grounding" && retrievalQuality !== undefined) {
      return retrievalQuality >= 0.5 ? 0.8 : 0.75;
    }

    // Completeness → depends on whether KB or prompt
    if (failureType === "completeness") {
      return agent === "kb" ? 0.7 : 0.8;
    }

    // Citation → moderate (could be prompt or config)
    if (failureType === "citation") {
      return 0.7;
    }

    return 0.6;
  }

  private buildReason(
    agent: RepairAgentType,
    failureType: string,
    retrievalQuality?: number,
  ): string {
    const agentLabel = { prompt: "Prompt Agent", kb: "KB Agent", config: "Config Agent" }[agent];

    if (failureType === "grounding" && agent === "prompt" && retrievalQuality !== undefined) {
      return `${agentLabel}: retrieval quality ${(retrievalQuality * 100).toFixed(0)}% suggests KB has content — prompt not leveraging it`;
    }

    if (failureType === "grounding" && agent === "kb") {
      return `${agentLabel}: grounding failure likely due to missing or incomplete KB content`;
    }

    if (failureType === "completeness" && agent === "kb") {
      return `${agentLabel}: completeness failure mentions missing content — KB gap suspected`;
    }

    const typeReasons: Record<string, string> = {
      tone: "tone/empathy issues are best addressed by tuning prompt instructions",
      completeness: "completeness gaps likely caused by prompt coverage requirements",
      citation: "citation format/coverage tuned via retrieval config",
      safety: "safety issues handled via bounded config changes only",
      disclaimer: "disclaimer content managed in config/disclaimer.json",
      abstention: "abstention routing managed via config/routing.json",
      voice_formatting: "voice formatting issues addressed by prompt voice constraints",
      voice_length: "voice length issues addressed by prompt word limits",
      voice_naturalness: "voice naturalness improved via prompt tone instructions",
    };

    return `${agentLabel}: ${typeReasons[failureType] || "default routing"}`;
  }
}
