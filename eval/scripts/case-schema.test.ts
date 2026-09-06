/**
 * Case-file lane guard (issue #71).
 *
 * The case-manifest guard (`scripts/case-manifest.ts`) protects case IDs from
 * disappearing. It does NOT check that a case can actually be executed, so a
 * file whose schema no runner reads still contributes to the headline case
 * count and reads as coverage. `cases/tier1/phase2_journeys.yaml` is exactly
 * that: 9 cases, counted in the 601, executed by nothing.
 *
 * This test classifies every case file by the runner lane that consumes it, and
 * fails when a NEW file arrives in a schema no runner reads. It deliberately
 * does not "fix" the existing orphan by deleting or silently excusing it —
 * the orphan is listed by name, with its issue, so it stays visible until it is
 * either ported to a runnable schema or removed with a tombstone.
 *
 * Lanes
 * -----
 *  - "gold"  : `user_messages: string[]` — read by `runner/evaluator.ts`
 *              (`executeConversation(sessionId, testCase.user_messages, ...)`).
 *  - "voice" : `voice_input: string` — read by `runner/voice-transcript-eval.ts`.
 *  - "voice-e2e": `expectedTranscript` — synthetic voice cases.
 *  - "orphan": none of the above; no runner reads it.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const CASES_DIR = path.join(__dirname, "..", "cases");

/**
 * Case files that are known to be unrunnable, with the issue tracking the port.
 * Adding an entry here is a deliberate, reviewable act — it does not make the
 * file run, it only records that we know it does not.
 */
const KNOWN_UNRUNNABLE: Record<string, string> = {
  "tier1/phase2_journeys.yaml":
    "issue #71 — bespoke userText/expectedBehavior schema; also uses PERSONAL_SYMPTOMS/EMERGENCY intents that rubrics.v1.json does not define",
};

type Lane = "gold" | "voice" | "voice-e2e" | "orphan";

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

function laneOf(testCase: Record<string, unknown>): Lane {
  if (Array.isArray(testCase.user_messages)) return "gold";
  if (typeof testCase.voice_input === "string") return "voice";
  if (typeof testCase.expectedTranscript === "string") return "voice-e2e";
  return "orphan";
}

interface FileClassification {
  relPath: string;
  count: number;
  lanes: Set<Lane>;
}

function classifyCaseFiles(): FileClassification[] {
  const out: FileClassification[] = [];
  for (const file of listYamlFiles(CASES_DIR)) {
    const parsed = yaml.load(fs.readFileSync(file, "utf-8")) as {
      cases?: unknown;
    };
    // Files without a `cases:` array are templates/scratch — the manifest
    // guard skips them too.
    if (!parsed || !Array.isArray(parsed.cases)) continue;

    const cases = parsed.cases.filter(
      (c): c is Record<string, unknown> => !!c && typeof c === "object",
    );
    out.push({
      relPath: path.relative(CASES_DIR, file).split(path.sep).join("/"),
      count: cases.length,
      lanes: new Set(cases.map(laneOf)),
    });
  }
  return out;
}

describe("eval case files are claimed by a runner lane", () => {
  const classified = classifyCaseFiles();

  it("finds case files to classify", () => {
    expect(classified.length).toBeGreaterThan(0);
  });

  it("has no case file in an unreadable schema except the recorded ones", () => {
    const orphans = classified
      .filter((f) => f.lanes.has("orphan"))
      .map((f) => f.relPath);

    const unexpected = orphans.filter((p) => !(p in KNOWN_UNRUNNABLE));

    expect(unexpected).toEqual([]);
  });

  it("keeps the recorded unrunnable list honest (no stale entries)", () => {
    // If a quarantined file is ported to a runnable schema, this fails so the
    // entry gets removed rather than lingering as a permanent excuse.
    const orphans = new Set(
      classified.filter((f) => f.lanes.has("orphan")).map((f) => f.relPath),
    );

    const stale = Object.keys(KNOWN_UNRUNNABLE).filter((p) => !orphans.has(p));

    expect(stale).toEqual([]);
  });

  it("reports how many manifest cases are actually executable", () => {
    const total = classified.reduce((n, f) => n + f.count, 0);
    const unrunnable = classified
      .filter((f) => f.relPath in KNOWN_UNRUNNABLE)
      .reduce((n, f) => n + f.count, 0);

    // Pins the gap between "cases in the manifest" and "cases a runner can
    // execute". If either number moves, this test forces the change to be
    // acknowledged instead of quietly re-inflating the coverage headline.
    expect({ total, unrunnable, runnable: total - unrunnable }).toEqual({
      total: 601,
      unrunnable: 9,
      runnable: 592,
    });
  });
});
