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
 * The lane rules themselves live in `scripts/case-lanes.ts` (issue #89) so that
 * this guard and the case manifest cannot disagree about what "executable"
 * means. This file asserts the repository's current state against them.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  DEFAULT_RUBRICS_PATH,
  KNOWN_UNRUNNABLE,
  loadRubricIntents,
  scanLanes,
  summariseExecutability,
} from "./case-lanes";
import { CaseManifest, manifestPathFor } from "./case-manifest";

const CASES_DIR = path.join(__dirname, "..", "cases");
const RUBRIC_INTENTS = loadRubricIntents(DEFAULT_RUBRICS_PATH);

describe("eval case files are claimed by a runner lane", () => {
  const lanes = scanLanes(CASES_DIR, RUBRIC_INTENTS);
  const entries = Object.entries(lanes);

  it("finds case files to classify", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("has no case file in an unreadable schema except the recorded ones", () => {
    const orphans = entries
      .filter(([, f]) => f.lanes.includes("orphan"))
      .map(([relPath]) => relPath);

    const unexpected = orphans.filter((p) => !(p in KNOWN_UNRUNNABLE));

    expect(unexpected).toEqual([]);
  });

  it("keeps the recorded unrunnable list honest (no stale entries)", () => {
    // If a quarantined file is ported to a runnable schema, this fails so the
    // entry gets removed rather than lingering as a permanent excuse.
    const orphans = new Set(
      entries
        .filter(([, f]) => f.lanes.includes("orphan"))
        .map(([relPath]) => relPath),
    );

    const stale = Object.keys(KNOWN_UNRUNNABLE).filter((p) => !orphans.has(p));

    expect(stale).toEqual([]);
  });

  it("reports how many suite cases are actually executable", () => {
    const summary = summariseExecutability(lanes);

    // Pins the gap between "cases in the suite" and "cases a runner can
    // execute". If any number moves, this test forces the change to be
    // acknowledged instead of quietly re-inflating the coverage headline.
    //
    // 603 present / 574 executable / 29 blocked, in two kinds:
    //   - 9  orphan-schema   — tier1/phase2_journeys.yaml (issue #89)
    //   - 20 missing-rubric  — gold-lane cases naming an intent
    //                          rubrics.v1.json does not define, so
    //                          `Evaluator.getRubric` throws before scoring.
    //     Found while fixing #89; NOT fixed here, because both candidate fixes
    //     (adding rubrics, or re-pointing a case at a different intent) change
    //     what those cases assert — SCCF review, per AGENTS.md §1.3.
    //
    // 2026-09-08: +2 (HN-DARBHANGA-01/02, issue #95) in the runnable gold lane,
    // so total 601→603 and executable 572→574; the blocker counts are unchanged
    // because both new cases reuse an intent that rubrics.v1.json defines.
    expect({
      total: summary.total,
      runnable: summary.executable,
      unrunnable: summary.unexecutable,
      blockers: summary.blockers,
    }).toEqual({
      total: 603,
      runnable: 574,
      unrunnable: 29,
      blockers: { "orphan-schema": 9, "missing-rubric": 20 },
    });
  });

  it("names the intents that have no rubric, so the list cannot grow silently", () => {
    // Every distinct intent used by a gold-lane case must resolve, or be listed
    // here. A new unmapped intent fails this test rather than surfacing as a
    // mid-run crash.
    const unmapped = new Set<string>();
    for (const file of Object.keys(lanes)) {
      const parsed: any = yaml.load(
        fs.readFileSync(path.join(CASES_DIR, file), "utf-8"),
      );
      for (const c of parsed.cases ?? []) {
        if (!Array.isArray(c?.user_messages)) continue;
        if (!RUBRIC_INTENTS.has(String(c.intent))) unmapped.add(String(c.intent));
      }
    }

    expect([...unmapped].sort()).toEqual([
      "EMOTIONAL_SUPPORT",
      "NAVIGATION",
      "OUT_OF_SCOPE",
      "RED_FLAGS_URGENT",
      "SIDE_EFFECTS_GENERAL",
    ]);
  });
});

/**
 * Issue #89: the manifest is the artefact people quote. Before this change it
 * carried one number — 601 — and no way to tell that 29 of those cases run
 * nowhere. These tests hold the manifest ON DISK to the same truth as the scan,
 * so the committed inventory cannot drift from what the runners can do.
 */
describe("the committed manifest tells the truth about executability", () => {
  const manifest: CaseManifest = JSON.parse(
    fs.readFileSync(manifestPathFor(CASES_DIR), "utf-8"),
  );
  const lanes = scanLanes(CASES_DIR, RUBRIC_INTENTS);
  const summary = summariseExecutability(lanes);

  it("records the executable count, not just the present count", () => {
    expect(manifest.totalCases).toBe(summary.total);
    expect(manifest.executableCases).toBe(summary.executable);
    expect(manifest.unexecutableCases).toBe(summary.unexecutable);
    expect(manifest.blockers).toEqual(summary.blockers);
  });

  it("marks every file with its lanes and executable case count", () => {
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(lanes[file]).toBeDefined();
      expect(entry.lanes).toEqual(lanes[file].lanes);
      expect(entry.executableCases).toBe(lanes[file].executableCases);
      expect(entry.executable).toBe(lanes[file].executable);
    }
  });

  it("records WHY the known-unrunnable file is not executable", () => {
    for (const file of Object.keys(KNOWN_UNRUNNABLE)) {
      const entry = manifest.files[file];
      expect(entry).toBeDefined();
      expect(entry.executable).toBe(false);
      expect(entry.unexecutableReason).toBe(KNOWN_UNRUNNABLE[file]);
    }
  });

  it("still counts the quarantined journey cases as present, not deleted", () => {
    // The 9 journeys are not coverage, but they are also not gone: their
    // clinical expectations are preserved verbatim for whoever ports them.
    const entry = manifest.files["tier1/phase2_journeys.yaml"];
    expect(entry.count).toBe(9);
    expect(entry.caseIds).toHaveLength(9);
  });
});
