/**
 * Runner-lane classification for eval case files (issues #71, #89).
 *
 * A case file is only coverage if some runner can execute it. Until now that
 * was decided in two places — `scripts/case-schema.test.ts` had its own copy of
 * the lane rules, and `scripts/case-manifest.ts` had none at all and counted
 * every case it could parse. That is how `cases/tier1/phase2_journeys.yaml`
 * (9 cases, in a bespoke schema no runner reads) came to be counted inside a
 * headline of 601 when only 592 can run.
 *
 * The lane rules live here, once, so the manifest and the lane guard cannot
 * disagree about what "executable" means.
 *
 * Lanes
 * -----
 *  - "gold"     : `user_messages: string[]` — read by `runner/evaluator.ts`
 *                 (`executeConversation(sessionId, testCase.user_messages, …)`).
 *  - "voice"    : `voice_input: string` — read by `runner/voice-transcript-eval.ts`.
 *  - "voice-e2e": `expectedTranscript: string` — synthetic voice cases.
 *  - "orphan"   : none of the above. No runner reads it; it is NOT coverage.
 *
 * A lane is a statement about the *schema*, not about whether a case would
 * pass. Nothing here reads, weighs or rewrites an expectation.
 *
 * Second blocker: the rubric
 * --------------------------
 * A readable schema is necessary but not sufficient. `runner/evaluator.ts` does
 *
 *     const rubric = this.getRubric(testCase.intent);
 *     if (!rubric) throw new Error(`No rubric found for intent: ...`);
 *
 * and `getRubric` is a plain lookup in `rubrics.v1.json` — the intent filter is
 * canonicalised (`utils/canonicalize.ts`) but the rubric lookup is NOT. So a
 * gold-lane case naming an intent the pack does not define aborts before any
 * scoring. That is the same defect as the journeys' missing PERSONAL_SYMPTOMS /
 * EMERGENCY rubrics, just in files that otherwise look runnable, so both
 * blockers are counted here rather than only the one issue #89 opened on.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export type Lane = "gold" | "voice" | "voice-e2e" | "orphan";

/** A lane whose runner exists. Everything else is not executable. */
export const EXECUTABLE_LANES: ReadonlySet<Lane> = new Set<Lane>([
  "gold",
  "voice",
  "voice-e2e",
]);

/**
 * Case files known to be unrunnable, with the issue tracking the port.
 *
 * Adding an entry is a deliberate, reviewable act: it does not make the file
 * run, it records that we know it does not. `case-schema.test.ts` fails if an
 * entry goes stale (the file was ported) or if a new orphan appears without one.
 */
export const KNOWN_UNRUNNABLE: Record<string, string> = {
  "tier1/phase2_journeys.yaml":
    "issues #71, #89 — bespoke userText/expectedBehavior schema; also uses PERSONAL_SYMPTOMS/EMERGENCY intents that rubrics.v1.json does not define. Porting requires SCCF review of the intent mapping and pass criteria (AGENTS.md §1.3).",
};

/** Classify one case object by the runner that would consume it. */
export function laneOf(testCase: Record<string, unknown>): Lane {
  if (Array.isArray(testCase.user_messages)) return "gold";
  if (typeof testCase.voice_input === "string") return "voice";
  if (typeof testCase.expectedTranscript === "string") return "voice-e2e";
  return "orphan";
}

export function isExecutableLane(lane: Lane): boolean {
  return EXECUTABLE_LANES.has(lane);
}

/** Why a case cannot be executed. */
export type Blocker = "orphan-schema" | "missing-rubric";

export interface FileLanes {
  /** Number of cases in the file. */
  count: number;
  /** Every distinct lane present in the file, sorted for stable output. */
  lanes: Lane[];
  /** Cases in this file a runner can actually execute. */
  executableCases: number;
  /** Case counts per blocker, present only when non-zero. */
  blockers?: Partial<Record<Blocker, number>>;
  /** True when every case in the file is executable. */
  executable: boolean;
}

/**
 * Intents defined by the rubric pack. Read once and passed in, so this module
 * stays a pure classifier with no opinion about where rubrics live.
 */
export function loadRubricIntents(rubricsPath: string): Set<string> {
  const pack = JSON.parse(fs.readFileSync(rubricsPath, "utf-8"));
  return new Set(Object.keys(pack?.rubrics ?? {}));
}

export const DEFAULT_RUBRICS_PATH = path.join(
  __dirname,
  "..",
  "rubrics",
  "rubrics.v1.json",
);

/**
 * The blocker stopping a case from executing, or null if nothing does.
 *
 * `rubricIntents` is optional: when it is not supplied only the schema gate is
 * applied, which is what a caller inspecting an arbitrary fixture directory
 * wants.
 */
export function blockerFor(
  testCase: Record<string, unknown>,
  rubricIntents?: ReadonlySet<string>,
): Blocker | null {
  const lane = laneOf(testCase);
  if (!isExecutableLane(lane)) return "orphan-schema";
  // Only the gold lane goes through `Evaluator.getRubric`; the voice lanes use
  // their own rubric pack and checks.
  if (lane === "gold" && rubricIntents && !rubricIntents.has(String(testCase.intent))) {
    return "missing-rubric";
  }
  return null;
}

function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.ya?ml$/i.test(entry.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Scan a cases directory and classify each suite file by lane.
 *
 * Files without a `cases:` array are skipped — templates and scratch YAML, the
 * same files the manifest scanner skips.
 */
export function scanLanes(
  casesDir: string,
  rubricIntents?: ReadonlySet<string>,
): Record<string, FileLanes> {
  const result: Record<string, FileLanes> = {};
  for (const file of listYamlFiles(casesDir)) {
    let parsed: any;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf-8"));
    } catch (err: any) {
      throw new Error(`Failed to parse ${file}: ${err.message}`);
    }
    if (!parsed || !Array.isArray(parsed.cases)) continue;

    const cases: Record<string, unknown>[] = (parsed.cases as unknown[]).filter(
      (c): c is Record<string, unknown> => !!c && typeof c === "object",
    );
    const lanes: Lane[] = [...new Set(cases.map(laneOf))].sort();

    const blockers: Partial<Record<Blocker, number>> = {};
    let executableCases = 0;
    for (const c of cases) {
      const blocker = blockerFor(c, rubricIntents);
      if (blocker) blockers[blocker] = (blockers[blocker] ?? 0) + 1;
      else executableCases++;
    }

    const rel = path.relative(casesDir, file).split(path.sep).join("/");
    result[rel] = {
      count: cases.length,
      lanes,
      executableCases,
      ...(Object.keys(blockers).length > 0 && { blockers }),
      executable: cases.length > 0 && executableCases === cases.length,
    };
  }
  return result;
}

export interface ExecutabilitySummary {
  /** Cases present in the suite — what the old headline counted. */
  total: number;
  /** Cases a runner can actually execute. */
  executable: number;
  /** Cases present but executed by nothing. */
  unexecutable: number;
  /** `unexecutable` broken down by cause. */
  blockers: Partial<Record<Blocker, number>>;
  /** Files containing at least one unexecutable case, sorted. */
  unexecutableFiles: string[];
}

export function summariseExecutability(
  lanes: Record<string, FileLanes>,
): ExecutabilitySummary {
  let total = 0;
  let executable = 0;
  const blockers: Partial<Record<Blocker, number>> = {};
  const unexecutableFiles: string[] = [];
  for (const [file, entry] of Object.entries(lanes)) {
    total += entry.count;
    executable += entry.executableCases;
    for (const [blocker, n] of Object.entries(entry.blockers ?? {})) {
      blockers[blocker as Blocker] = (blockers[blocker as Blocker] ?? 0) + n;
    }
    if (entry.executableCases < entry.count) unexecutableFiles.push(file);
  }
  return {
    total,
    executable,
    unexecutable: total - executable,
    blockers,
    unexecutableFiles: unexecutableFiles.sort(),
  };
}
