/**
 * Test-case disappearance guard (issue #48, Part 3)
 *
 * Eval cases are the regression memory of this project — they must not be
 * able to vanish silently. This script maintains eval/cases/case-manifest.json
 * (an inventory of every case ID in every YAML suite) and fails loudly when:
 *
 *   - a case file listed in the manifest is missing,
 *   - a case ID listed in the manifest is gone without a tombstone entry,
 *   - new cases/files exist that the manifest does not know about
 *     (forces a deliberate `--update` so the inventory stays current).
 *
 * Issue #89: the manifest also records which cases are EXECUTABLE. Counting a
 * file no runner reads is how `cases/tier1/phase2_journeys.yaml` (9 cases,
 * including caregiver-crisis and emergency journeys) sat inside a headline of
 * 601 while only 592 could run. The manifest now carries both numbers, and the
 * check fails if a file's executability changes without the inventory being
 * updated — so a port, or a regression into an unreadable schema, is a
 * deliberate act rather than a silent shift in the coverage headline.
 *
 * Removing a case requires an explicit tombstone:
 *
 *   npx ts-node scripts/case-manifest.ts update \
 *     --tombstone SUCHI-T1-FOO-01 --reason "superseded by GOLD-RAG-07"
 *
 * Usage:
 *   npx ts-node scripts/case-manifest.ts check
 *   npx ts-node scripts/case-manifest.ts update [--tombstone <id> --reason <text>]...
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  Blocker,
  DEFAULT_RUBRICS_PATH,
  FileLanes,
  KNOWN_UNRUNNABLE,
  Lane,
  loadRubricIntents,
  scanLanes,
  summariseExecutability,
} from "./case-lanes";

export interface Tombstone {
  caseId: string;
  file: string;
  removedAt: string;
  reason: string;
}

export interface ManifestFileEntry {
  count: number;
  caseIds: string[];
  /** Runner lanes present in the file (issue #89). Absent in v1 manifests. */
  lanes?: Lane[];
  /** Cases in this file a runner can execute. Absent in v1 manifests. */
  executableCases?: number;
  /** Unexecutable case counts by cause. Absent when there are none. */
  blockers?: Partial<Record<Blocker, number>>;
  /** Whether EVERY case in this file is executable. Absent in v1 manifests. */
  executable?: boolean;
  /** Why it cannot be executed, when that is recorded in `KNOWN_UNRUNNABLE`. */
  unexecutableReason?: string;
}

export interface CaseManifest {
  version: number;
  generatedAt: string;
  /** Cases PRESENT in the suite. Not the same thing as coverage. */
  totalCases: number;
  /** Cases a runner can execute (issue #89). Absent in v1 manifests. */
  executableCases?: number;
  /** Cases present but executed by nothing (issue #89). */
  unexecutableCases?: number;
  /** `unexecutableCases` broken down by cause. */
  blockers?: Partial<Record<Blocker, number>>;
  files: Record<string, ManifestFileEntry>;
  tombstones: Tombstone[];
}

export interface ManifestCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  scannedFiles: number;
  scannedCases: number;
  /** Cases a runner can execute in the current scan, when lanes were supplied. */
  executableCases?: number;
}

const MANIFEST_FILENAME = "case-manifest.json";

// ── Scanning ─────────────────────────────────────────────────────────────────

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
 * Scan a cases directory and return a map of relative file path ->
 * ordered list of case IDs. Files without a `cases:` array are skipped
 * (templates, scratch YAML).
 */
export function scanCases(casesDir: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const file of listYamlFiles(casesDir)) {
    let parsed: any;
    try {
      parsed = yaml.load(fs.readFileSync(file, "utf-8"));
    } catch (err: any) {
      throw new Error(`Failed to parse ${file}: ${err.message}`);
    }
    if (!parsed || !Array.isArray(parsed.cases)) continue;
    const rel = path.relative(casesDir, file).split(path.sep).join("/");
    result[rel] = parsed.cases
      .map((c: any) => String(c?.id ?? ""))
      .filter((id: string) => id.length > 0);
  }
  return result;
}

// ── Manifest build / check ───────────────────────────────────────────────────

/**
 * Build a manifest from a scan.
 *
 * `lanes` is optional so a caller that only cares about case IDs (the original
 * v1 behaviour) still works. When it is supplied the manifest records
 * executability per file and in the totals — that is the honest headline
 * issue #89 asks for.
 */
export function buildManifest(
  scanned: Record<string, string[]>,
  tombstones: Tombstone[] = [],
  lanes?: Record<string, FileLanes>
): CaseManifest {
  const files: CaseManifest["files"] = {};
  let total = 0;
  for (const [file, caseIds] of Object.entries(scanned).sort()) {
    const entry: ManifestFileEntry = { count: caseIds.length, caseIds };
    const laneInfo = lanes?.[file];
    if (laneInfo) {
      entry.lanes = laneInfo.lanes;
      entry.executableCases = laneInfo.executableCases;
      if (laneInfo.blockers) entry.blockers = laneInfo.blockers;
      entry.executable = laneInfo.executable;
      if (!laneInfo.executable && KNOWN_UNRUNNABLE[file]) {
        entry.unexecutableReason = KNOWN_UNRUNNABLE[file];
      }
    }
    files[file] = entry;
    total += caseIds.length;
  }

  const manifest: CaseManifest = {
    version: lanes ? 2 : 1,
    generatedAt: new Date().toISOString(),
    totalCases: total,
    files,
    tombstones,
  };

  if (lanes) {
    const summary = summariseExecutability(lanes);
    manifest.executableCases = summary.executable;
    manifest.unexecutableCases = summary.unexecutable;
    if (Object.keys(summary.blockers).length > 0) manifest.blockers = summary.blockers;
  }

  return manifest;
}

export function checkManifest(
  manifest: CaseManifest,
  scanned: Record<string, string[]>,
  lanes?: Record<string, FileLanes>
): ManifestCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tombstonedIds = new Set(manifest.tombstones.map((t) => t.caseId));

  // 1. Every manifested file and case must still exist (or be tombstoned).
  for (const [file, entry] of Object.entries(manifest.files)) {
    const scannedIds = scanned[file];
    if (scannedIds === undefined) {
      const untombstoned = entry.caseIds.filter((id) => !tombstonedIds.has(id));
      if (untombstoned.length > 0) {
        errors.push(
          `Case file "${file}" (${entry.count} cases) is MISSING and its cases have no tombstones: ${untombstoned.join(", ")}. ` +
            `Restore the file or add tombstones via: ts-node scripts/case-manifest.ts update --tombstone <id> --reason "<why>"`
        );
      } else {
        warnings.push(`Case file "${file}" removed; all its cases are tombstoned.`);
      }
      continue;
    }
    const scannedSet = new Set(scannedIds);
    for (const id of entry.caseIds) {
      if (!scannedSet.has(id) && !tombstonedIds.has(id)) {
        errors.push(
          `Case "${id}" disappeared from "${file}" without a tombstone. ` +
            `Restore it or record its removal via: ts-node scripts/case-manifest.ts update --tombstone ${id} --reason "<why>"`
        );
      }
    }
  }

  // 2. New files/cases must be registered (keeps the inventory honest).
  for (const [file, scannedIds] of Object.entries(scanned)) {
    const entry = manifest.files[file];
    if (!entry) {
      errors.push(
        `Case file "${file}" (${scannedIds.length} cases) is not in the manifest. Run: ts-node scripts/case-manifest.ts update`
      );
      continue;
    }
    const manifestSet = new Set(entry.caseIds);
    const newIds = scannedIds.filter((id) => !manifestSet.has(id));
    if (newIds.length > 0) {
      errors.push(
        `New cases in "${file}" not in the manifest: ${newIds.join(", ")}. Run: ts-node scripts/case-manifest.ts update`
      );
    }
  }

  // 3. A tombstoned case that reappears should drop its tombstone on next update.
  for (const t of manifest.tombstones) {
    if (scanned[t.file]?.includes(t.caseId)) {
      warnings.push(
        `Tombstoned case "${t.caseId}" is present again in "${t.file}" — run update to clear the tombstone.`
      );
    }
  }

  // 4. Executability must not drift (issue #89).
  //
  // A file that stops being executable silently shrinks real coverage while the
  // headline stays put; a file that BECOMES executable (a port landed) must
  // update the inventory so the number goes up on purpose. Either way the
  // change has to be acknowledged, which is the whole point of the guard.
  let executableCases: number | undefined;
  if (lanes) {
    const summary = summariseExecutability(lanes);
    executableCases = summary.executable;

    for (const [file, laneInfo] of Object.entries(lanes)) {
      const entry = manifest.files[file];
      // A file missing from the manifest is already reported by check 2.
      if (!entry || entry.executableCases === undefined) continue;
      if (entry.executableCases !== laneInfo.executableCases) {
        errors.push(
          `Case file "${file}" changed executability: manifest records ${entry.executableCases} of ${entry.count} executable, ` +
            `the scan finds ${laneInfo.executableCases} of ${laneInfo.count} (lanes: ${laneInfo.lanes.join(", ")}). ` +
            `Run: ts-node scripts/case-manifest.ts update`
        );
      }
    }

    if (
      manifest.executableCases !== undefined &&
      manifest.executableCases !== summary.executable
    ) {
      errors.push(
        `Executable case count changed: manifest records ${manifest.executableCases}, scan finds ${summary.executable} ` +
          `(of ${summary.total} present). Run: ts-node scripts/case-manifest.ts update`
      );
    }

    if (manifest.executableCases === undefined) {
      warnings.push(
        `Manifest predates executability tracking (issue #89) — it counts ${manifest.totalCases} cases but does not say how many run. ` +
          `Run: ts-node scripts/case-manifest.ts update`
      );
    }

    for (const file of summary.unexecutableFiles) {
      const info = lanes[file];
      const blocked = info.count - info.executableCases;
      const why = Object.entries(info.blockers ?? {})
        .map(([b, n]) => `${n} ${b}`)
        .join(", ");
      warnings.push(
        `Case file "${file}": ${blocked} of ${info.count} cases are counted but cannot be executed (${why})` +
          (KNOWN_UNRUNNABLE[file] ? ` — ${KNOWN_UNRUNNABLE[file]}` : "")
      );
    }
  }

  const scannedCases = Object.values(scanned).reduce((s, ids) => s + ids.length, 0);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    scannedFiles: Object.keys(scanned).length,
    scannedCases,
    ...(executableCases !== undefined && { executableCases }),
  };
}

/**
 * Update the manifest. Removals REQUIRE tombstones: any previously-manifested
 * case that is now missing and has neither an existing nor a newly-supplied
 * tombstone aborts the update.
 */
export function updateManifest(
  previous: CaseManifest | null,
  scanned: Record<string, string[]>,
  newTombstones: Array<{ caseId: string; reason: string }> = [],
  lanes?: Record<string, FileLanes>
): CaseManifest {
  const now = new Date().toISOString();
  const scannedIds = new Set(Object.values(scanned).flat());

  const previousTombstones = previous?.tombstones ?? [];
  const keptTombstones = previousTombstones.filter((t) => !scannedIds.has(t.caseId));

  const known = new Map<string, string>(); // caseId -> file (from previous manifest)
  for (const [file, entry] of Object.entries(previous?.files ?? {})) {
    for (const id of entry.caseIds) known.set(id, file);
  }

  const addedTombstones: Tombstone[] = [];
  for (const t of newTombstones) {
    if (scannedIds.has(t.caseId)) {
      throw new Error(
        `Cannot tombstone "${t.caseId}": the case still exists in the suite.`
      );
    }
    if (!t.reason || !t.reason.trim()) {
      throw new Error(`Tombstone for "${t.caseId}" requires a non-empty --reason.`);
    }
    addedTombstones.push({
      caseId: t.caseId,
      file: known.get(t.caseId) ?? "(unknown)",
      removedAt: now,
      reason: t.reason.trim(),
    });
  }

  const allTombstoneIds = new Set(
    [...keptTombstones, ...addedTombstones].map((t) => t.caseId)
  );

  // Refuse silent removals.
  const silentlyRemoved: string[] = [];
  for (const [id] of known) {
    if (!scannedIds.has(id) && !allTombstoneIds.has(id)) silentlyRemoved.push(id);
  }
  if (silentlyRemoved.length > 0) {
    throw new Error(
      `Refusing to update manifest: ${silentlyRemoved.length} case(s) were removed without tombstones: ` +
        `${silentlyRemoved.join(", ")}. Re-run with --tombstone <id> --reason "<why>" for each.`
    );
  }

  return buildManifest(scanned, [...keptTombstones, ...addedTombstones], lanes);
}

// ── File IO helpers ──────────────────────────────────────────────────────────

export function manifestPathFor(casesDir: string): string {
  return path.join(casesDir, MANIFEST_FILENAME);
}

export function loadManifest(casesDir: string): CaseManifest | null {
  const p = manifestPathFor(casesDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as CaseManifest;
}

export function saveManifest(casesDir: string, manifest: CaseManifest): void {
  fs.writeFileSync(
    manifestPathFor(casesDir),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8"
  );
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  command: string;
  casesDir: string;
  tombstones: Array<{ caseId: string; reason: string }>;
} {
  const command = argv[0] ?? "check";
  let casesDir = path.resolve(__dirname, "..", "cases");
  const tombstones: Array<{ caseId: string; reason: string }> = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--cases-dir") casesDir = path.resolve(argv[++i]);
    else if (argv[i] === "--tombstone") {
      const caseId = argv[++i];
      let reason = "";
      if (argv[i + 1] === "--reason") {
        i++;
        reason = argv[++i] ?? "";
      }
      tombstones.push({ caseId, reason });
    }
  }
  return { command, casesDir, tombstones };
}

export function runCli(argv: string[]): number {
  const { command, casesDir, tombstones } = parseArgs(argv);
  const scanned = scanCases(casesDir);
  // The rubric pack is the same one `cli.ts` defaults to; a case naming an
  // intent it does not define cannot be executed (issue #89).
  const rubricIntents = fs.existsSync(DEFAULT_RUBRICS_PATH)
    ? loadRubricIntents(DEFAULT_RUBRICS_PATH)
    : undefined;
  const lanes = scanLanes(casesDir, rubricIntents);

  if (command === "update") {
    const previous = loadManifest(casesDir);
    const manifest = updateManifest(previous, scanned, tombstones, lanes);
    saveManifest(casesDir, manifest);
    const blockers = Object.entries(manifest.blockers ?? {})
      .map(([b, n]) => `${n} ${b}`)
      .join(", ");
    console.log(
      `✅ Manifest updated: ${manifest.executableCases} executable of ${manifest.totalCases} cases present ` +
        `in ${Object.keys(manifest.files).length} files` +
        (blockers ? ` — ${manifest.unexecutableCases} blocked (${blockers})` : "") +
        `, ${manifest.tombstones.length} tombstone(s).`
    );
    return 0;
  }

  if (command === "check") {
    const manifest = loadManifest(casesDir);
    if (!manifest) {
      console.error(
        `❌ No ${MANIFEST_FILENAME} found in ${casesDir}. Create it with: ts-node scripts/case-manifest.ts update`
      );
      return 1;
    }
    const result = checkManifest(manifest, scanned, lanes);
    for (const w of result.warnings) console.warn(`⚠️  ${w}`);
    if (!result.ok) {
      console.error(`❌ Case manifest check FAILED (${result.errors.length} error(s)):`);
      for (const e of result.errors) console.error(`   - ${e}`);
      return 1;
    }
    // The executable count leads. "601 cases" was the number that misled;
    // "592 executable of 601 present" is the one that cannot (issue #89).
    const summary = summariseExecutability(lanes);
    console.log(
      `✅ Case manifest OK: ${summary.executable} executable of ${result.scannedCases} cases present ` +
        `across ${result.scannedFiles} files (${manifest.tombstones.length} tombstone(s)).`
    );
    return 0;
  }

  console.error(`Unknown command "${command}". Use: check | update`);
  return 1;
}

/* istanbul ignore next */
if (require.main === module) {
  process.exit(runCli(process.argv.slice(2)));
}
