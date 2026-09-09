/**
 * Unit tests for the test-case disappearance guard (issue #48, Part 3).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  scanCases,
  buildManifest,
  checkManifest,
  updateManifest,
  runCli,
} from "./case-manifest";
import { scanLanes, summariseExecutability } from "./case-lanes";

let tmpDir: string;

const SUITE_A = `cases:
  - id: CASE-A-01
    tier: 1
    cancer: breast
    intent: INFORMATIONAL_GENERAL
    user_messages: ["q1"]
    expectations: {}
  - id: CASE-A-02
    tier: 1
    cancer: lung
    intent: INFORMATIONAL_GENERAL
    user_messages: ["q2"]
    expectations: {}
`;

const SUITE_B = `cases:
  - id: CASE-B-01
    tier: 1
    cancer: cervical
    intent: RED_FLAG_URGENT
    user_messages: ["q3"]
    expectations: {}
`;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-manifest-test-"));
  fs.mkdirSync(path.join(tmpDir, "tier1"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "tier1", "suite_a.yaml"), SUITE_A);
  fs.writeFileSync(path.join(tmpDir, "suite_b.yaml"), SUITE_B);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scanCases", () => {
  it("finds all case IDs across nested YAML suites", () => {
    const scanned = scanCases(tmpDir);
    expect(scanned["tier1/suite_a.yaml"]).toEqual(["CASE-A-01", "CASE-A-02"]);
    expect(scanned["suite_b.yaml"]).toEqual(["CASE-B-01"]);
  });

  it("skips YAML files without a cases array", () => {
    fs.writeFileSync(path.join(tmpDir, "not_a_suite.yaml"), "foo: bar\n");
    const scanned = scanCases(tmpDir);
    expect(scanned["not_a_suite.yaml"]).toBeUndefined();
  });
});

describe("checkManifest", () => {
  it("passes when nothing changed", () => {
    const scanned = scanCases(tmpDir);
    const manifest = buildManifest(scanned);
    const result = checkManifest(manifest, scanned);
    expect(result.ok).toBe(true);
    expect(result.scannedCases).toBe(3);
  });

  it("fails loudly when a case disappears without a tombstone", () => {
    const manifest = buildManifest(scanCases(tmpDir));
    fs.writeFileSync(path.join(tmpDir, "tier1", "suite_a.yaml"), SUITE_A.split("  - id: CASE-A-02")[0]);
    const result = checkManifest(manifest, scanCases(tmpDir));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("CASE-A-02");
    expect(result.errors.join("\n")).toContain("tombstone");
  });

  it("fails loudly when a whole case file is deleted", () => {
    const manifest = buildManifest(scanCases(tmpDir));
    fs.rmSync(path.join(tmpDir, "suite_b.yaml"));
    const result = checkManifest(manifest, scanCases(tmpDir));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("suite_b.yaml");
    expect(result.errors.join("\n")).toContain("MISSING");
  });

  it("accepts a removal that has an explicit tombstone", () => {
    const manifest = buildManifest(scanCases(tmpDir), [
      { caseId: "CASE-B-01", file: "suite_b.yaml", removedAt: "2026-07-05", reason: "superseded" },
    ]);
    fs.rmSync(path.join(tmpDir, "suite_b.yaml"));
    const result = checkManifest(manifest, scanCases(tmpDir));
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("tombstoned");
  });

  it("fails when new cases are not registered in the manifest", () => {
    const manifest = buildManifest(scanCases(tmpDir));
    fs.appendFileSync(
      path.join(tmpDir, "suite_b.yaml"),
      `  - id: CASE-B-02\n    tier: 1\n    cancer: oral\n    intent: INFORMATIONAL_GENERAL\n    user_messages: ["q4"]\n    expectations: {}\n`
    );
    const result = checkManifest(manifest, scanCases(tmpDir));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("CASE-B-02");
  });
});

describe("updateManifest", () => {
  it("refuses to drop cases silently", () => {
    const previous = buildManifest(scanCases(tmpDir));
    fs.rmSync(path.join(tmpDir, "suite_b.yaml"));
    expect(() => updateManifest(previous, scanCases(tmpDir))).toThrow(/tombstone/i);
  });

  it("records removals with tombstones (reason required)", () => {
    const previous = buildManifest(scanCases(tmpDir));
    fs.rmSync(path.join(tmpDir, "suite_b.yaml"));

    expect(() =>
      updateManifest(previous, scanCases(tmpDir), [{ caseId: "CASE-B-01", reason: "" }])
    ).toThrow(/reason/i);

    const updated = updateManifest(previous, scanCases(tmpDir), [
      { caseId: "CASE-B-01", reason: "superseded by GOLD-RAG-07" },
    ]);
    expect(updated.totalCases).toBe(2);
    expect(updated.tombstones).toHaveLength(1);
    expect(updated.tombstones[0]).toMatchObject({
      caseId: "CASE-B-01",
      file: "suite_b.yaml",
      reason: "superseded by GOLD-RAG-07",
    });
  });

  it("rejects tombstones for cases that still exist", () => {
    const previous = buildManifest(scanCases(tmpDir));
    expect(() =>
      updateManifest(previous, scanCases(tmpDir), [{ caseId: "CASE-A-01", reason: "nope" }])
    ).toThrow(/still exists/i);
  });

  it("clears a tombstone when the case reappears", () => {
    const previous = buildManifest(scanCases(tmpDir), [
      { caseId: "CASE-A-01", file: "tier1/suite_a.yaml", removedAt: "2026-01-01", reason: "old" },
    ]);
    const updated = updateManifest(previous, scanCases(tmpDir));
    expect(updated.tombstones).toHaveLength(0);
  });
});

describe("runCli", () => {
  it("check fails with exit code 1 when the manifest is missing", () => {
    expect(runCli(["check", "--cases-dir", tmpDir])).toBe(1);
  });

  it("update then check round-trips, and a silent deletion is caught", () => {
    expect(runCli(["update", "--cases-dir", tmpDir])).toBe(0);
    expect(runCli(["check", "--cases-dir", tmpDir])).toBe(0);

    fs.rmSync(path.join(tmpDir, "suite_b.yaml"));
    expect(runCli(["check", "--cases-dir", tmpDir])).toBe(1);

    expect(
      runCli([
        "update",
        "--cases-dir",
        tmpDir,
        "--tombstone",
        "CASE-B-01",
        "--reason",
        "test removal",
      ])
    ).toBe(0);
    expect(runCli(["check", "--cases-dir", tmpDir])).toBe(0);
  });
});

/**
 * Issue #89 — the manifest counted every case it could PARSE, which is not the
 * same as every case a runner can EXECUTE. `tier1/phase2_journeys.yaml` is 9
 * cases in a schema no runner reads, and the headline said 601.
 *
 * A file is "orphan" when it has none of `user_messages` / `voice_input` /
 * `expectedTranscript` — the three shapes the runners consume.
 */
describe("executability tracking (#89)", () => {
  /** Same shape as phase2_journeys.yaml: no field any runner reads. */
  const ORPHAN_SUITE = `cases:
  - id: CASE-ORPHAN-01
    userText: "a question"
    expectedBehavior:
      mustContain: ["doctor"]
  - id: CASE-ORPHAN-02
    userText: "another question"
    expectedBehavior:
      mustContain: ["doctor"]
`;

  function writeOrphanSuite() {
    fs.writeFileSync(path.join(tmpDir, "tier1", "orphan_suite.yaml"), ORPHAN_SUITE);
  }

  it("classifies runnable and orphan suites, and counts them apart", () => {
    writeOrphanSuite();
    const lanes = scanLanes(tmpDir);

    expect(lanes["tier1/suite_a.yaml"]).toEqual({
      count: 2,
      lanes: ["gold"],
      executableCases: 2,
      executable: true,
    });
    expect(lanes["tier1/orphan_suite.yaml"]).toEqual({
      count: 2,
      lanes: ["orphan"],
      executableCases: 0,
      blockers: { "orphan-schema": 2 },
      executable: false,
    });

    expect(summariseExecutability(lanes)).toEqual({
      total: 5,
      executable: 3,
      unexecutable: 2,
      blockers: { "orphan-schema": 2 },
      unexecutableFiles: ["tier1/orphan_suite.yaml"],
    });
  });

  it("counts a gold case whose intent has no rubric as NOT executable", () => {
    // `Evaluator.getRubric` is a plain lookup and throws when the intent is
    // absent, so a readable schema alone is not enough to make a case run.
    // The rubric lookup is not canonicalised, so RED_FLAGS_URGENT (plural) is
    // a different, undefined intent from RED_FLAG_URGENT.
    const rubricIntents = new Set(["INFORMATIONAL_GENERAL"]);
    const lanes = scanLanes(tmpDir, rubricIntents);

    expect(lanes["tier1/suite_a.yaml"].executableCases).toBe(2); // both INFORMATIONAL_GENERAL
    expect(lanes["suite_b.yaml"]).toMatchObject({
      count: 1,
      lanes: ["gold"], // schema is fine …
      executableCases: 0, // … but RED_FLAG_URGENT has no rubric here
      blockers: { "missing-rubric": 1 },
      executable: false,
    });

    const summary = summariseExecutability(lanes);
    expect(summary.executable).toBe(2);
    expect(summary.blockers).toEqual({ "missing-rubric": 1 });
  });

  it("counts a file with a mix of blocked and runnable cases per case, not per file", () => {
    fs.writeFileSync(
      path.join(tmpDir, "tier1", "suite_a.yaml"),
      SUITE_A + `  - id: CASE-A-03
    tier: 1
    cancer: oral
    intent: NO_SUCH_INTENT
    user_messages: ["q4"]
    expectations: {}
`,
    );
    const lanes = scanLanes(tmpDir, new Set(["INFORMATIONAL_GENERAL", "RED_FLAG_URGENT"]));

    // The file is not executable as a whole, but 2 of its 3 cases still are —
    // marking all 3 unexecutable would understate coverage as badly as the old
    // count overstated it.
    expect(lanes["tier1/suite_a.yaml"]).toMatchObject({
      count: 3,
      executableCases: 2,
      executable: false,
      blockers: { "missing-rubric": 1 },
    });
    expect(summariseExecutability(lanes).executable).toBe(3);
  });

  it("records both counts in the manifest, not just the present count", () => {
    writeOrphanSuite();
    const manifest = buildManifest(scanCases(tmpDir), [], scanLanes(tmpDir));

    expect(manifest.version).toBe(2);
    expect(manifest.totalCases).toBe(5);
    expect(manifest.executableCases).toBe(3);
    expect(manifest.unexecutableCases).toBe(2);
    expect(manifest.files["tier1/orphan_suite.yaml"].executable).toBe(false);
    expect(manifest.files["tier1/suite_a.yaml"].executable).toBe(true);
  });

  it("fails the check when a suite silently stops being executable", () => {
    // The regression this guard exists for: a suite is edited into a schema no
    // runner reads. Case IDs all still present, so every pre-#89 check passes
    // and the headline count does not move — while real coverage drops.
    const scanned = scanCases(tmpDir);
    const manifest = buildManifest(scanned, [], scanLanes(tmpDir));
    expect(manifest.executableCases).toBe(3);

    fs.writeFileSync(
      path.join(tmpDir, "tier1", "suite_a.yaml"),
      SUITE_A.replace(/user_messages: \["q\d"\]/g, 'userText: "q"'),
    );

    const after = checkManifest(manifest, scanCases(tmpDir), scanLanes(tmpDir));

    expect(after.ok).toBe(false);
    expect(after.errors.join("\n")).toMatch(/changed executability/);
    expect(after.errors.join("\n")).toMatch(/Executable case count changed/);
  });

  it("fails the check when an orphan suite is ported, so the gain is recorded", () => {
    writeOrphanSuite();
    const manifest = buildManifest(scanCases(tmpDir), [], scanLanes(tmpDir));

    // The port that issue #89 asks for, once SCCF has approved the criteria.
    fs.writeFileSync(
      path.join(tmpDir, "tier1", "orphan_suite.yaml"),
      ORPHAN_SUITE.replace(/userText: "([^"]+)"/g, 'user_messages: ["$1"]'),
    );

    const after = checkManifest(manifest, scanCases(tmpDir), scanLanes(tmpDir));

    expect(after.ok).toBe(false);
    expect(after.executableCases).toBe(5);
  });

  it("warns, without failing, that a known-orphan file is not coverage", () => {
    writeOrphanSuite();
    const lanes = scanLanes(tmpDir);
    const manifest = buildManifest(scanCases(tmpDir), [], lanes);

    const result = checkManifest(manifest, scanCases(tmpDir), lanes);

    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toMatch(
      /"tier1\/orphan_suite\.yaml": 2 of 2 cases are counted but cannot be executed \(2 orphan-schema\)/,
    );
  });

  it("warns when a pre-#89 manifest cannot say how many cases run", () => {
    const scanned = scanCases(tmpDir);
    const v1 = buildManifest(scanned); // no lanes — the old shape
    expect(v1.version).toBe(1);
    expect(v1.executableCases).toBeUndefined();

    const result = checkManifest(v1, scanned, scanLanes(tmpDir));

    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toMatch(/predates executability tracking/);
  });

  it("keeps working for callers that pass no lanes at all", () => {
    const scanned = scanCases(tmpDir);
    const result = checkManifest(buildManifest(scanned), scanned);

    expect(result.ok).toBe(true);
    expect(result.executableCases).toBeUndefined();
  });
});
