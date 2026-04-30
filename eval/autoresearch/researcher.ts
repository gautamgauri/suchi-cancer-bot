/**
 * Autoresearch v0 — Researcher (Hypothesis Generator)
 *
 * For each failure bucket, uses an LLM (Deepseek via OpenAI-compatible API)
 * to analyse failure patterns, read the relevant repairable file, and
 * generate 2-5 candidate interventions ranked by confidence and risk.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { jsonrepair } from "jsonrepair";
import OpenAI from "openai";
import { retryableCompletion } from "./llm-retry";
import type { FailureBucket, Hypothesis } from "./types";

// ── Manifest types ──────────────────────────────────────────────────────────

interface ManifestEntry {
  path: string;
  description: string;
  source: string;
  risk: string;
  approvalRequired: boolean;
  notes: string;
}

interface RepairableManifest {
  files: ManifestEntry[];
}

// ── Failure-to-file mapping ─────────────────────────────────────────────────

const FAILURE_TYPE_FILE_HINTS: Record<string, string[]> = {
  safety: ["prompts/explain-mode.md", "prompts/navigate-mode.md", "config/disclaimer.json"],
  disclaimer: ["config/disclaimer.json", "prompts/explain-mode.md", "prompts/navigate-mode.md"],
  citation: ["config/retrieval.json", "prompts/explain-mode.md"],
  completeness: ["prompts/explain-mode.md", "prompts/identify-requirements.md", "prompts/navigate-mode.md"],
  tone: ["prompts/navigate-mode.md", "prompts/explain-mode.md"],
  grounding: ["config/retrieval.json", "prompts/explain-mode.md"],
  abstention: ["config/routing.json", "prompts/explain-mode.md"],
  other: ["config/routing.json", "prompts/explain-mode.md"],
};

// ── Researcher ──────────────────────────────────────────────────────────────

export class Researcher {
  private manifestPath: string;
  private repoRoot: string;
  private llmClient: OpenAI;
  private model: string;

  constructor(opts: {
    manifestPath: string;
    repoRoot: string;
    deepseekApiKey: string;
    deepseekBaseURL?: string;
    model?: string;
  }) {
    this.manifestPath = opts.manifestPath;
    this.repoRoot = opts.repoRoot;
    this.model = opts.model || "deepseek-chat";
    this.llmClient = new OpenAI({
      apiKey: opts.deepseekApiKey,
      baseURL: opts.deepseekBaseURL || "https://api.deepseek.com/v1",
    });
  }

  /**
   * Generate hypotheses for a failure bucket.
   * Returns 2-5 hypotheses sorted by confidence descending.
   * @param candidateFiles - Optional hint files from triage router (used if provided)
   */
  async generateHypotheses(bucket: FailureBucket, candidateFiles?: string[]): Promise<Hypothesis[]> {
    // 1. Load manifest to get allowed files
    const manifest = await this.loadManifest();
    const allowedFiles = manifest.files.map((f) => f.path);

    // 2. Identify candidate files for this failure type
    // Use triage hints if provided, otherwise fall back to built-in hints
    const resolvedCandidateFiles = candidateFiles?.length
      ? candidateFiles.filter((f) => allowedFiles.includes(f))
      : this.getCandidateFiles(bucket, manifest);

    // 3. Read the content of candidate files
    const fileContents: Record<string, string> = {};
    for (const filePath of resolvedCandidateFiles.slice(0, 3)) {
      try {
        const fullPath = path.join(this.repoRoot, "repairable", filePath);
        fileContents[filePath] = await fs.readFile(fullPath, "utf-8");
      } catch {
        fileContents[filePath] = "(file not found)";
      }
    }

    // 4. Build the research prompt
    const prompt = this.buildResearchPrompt(bucket, resolvedCandidateFiles, fileContents, allowedFiles);

    // 5. Call LLM
    const response = await this.callLLM(prompt);

    // 6. Parse hypotheses from response
    const hypotheses = this.parseHypotheses(response, allowedFiles);

    // 7. Sort by confidence descending, cap at 5
    return hypotheses
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async loadManifest(): Promise<RepairableManifest> {
    const raw = await fs.readFile(this.manifestPath, "utf-8");
    return JSON.parse(raw) as RepairableManifest;
  }

  private getCandidateFiles(bucket: FailureBucket, manifest: RepairableManifest): string[] {
    const hints = FAILURE_TYPE_FILE_HINTS[bucket.failureType] || FAILURE_TYPE_FILE_HINTS["other"];
    const allowed = new Set(manifest.files.map((f) => f.path));

    // Filter hints to only allowed files
    const candidates = hints.filter((h) => allowed.has(h));

    // If no hints match, return all allowed files
    if (candidates.length === 0) {
      return manifest.files.map((f) => f.path).slice(0, 3);
    }

    return candidates;
  }

  private buildResearchPrompt(
    bucket: FailureBucket,
    candidateFiles: string[],
    fileContents: Record<string, string>,
    allowedFiles: string[],
  ): string {
    const filesSection = Object.entries(fileContents)
      .map(([path, content]) => `### File: ${path}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``)
      .join("\n\n");

    return `You are a research engineer analysing failures in a cancer information chatbot's eval suite.

## Failure Cluster
- **Type**: ${bucket.failureType}
- **Severity**: ${bucket.severity}
- **Count**: ${bucket.count} failures across ${bucket.affectedCaseIds.length} cases
- **Failed checks**: ${bucket.failedCheckIds.join(", ")}
- **Representative failure**:
  - Case: ${bucket.representative.caseId}
  - Query: ${bucket.representative.query}
  - Response excerpt: ${bucket.representative.responseExcerpt.slice(0, 500)}
  - Failure reason: ${bucket.representative.failureReason}

## Candidate Repairable Files
These are the ONLY files you may propose changes to:
${allowedFiles.map((f) => `- ${f}`).join("\n")}

## Current File Contents
${filesSection}

## Task
Analyse the failure pattern and generate 2-5 hypotheses for the root cause and candidate fixes.

For EACH hypothesis, provide:
1. A short label (10 words max)
2. Root cause analysis (what is causing the failure)
3. Specific intervention (exact change to make)
4. Confidence score (0.0 to 1.0)
5. Risk level ("low", "medium", or "high")
6. Target file (MUST be one of the allowed files listed above)
7. Target section (which part of the file to modify)

IMPORTANT CONSTRAINTS:
- ONLY propose changes to files listed in the allowed files above
- NEVER weaken safety guardrails or remove disclaimers
- NEVER remove citation requirements
- Prefer minimal, surgical changes over broad rewrites
- Consider that changes may affect other test cases (regression risk)

Respond in valid JSON format as an array of hypothesis objects:
\`\`\`json
[
  {
    "label": "...",
    "rootCause": "...",
    "intervention": "...",
    "confidence": 0.8,
    "risk": "low",
    "repairableFile": "prompts/explain-mode.md",
    "targetSection": "..."
  }
]
\`\`\``;
  }

  private async callLLM(prompt: string): Promise<string> {
    const response = await retryableCompletion(
      this.llmClient,
      {
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a research engineer specialising in LLM prompt engineering and RAG system tuning for a cancer information chatbot. Respond only with valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 8000,
      },
      { label: "researcher" },
    );

    return response.choices[0]?.message?.content || "[]";
  }

  private parseHypotheses(response: string, allowedFiles: string[]): Hypothesis[] {
    // Strip markdown fences defensively. The earlier regex required a
    // CLOSING fence too; if the LLM hit max_tokens mid-array, no closing
    // fence existed, the regex returned null, and JSON.parse choked on
    // the raw "```json\n[..." string. This handles all four cases (both
    // fences, opening only, closing only, no fences).
    let jsonStr = response
      .trim()
      .replace(/^```(?:json|JSON)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();

    let parsed: any[];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err: any) {
      // Response may be truncated mid-array (finish_reason=length). Try
      // jsonrepair to recover complete objects before the cut point.
      try {
        parsed = JSON.parse(jsonrepair(jsonStr));
        console.warn(
          `Researcher: JSON was malformed (${err.message}) — repaired successfully. Raw (first 300 chars): ${response.slice(0, 300)}`,
        );
      } catch {
        console.warn(
          `Failed to parse LLM response as JSON (${err.message}). Raw response (first 600 chars): ${response.slice(0, 600)}`,
        );
        return [];
      }
    }

    if (!Array.isArray(parsed)) {
      console.warn(
        `LLM response is not an array (got ${typeof parsed}). Raw response (first 600 chars): ${response.slice(0, 600)}`,
      );
      return [];
    }

    const allowedSet = new Set(allowedFiles);
    const rejectedFiles: string[] = [];

    const accepted = parsed
      .filter((h: any) => {
        if (!h.repairableFile || !allowedSet.has(h.repairableFile)) {
          rejectedFiles.push(String(h.repairableFile ?? "(missing)"));
          return false;
        }
        return true;
      })
      .map((h: any) => ({
        label: String(h.label || "Unnamed hypothesis"),
        rootCause: String(h.rootCause || ""),
        intervention: String(h.intervention || ""),
        confidence: Math.min(1, Math.max(0, Number(h.confidence) || 0.5)),
        risk: (["low", "medium", "high"].includes(h.risk) ? h.risk : "medium") as "low" | "medium" | "high",
        repairableFile: String(h.repairableFile),
        targetSection: String(h.targetSection || ""),
        agent: "config" as const,
      }));

    if (rejectedFiles.length > 0) {
      console.warn(
        `Researcher: filtered ${rejectedFiles.length} hypothesis(es) targeting non-allowed file(s): [${rejectedFiles.join(", ")}]. Allowed: [${allowedFiles.join(", ")}]`,
      );
    }
    if (accepted.length === 0 && parsed.length > 0) {
      console.warn(
        `Researcher: LLM returned ${parsed.length} hypothesis(es) but ALL were filtered out as non-allowed files — bucket will skip with "(none)".`,
      );
    }

    return accepted;
  }
}
