/**
 * Autoresearch — Prompt Agent
 *
 * Specialized researcher + patcher for prompt engineering improvements.
 * Unlike the generic Config Agent (researcher.ts + patcher.ts), this agent:
 *
 *   1. Understands prompt structure (system instructions, response contracts,
 *      safety invariants, citation format)
 *   2. Generates hypotheses grounded in prompt engineering principles
 *      (instruction clarity, ordering, conflict resolution, coverage)
 *   3. Validates patches for prompt-specific issues:
 *      - Safety invariant preservation (NEVER DO, disclaimer, citation rules)
 *      - Token budget awareness
 *      - Instruction conflict detection
 *      - Section completeness
 *
 * Repairable surface: prompts/*.md files in the manifest.
 * Does NOT edit TypeScript source — only the canonical .md prompt files.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";
import type { FailureBucket, Hypothesis, PatchProposal } from "./types";
import { retryableCompletion } from "./llm-retry";

const execFileAsync = promisify(execFile);

// ── Safety invariants that must never be weakened ───────────────────────────

const SAFETY_INVARIANT_PATTERNS = [
  // Never-do rules
  /NEVER\s+(DO|weaken|remove|skip|omit)/i,
  /MUST\s+(NOT|never)/i,
  /do\s+NOT\s+(diagnose|prescribe|provide.*prognosis|give.*dosage)/i,
  // Disclaimer requirements
  /disclaimer/i,
  /always.*append/i,
  // Citation requirements
  /citation.*required/i,
  /cite.*medical.*facts/i,
  /\[citation:.*\]/,
  // Safety-critical sections
  /SAFE\s*\+\s*USEFUL/i,
  /evidence[- ]only/i,
];

/** Phrases that indicate safety language is being weakened */
const WEAKENING_PATTERNS = [
  { strong: /you must/gi, weak: /you (should|could|might|may)/gi },
  { strong: /NEVER/gi, weak: /avoid|try not to/gi },
  { strong: /required/gi, weak: /optional|recommended/gi },
  { strong: /always/gi, weak: /when possible|if applicable/gi },
];

// ── Manifest types ──────────────────────────────────────────────────────────

interface ManifestEntry {
  path: string;
  description: string;
  source: string;
  risk: string;
  approvalRequired: boolean;
  notes: string;
  agent?: string;
}

interface RepairableManifest {
  files: ManifestEntry[];
}

// ── Prompt Researcher ───────────────────────────────────────────────────────

export class PromptResearcher {
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
   * Generate prompt-engineering-aware hypotheses for a failure bucket.
   */
  async generateHypotheses(
    bucket: FailureBucket,
    candidateFiles?: string[],
  ): Promise<Hypothesis[]> {
    const manifest = await this.loadManifest();
    const promptFiles = manifest.files
      .filter((f) => f.path.startsWith("prompts/"))
      .map((f) => f.path);

    // Use provided candidate files or fall back to all prompt files
    const targets = candidateFiles?.length
      ? candidateFiles.filter((f) => promptFiles.includes(f))
      : promptFiles;

    if (targets.length === 0) {
      console.warn("Prompt Agent: no prompt files in manifest to target");
      return [];
    }

    // Read file contents
    const fileContents: Record<string, string> = {};
    for (const filePath of targets.slice(0, 3)) {
      try {
        const fullPath = path.join(this.repoRoot, "repairable", filePath);
        fileContents[filePath] = await fs.readFile(fullPath, "utf-8");
      } catch {
        fileContents[filePath] = "(file not found)";
      }
    }

    const prompt = this.buildPrompt(bucket, targets, fileContents, promptFiles);
    const response = await this.callLLM(prompt);
    return this.parseHypotheses(response, promptFiles);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async loadManifest(): Promise<RepairableManifest> {
    const raw = await fs.readFile(this.manifestPath, "utf-8");
    return JSON.parse(raw) as RepairableManifest;
  }

  private buildPrompt(
    bucket: FailureBucket,
    candidateFiles: string[],
    fileContents: Record<string, string>,
    allowedFiles: string[],
  ): string {
    const filesSection = Object.entries(fileContents)
      .map(([p, content]) => `### File: ${p}\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\``)
      .join("\n\n");

    return `You are a **prompt engineer** specialising in LLM system prompts for a cancer information chatbot (Suchi).

## Your expertise
- System prompt instruction design (ordering, clarity, coverage)
- Response contract engineering ("SAFE + USEFUL" patterns)
- Safety guardrail language (precise imperatives vs vague suggestions)
- Citation and grounding instruction design
- Multi-turn conversation context management
- Emotional state-aware prompt conditioning

## Failure Cluster
- **Type**: ${bucket.failureType}
- **Severity**: ${bucket.severity}
- **Count**: ${bucket.count} failures across ${bucket.affectedCaseIds.length} cases
- **Failed checks**: ${bucket.failedCheckIds.join(", ")}
- **Representative failure**:
  - Case: ${bucket.representative.caseId}
  - Query: ${bucket.representative.query}
  - Response excerpt: ${bucket.representative.responseExcerpt.slice(0, 600)}
  - Failure reason: ${bucket.representative.failureReason}

## Prompt Files You May Edit
${allowedFiles.map((f) => `- ${f}`).join("\n")}

## Current Prompt Contents
${filesSection}

## Task
Analyse the failure pattern through a **prompt engineering lens** and generate 2-5 hypotheses.

For each hypothesis, think about:
1. Is there an **instruction gap** (the prompt never tells the LLM to do X)?
2. Is there an **instruction conflict** (two parts of the prompt contradict)?
3. Is there an **instruction ordering issue** (important rule buried too deep)?
4. Is there a **coverage gap** (the prompt handles cancer type A but not B)?
5. Is there a **specificity gap** (vague instruction like "be helpful" vs concrete "include 3+ bullet points")?

For EACH hypothesis, provide:
1. A short label (10 words max)
2. Root cause analysis (focus on the PROMPT INSTRUCTION that causes the failure)
3. Specific intervention (exact wording change, section addition, or reordering)
4. Confidence score (0.0 to 1.0)
5. Risk level ("low", "medium", or "high")
6. Target file (MUST be one of the allowed prompt files)
7. Target section (which part of the file to modify)

CRITICAL CONSTRAINTS:
- ONLY edit prompt files listed above (prompts/*.md)
- NEVER weaken safety language ("you must" -> "you should" is FORBIDDEN)
- NEVER remove or weaken citation requirements
- NEVER remove the "NEVER DO" / disclaimer / SAFE+USEFUL sections
- Prefer ADDING specific instructions over removing existing ones
- Prefer making vague instructions MORE SPECIFIC over broad rewrites
- Consider regression risk: changes to explain-mode affect ALL informational queries

Respond in valid JSON format:
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
              "You are a senior prompt engineer specialising in medical AI safety. You analyse failure patterns in LLM system prompts and propose precise, minimal changes. Respond only with valid JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      },
      { label: "prompt-researcher" },
    );

    return response.choices[0]?.message?.content || "[]";
  }

  private parseHypotheses(response: string, allowedFiles: string[]): Hypothesis[] {
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let parsed: any[];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err: any) {
      console.warn(
        `Prompt Agent: failed to parse LLM response as JSON (${err.message}). Raw response (first 600 chars): ${response.slice(0, 600)}`,
      );
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn(
        `Prompt Agent: LLM response is not an array (got ${typeof parsed}). Raw response (first 600 chars): ${response.slice(0, 600)}`,
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
        agent: "prompt" as const,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    if (rejectedFiles.length > 0) {
      console.warn(
        `Prompt Agent: filtered ${rejectedFiles.length} hypothesis(es) targeting non-allowed file(s): [${rejectedFiles.join(", ")}]. Allowed: [${allowedFiles.join(", ")}]`,
      );
    }
    if (accepted.length === 0 && parsed.length > 0) {
      console.warn(
        `Prompt Agent: LLM returned ${parsed.length} hypothesis(es) but ALL were filtered out as non-allowed files — bucket will skip with "(none)".`,
      );
    }

    return accepted;
  }
}

// ── Prompt Patcher ──────────────────────────────────────────────────────────

export class PromptPatcher {
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
   * Generate a prompt-aware patch proposal.
   * Includes structural validation beyond basic syntax.
   */
  async proposePatch(
    hypothesis: Hypothesis,
    experimentId: string,
  ): Promise<PatchProposal | null> {
    // 1. Validate file is a prompt file
    if (!hypothesis.repairableFile.startsWith("prompts/")) {
      console.error(`Prompt Agent: file ${hypothesis.repairableFile} is not a prompt file`);
      return null;
    }

    const manifest = await this.loadManifest();
    const allowedPaths = manifest.files.map((f: any) => f.path);
    if (!allowedPaths.includes(hypothesis.repairableFile)) {
      console.error(`Prompt Agent: file ${hypothesis.repairableFile} not in manifest`);
      return null;
    }

    // 2. Read current content
    const fullPath = path.join(this.repoRoot, "repairable", hypothesis.repairableFile);
    let originalContent: string;
    try {
      originalContent = await fs.readFile(fullPath, "utf-8");
    } catch {
      console.error(`Prompt Agent: cannot read ${fullPath}`);
      return null;
    }

    // 3. Generate patched content
    const proposedContent = await this.generatePatchedContent(
      hypothesis,
      originalContent,
      hypothesis.repairableFile,
    );

    if (!proposedContent || proposedContent === originalContent) {
      console.warn("Prompt Agent: LLM produced no changes or identical content");
      return null;
    }

    // 4. Validate: syntax + prompt-specific checks
    const validation = this.validatePromptPatch(
      hypothesis.repairableFile,
      originalContent,
      proposedContent,
    );

    // 5. Generate diff
    const diff = this.generateDiff(originalContent, proposedContent);

    const branch = `autoresearch/${experimentId}`;

    return {
      filePath: hypothesis.repairableFile,
      originalContent,
      proposedContent,
      diff,
      hypothesis,
      validation,
      branch,
    };
  }

  /**
   * Apply a patch: write the file and create a git branch + commit.
   */
  async applyPatch(patch: PatchProposal): Promise<{ branch: string; commit: string | null }> {
    const cwd = this.repoRoot;

    try {
      await execFileAsync("git", ["checkout", "-b", patch.branch], { cwd });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        await execFileAsync("git", ["checkout", patch.branch], { cwd });
      } else {
        throw err;
      }
    }

    const fullPath = path.join(this.repoRoot, "repairable", patch.filePath);
    await fs.writeFile(fullPath, patch.proposedContent, "utf-8");

    let commit: string | null = null;
    try {
      await execFileAsync("git", ["add", fullPath], { cwd });
      await execFileAsync(
        "git",
        [
          "commit",
          "-m",
          `autoresearch(prompt): ${patch.hypothesis.label}\n\nAgent: prompt\nFile: ${patch.filePath}\nExperiment: ${patch.branch}`,
        ],
        { cwd },
      );
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      commit = stdout.trim();
    } catch (err) {
      console.warn("Prompt Agent: failed to commit:", err instanceof Error ? err.message : String(err));
    }

    return { branch: patch.branch, commit };
  }

  /**
   * Revert a patch: restore original content and switch back to main.
   */
  async revertPatch(patch: PatchProposal): Promise<void> {
    const cwd = this.repoRoot;
    const fullPath = path.join(this.repoRoot, "repairable", patch.filePath);

    await fs.writeFile(fullPath, patch.originalContent, "utf-8");

    try {
      await execFileAsync("git", ["stash", "--include-untracked"], { cwd });
    } catch { /* nothing to stash */ }

    await execFileAsync("git", ["checkout", "main"], { cwd });

    try {
      await execFileAsync("git", ["stash", "drop"], { cwd });
    } catch { /* no stash to drop */ }
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async loadManifest(): Promise<any> {
    const raw = await fs.readFile(this.manifestPath, "utf-8");
    return JSON.parse(raw);
  }

  private async generatePatchedContent(
    hypothesis: Hypothesis,
    originalContent: string,
    filePath: string,
  ): Promise<string> {
    const prompt = `You are editing a **system prompt file** for a cancer information chatbot (Suchi).
This is a prompt engineering task — you are modifying the instructions that guide the LLM's behavior.

## File: ${filePath}

## Current prompt content:
\`\`\`
${originalContent}
\`\`\`

## Hypothesis
- **Label**: ${hypothesis.label}
- **Root cause**: ${hypothesis.rootCause}
- **Intervention**: ${hypothesis.intervention}
- **Target section**: ${hypothesis.targetSection}

## Task
Apply the intervention to produce the updated prompt file.

PROMPT ENGINEERING CONSTRAINTS:
- Return ONLY the complete updated file content, nothing else
- Do NOT wrap the output in markdown code blocks
- Preserve all existing sections not targeted by the intervention
- INSTRUCTION ORDERING: Place important rules near the top; LLMs attend more to early instructions
- SPECIFICITY: Use concrete numbers ("at least 3 bullets") not vague guidance ("several bullets")
- SAFETY INVARIANTS — these MUST be preserved exactly:
  * All "NEVER DO" / "MUST NOT" rules
  * Disclaimer requirements
  * Citation format requirements ([citation:docId:chunkId])
  * SAFE + USEFUL contract
  * Evidence-only policy
- NEVER weaken imperative language ("you must" -> "you should" is FORBIDDEN)
- Make MINIMAL changes — only what the intervention requires
- If adding a new instruction, place it logically near related existing instructions`;

    const response = await retryableCompletion(
      this.llmClient,
      {
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a precise prompt editor for a medical AI chatbot. Output only the complete updated prompt file. No wrapping, no explanation.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 8000,
      },
      { label: "prompt-patcher" },
    );

    let content = response.choices[0]?.message?.content || "";

    // Strip accidental code blocks
    const codeBlockMatch = content.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1];
    }

    return content.trim();
  }

  /**
   * Prompt-specific validation beyond basic syntax.
   *
   * Checks:
   *   1. Basic markdown validity (balanced code blocks, min length)
   *   2. Safety invariant preservation (NEVER DO, disclaimers, citations)
   *   3. Safety language weakening detection
   *   4. Section completeness (key sections not removed)
   */
  private validatePromptPatch(
    filePath: string,
    originalContent: string,
    proposedContent: string,
  ): { syntaxValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Basic markdown checks
    const codeBlockCount = (proposedContent.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      errors.push("Unbalanced code blocks in Markdown");
    }
    if (proposedContent.trim().length < 50) {
      errors.push("Prompt content suspiciously short (< 50 chars)");
    }

    // 2. Safety invariant preservation
    for (const pattern of SAFETY_INVARIANT_PATTERNS) {
      const originalMatches = originalContent.match(pattern);
      if (originalMatches) {
        const proposedMatches = proposedContent.match(pattern);
        if (!proposedMatches) {
          errors.push(`Safety invariant removed: pattern "${pattern.source}" was in original but not in proposed`);
        }
      }
    }

    // 3. Safety language weakening detection
    for (const { strong, weak } of WEAKENING_PATTERNS) {
      const origStrongCount = (originalContent.match(strong) || []).length;
      const proposedStrongCount = (proposedContent.match(strong) || []).length;

      if (proposedStrongCount < origStrongCount) {
        // Strong language was reduced — check if it was replaced with weak
        const proposedWeakCount = (proposedContent.match(weak) || []).length;
        const origWeakCount = (originalContent.match(weak) || []).length;

        if (proposedWeakCount > origWeakCount) {
          errors.push(`Safety language weakened: "${strong.source}" reduced from ${origStrongCount} to ${proposedStrongCount}, while weak form "${weak.source}" increased`);
        }
      }
    }

    // 4. Key section preservation
    const keySections = this.getKeySections(filePath);
    for (const section of keySections) {
      if (originalContent.includes(section) && !proposedContent.includes(section)) {
        errors.push(`Key section removed: "${section}"`);
      }
    }

    return { syntaxValid: errors.length === 0, errors };
  }

  private getKeySections(filePath: string): string[] {
    if (filePath.includes("explain-mode")) {
      return ["SAFE + USEFUL", "NEVER DO", "CITATION FORMAT", "evidence"];
    }
    if (filePath.includes("navigate-mode")) {
      return ["SAFE + USEFUL", "India context", "112", "108"];
    }
    if (filePath.includes("identify-requirements")) {
      return ["WARNING SIGNS", "HOW DOCTORS CONFIRM", "WHEN TO SEEK CARE", "QUESTIONS TO ASK"];
    }
    return [];
  }

  private generateDiff(original: string, proposed: string): string {
    const origLines = original.split("\n");
    const propLines = proposed.split("\n");
    const diffLines: string[] = [];
    const maxLen = Math.max(origLines.length, propLines.length);

    let contextBefore = 0;
    for (let i = 0; i < maxLen; i++) {
      const origLine = origLines[i];
      const propLine = propLines[i];

      if (origLine === propLine) {
        contextBefore++;
        continue;
      }

      if (contextBefore > 0) {
        const start = Math.max(0, i - Math.min(contextBefore, 3));
        for (let j = start; j < i; j++) {
          diffLines.push(` ${origLines[j] || ""}`);
        }
        contextBefore = 0;
      }

      if (origLine !== undefined && propLine !== undefined) {
        diffLines.push(`-${origLine}`);
        diffLines.push(`+${propLine}`);
      } else if (origLine !== undefined) {
        diffLines.push(`-${origLine}`);
      } else if (propLine !== undefined) {
        diffLines.push(`+${propLine}`);
      }
    }

    return diffLines.join("\n");
  }
}
