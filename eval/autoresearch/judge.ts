/**
 * Autoresearch v1 — Pairwise Patch Judge
 *
 * Given N candidate patches that all target the same failure bucket, ask a
 * cheap LLM (Gemini Flash) to compare them pairwise and return the one most
 * likely to fix the failures without regressing other behavior.
 *
 * Why: the field has converged on N-of-K proposers + judge selection (Cursor
 * 2.2 multi-agent, Karpathy autoresearch, Anthropic evaluator-optimizer).
 * Single-shot proposers produce no-ops in the noise floor; a cheap pairwise
 * judge filters them out before we spend a full subset eval per candidate.
 */

import OpenAI from "openai";
import { jsonrepair } from "jsonrepair";
import { retryableCompletion } from "./llm-retry";
import type { FailureBucket, PatchProposal } from "./types";

interface JudgeOpts {
  apiKey: string;
  baseURL: string;
  model: string;
}

interface PairwiseResult {
  winnerIndex: 0 | 1;
  reason: string;
}

export class PatchJudge {
  private client: OpenAI;
  private model: string;

  constructor(opts: JudgeOpts) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.model = opts.model;
  }

  /**
   * Pick the patch most likely to fix the bucket.
   * Round-robin pairwise tournament: every patch faces every other once,
   * winner of each pair gets +1. Highest score wins. Ties broken by patcher
   * confidence in the underlying hypothesis.
   */
  async pickWinner(
    patches: PatchProposal[],
    bucket: FailureBucket,
  ): Promise<{ winner: PatchProposal; scores: number[]; rationale: string[] }> {
    if (patches.length === 0) {
      throw new Error("PatchJudge.pickWinner called with empty candidates");
    }
    if (patches.length === 1) {
      return {
        winner: patches[0],
        scores: [1],
        rationale: ["only candidate — no comparison needed"],
      };
    }

    const scores = new Array(patches.length).fill(0);
    const rationale: string[] = [];

    // Run all pairwise comparisons in parallel — cheap on Flash.
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < patches.length; i++) {
      for (let j = i + 1; j < patches.length; j++) {
        pairs.push([i, j]);
      }
    }

    const results = await Promise.all(
      pairs.map(([i, j]) =>
        this.comparePair(patches[i], patches[j], bucket, `${i}v${j}`).catch((err) => {
          console.warn(`Judge comparison ${i} vs ${j} failed: ${err.message}`);
          return null;
        }),
      ),
    );

    pairs.forEach(([i, j], idx) => {
      const result = results[idx];
      if (!result) {
        // On failure, give half a point to each so they're not zeroed out.
        scores[i] += 0.5;
        scores[j] += 0.5;
        rationale.push(`#${i} vs #${j}: comparison errored (split)`);
        return;
      }
      const winnerOriginalIdx = result.winnerIndex === 0 ? i : j;
      scores[winnerOriginalIdx] += 1;
      rationale.push(`#${i} vs #${j}: winner #${winnerOriginalIdx} — ${result.reason.slice(0, 120)}`);
    });

    // Pick highest score; break ties by hypothesis confidence.
    let bestIdx = 0;
    for (let i = 1; i < patches.length; i++) {
      if (scores[i] > scores[bestIdx]) {
        bestIdx = i;
      } else if (scores[i] === scores[bestIdx]) {
        if (patches[i].hypothesis.confidence > patches[bestIdx].hypothesis.confidence) {
          bestIdx = i;
        }
      }
    }

    return { winner: patches[bestIdx], scores, rationale };
  }

  // ── Private ────────────────────────────────────────────────────────────

  private async comparePair(
    a: PatchProposal,
    b: PatchProposal,
    bucket: FailureBucket,
    pairLabel: string,
  ): Promise<PairwiseResult> {
    const prompt = this.buildComparePrompt(a, b, bucket);

    const response = await retryableCompletion(
      this.client,
      {
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a strict reviewer comparing two candidate patches for a cancer-information chatbot. Pick the one more likely to fix the failures without regressing safety or other behavior. Respond with valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.0,
        max_tokens: 400,
      },
      { label: `judge:${pairLabel}` },
    );

    const raw = response.choices[0]?.message?.content || "";
    return this.parseResult(raw);
  }

  private buildComparePrompt(
    a: PatchProposal,
    b: PatchProposal,
    bucket: FailureBucket,
  ): string {
    const tag = bucket.clusterTag ? ` (${bucket.clusterTag})` : "";
    return `## Failure Cluster
- Type: ${bucket.failureType}${tag}
- Severity: ${bucket.severity}
- Affected cases: ${bucket.affectedCaseIds.length}
- Failed checks: ${bucket.failedCheckIds.join(", ")}
- Representative case: ${bucket.representative.caseId}
- Failure reason: ${bucket.representative.failureReason.slice(0, 400)}

## Candidate A
- File: ${a.filePath}
- Hypothesis: ${a.hypothesis.label}
- Root cause: ${a.hypothesis.rootCause.slice(0, 200)}
- Intervention: ${a.hypothesis.intervention.slice(0, 200)}
- Risk: ${a.hypothesis.risk}
- Diff:
\`\`\`
${a.diff.slice(0, 1500)}
\`\`\`

## Candidate B
- File: ${b.filePath}
- Hypothesis: ${b.hypothesis.label}
- Root cause: ${b.hypothesis.rootCause.slice(0, 200)}
- Intervention: ${b.hypothesis.intervention.slice(0, 200)}
- Risk: ${b.hypothesis.risk}
- Diff:
\`\`\`
${b.diff.slice(0, 1500)}
\`\`\`

## Decision Criteria
1. Which patch most directly addresses the failure reason for the representative case?
2. Which patch is MORE LIKELY to also fix similar cases in the cluster (not just one)?
3. Which patch has LOWER regression risk on unrelated behavior (other prompts, other languages, safety)?
4. Penalize patches that add boilerplate, lecture-style instructions, or weaken safety guardrails.
5. Prefer surgical changes over broad rewrites.

Respond ONLY with JSON:
\`\`\`json
{ "winner": "A" | "B", "reason": "<one sentence, <= 25 words>" }
\`\`\``;
  }

  private parseResult(raw: string): PairwiseResult {
    // Strip fences defensively — closing fence may be absent when the
    // judge's response was truncated. See researcher.ts for context.
    let jsonStr = raw
      .trim()
      .replace(/^```(?:json|JSON)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();

    let parsed: { winner?: string; reason?: string };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try jsonrepair for truncated responses before falling back to regex.
      try {
        parsed = JSON.parse(jsonrepair(jsonStr));
      } catch {
        // Last resort: scan for "winner": "A" / "B" anywhere in the text.
        const m = raw.match(/"?winner"?\s*[:=]\s*"?([AB])"?/i);
        if (!m) throw new Error("Judge response not parseable as JSON and no winner field found");
        parsed = { winner: m[1].toUpperCase(), reason: raw.slice(0, 200) };
      }
    }

    const winner = (parsed.winner || "").toUpperCase();
    if (winner !== "A" && winner !== "B") {
      throw new Error(`Judge returned invalid winner: ${parsed.winner}`);
    }

    return {
      winnerIndex: winner === "A" ? 0 : 1,
      reason: parsed.reason || "(no reason)",
    };
  }
}
