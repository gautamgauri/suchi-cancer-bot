/**
 * Autoresearch v0 — Patcher (Patch Proposer)
 *
 * Takes a hypothesis and generates a concrete diff for a repairable file.
 * Validates that the file is in the manifest, the patch is syntactically
 * valid, and creates a git branch for the experiment.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";
import { retryableCompletion } from "./llm-retry";
import type { Hypothesis, PatchProposal } from "./types";

const execFileAsync = promisify(execFile);

// ── Patcher ─────────────────────────────────────────────────────────────────

export class Patcher {
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
   * Generate a patch proposal for a hypothesis.
   * Returns null if the file is not in the manifest or patch generation fails.
   */
  async proposePatch(
    hypothesis: Hypothesis,
    experimentId: string,
  ): Promise<PatchProposal | null> {
    // 1. Validate file is in manifest
    const manifest = await this.loadManifest();
    const allowedPaths = manifest.files.map((f: any) => f.path);
    if (!allowedPaths.includes(hypothesis.repairableFile)) {
      console.error(`File ${hypothesis.repairableFile} is not in the repairable manifest. Skipping.`);
      return null;
    }

    // 2. Read current file content
    const fullPath = path.join(this.repoRoot, "repairable", hypothesis.repairableFile);
    let originalContent: string;
    try {
      originalContent = await fs.readFile(fullPath, "utf-8");
    } catch {
      console.error(`Cannot read ${fullPath}. Skipping.`);
      return null;
    }

    // 3. Generate the patched content via LLM
    const proposedContent = await this.generatePatchedContent(
      hypothesis,
      originalContent,
      hypothesis.repairableFile,
    );

    if (!proposedContent || proposedContent === originalContent) {
      console.warn("LLM produced no changes or identical content. Skipping.");
      return null;
    }

    // 4. Validate syntax
    const validation = this.validateSyntax(hypothesis.repairableFile, proposedContent);

    // 5. Generate diff
    const diff = this.generateDiff(originalContent, proposedContent);

    // 6. Create git branch
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
   * Only call this in non-dry-run mode.
   */
  async applyPatch(patch: PatchProposal): Promise<{ branch: string; commit: string | null }> {
    const cwd = this.repoRoot;

    // 1. Create and checkout branch
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

    // 2. Write the patched file
    const fullPath = path.join(this.repoRoot, "repairable", patch.filePath);
    await fs.writeFile(fullPath, patch.proposedContent, "utf-8");

    // 3. Stage and commit
    let commit: string | null = null;
    try {
      await execFileAsync("git", ["add", fullPath], { cwd });
      await execFileAsync(
        "git",
        [
          "commit",
          "-m",
          `autoresearch: ${patch.hypothesis.label}\n\nFile: ${patch.filePath}\nExperiment: ${patch.branch}`,
        ],
        { cwd },
      );
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      commit = stdout.trim();
    } catch (err) {
      console.warn("Failed to commit patch:", err instanceof Error ? err.message : String(err));
    }

    return { branch: patch.branch, commit };
  }

  /**
   * Revert a patch: restore original content and switch back to main.
   */
  async revertPatch(patch: PatchProposal): Promise<void> {
    const cwd = this.repoRoot;
    const fullPath = path.join(this.repoRoot, "repairable", patch.filePath);

    // Restore original content
    await fs.writeFile(fullPath, patch.originalContent, "utf-8");

    // Stash any uncommitted/untracked changes before switching branches
    try {
      await execFileAsync("git", ["stash", "--include-untracked"], { cwd });
    } catch { /* nothing to stash */ }

    await execFileAsync("git", ["checkout", "main"], { cwd });

    // Drop the stash — we don't need the reverted changes
    try {
      await execFileAsync("git", ["stash", "drop"], { cwd });
    } catch { /* no stash to drop */ }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async loadManifest(): Promise<any> {
    const raw = await fs.readFile(this.manifestPath, "utf-8");
    return JSON.parse(raw);
  }

  private async generatePatchedContent(
    hypothesis: Hypothesis,
    originalContent: string,
    filePath: string,
  ): Promise<string> {
    const isJson = filePath.endsWith(".json");
    const isMd = filePath.endsWith(".md");

    const prompt = `You are editing a configuration file for a cancer information chatbot.

## File: ${filePath}
## File type: ${isJson ? "JSON config" : isMd ? "Markdown prompt" : "text"}

## Current content:
\`\`\`
${originalContent}
\`\`\`

## Hypothesis
- **Label**: ${hypothesis.label}
- **Root cause**: ${hypothesis.rootCause}
- **Intervention**: ${hypothesis.intervention}
- **Target section**: ${hypothesis.targetSection}

## Task
Apply the intervention described above to produce the updated file content.

CONSTRAINTS:
- Return ONLY the complete updated file content, nothing else
- Do NOT add comments explaining your changes
- Do NOT wrap the output in markdown code blocks
- Preserve the file format exactly (${isJson ? "valid JSON" : isMd ? "valid Markdown" : "original format"})
- Make MINIMAL changes — only what the intervention requires
- NEVER remove safety guardrails, disclaimers, or citation requirements
- NEVER weaken existing safety language (e.g., "you must" -> "you should")
- Preserve all existing sections/keys not targeted by the intervention`;

    const response = await retryableCompletion(
      this.llmClient,
      {
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are a precise file editor. Output only the complete updated file content with no wrapping, no explanation, no code blocks.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 8000,
      },
      { label: `patcher:${path.basename(filePath)}` },
    );

    let content = response.choices[0]?.message?.content || "";

    // Strip any accidental code blocks
    const codeBlockMatch = content.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```\s*$/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1];
    }

    return content.trim();
  }

  private validateSyntax(
    filePath: string,
    content: string,
  ): { syntaxValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (filePath.endsWith(".json")) {
      try {
        JSON.parse(content);
      } catch (err: any) {
        errors.push(`Invalid JSON: ${err.message}`);
      }
    }

    if (filePath.endsWith(".md")) {
      // Basic markdown validation: check for unbalanced code blocks
      const codeBlockCount = (content.match(/```/g) || []).length;
      if (codeBlockCount % 2 !== 0) {
        errors.push("Unbalanced code blocks in Markdown");
      }
      // Check the file is not empty
      if (content.trim().length < 50) {
        errors.push("Markdown content suspiciously short (< 50 chars)");
      }
    }

    return { syntaxValid: errors.length === 0, errors };
  }

  private generateDiff(original: string, proposed: string): string {
    const origLines = original.split("\n");
    const propLines = proposed.split("\n");

    const diffLines: string[] = [];
    const maxLen = Math.max(origLines.length, propLines.length);

    // Simple line-by-line diff (not a real unified diff, but good enough for logging)
    let contextBefore = 0;
    for (let i = 0; i < maxLen; i++) {
      const origLine = origLines[i];
      const propLine = propLines[i];

      if (origLine === propLine) {
        contextBefore++;
        continue;
      }

      // Show context
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
