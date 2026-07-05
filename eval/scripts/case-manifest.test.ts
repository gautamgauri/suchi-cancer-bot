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
