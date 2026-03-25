import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { QualityLoopState } from "./types";

const execFileAsync = promisify(execFile);

// ── Build the structured prompt for Claude Code ──────────────────────────────

function buildFixPrompt(state: QualityLoopState): string {
  const plan = state.repairPlan!;
  const cluster = plan.targetCluster;

  const filesSection = plan.estimatedFiles.map((f) => `- ${f}`).join("\n");

  const actionsSection = plan.actions
    .map((a) => `${a.priority}. [${a.effortEstimate}] ${a.action}\n   Expected impact: ${a.expectedImpact}`)
    .join("\n");

  const constraintsSection = plan.constraints.map((c) => `- ${c}`).join("\n");

  return `# Quality Loop Fix: ${state.loopId}

## Target Failure
- **Code**: ${cluster.code}
- **Severity**: ${cluster.severity}
- **Description**: ${cluster.sampleReason}
- **Affected cases**: ${cluster.affectedCaseIds.join(", ")}

## Scope
${plan.scope}

## Files to modify (ONLY these files)
${filesSection}

## Actions
${actionsSection}

## CONSTRAINTS (MUST follow)
${constraintsSection}
- ONLY modify files listed above
- Do NOT add API endpoints or modify controllers
- Do NOT change database schema or migrations
- Do NOT change test cases, rubrics, or eval code
- Do NOT weaken safety guardrails or remove disclaimers
- Changes must be MINIMUM needed for the identified failure cluster
- Do NOT refactor unrelated code
- Commit all changes when done with message: "fix(quality-loop): ${cluster.code} — ${state.loopId}"
`;
}

// ── Apply fix via Claude Code CLI ────────────────────────────────────────────

export async function applyFix(state: QualityLoopState): Promise<{
  branch: string;
  commit?: string;
}> {
  const branchName = `quality-loop/${state.loopId}`;

  // 1. Create and checkout branch
  try {
    await execFileAsync("git", ["checkout", "-b", branchName]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("already exists")) {
      await execFileAsync("git", ["checkout", branchName]);
    } else {
      throw err;
    }
  }

  // 2. Write prompt to temp file
  const promptPath = join(tmpdir(), `quality-loop-prompt-${state.loopId}.md`);
  await writeFile(promptPath, buildFixPrompt(state), "utf-8");

  // 3. Check if claude CLI is available
  let claudeAvailable = false;
  try {
    await execFileAsync("which", ["claude"]);
    claudeAvailable = true;
  } catch {
    // claude CLI not available
  }

  if (!claudeAvailable) {
    console.log("\n=== Claude Code CLI not available ===");
    console.log("Fix prompt written to:", promptPath);
    console.log("Please apply the fix manually, then resume:");
    console.log(`  cd eval && npx ts-node cli.ts loop --resume ${state.loopId} --approve`);
    console.log("\nPrompt contents:\n");
    console.log(buildFixPrompt(state));

    return { branch: branchName };
  }

  // 4. Invoke claude --print with the prompt
  console.log("Invoking Claude Code to apply fix...");
  try {
    const { stdout, stderr } = await execFileAsync(
      "claude",
      ["--print", "--stdin"],
      {
        timeout: 5 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: process.cwd(),
        env: { ...process.env },
      },
    );

    if (stderr) console.warn("Claude Code stderr:", stderr.slice(0, 500));
    if (stdout) console.log("Claude Code output:", stdout.slice(0, 2000));
  } catch (err) {
    console.warn("Claude Code invocation failed:", err instanceof Error ? err.message : String(err));
    console.log("Fix prompt available at:", promptPath);
    console.log("Please apply the fix manually.");
    return { branch: branchName };
  }

  // 5. Clean up temp file
  await unlink(promptPath).catch(() => {});

  // 6. Get the latest commit hash if changes were committed
  let commit: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    commit = stdout.trim();
  } catch {
    // no commit
  }

  return { branch: branchName, commit };
}
