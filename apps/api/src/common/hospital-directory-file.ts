/**
 * Single loader for the hospital directory file used by both
 * `HospitalDirectoryService` (chat hospital search) and
 * `WhatsAppNavigatorFlowService`.
 *
 * Canonical source: `apps/landing/src/content/hospitals.json`.
 * `apps/api/data/hospitals.json` is a git symlink to it for local dev and Jest;
 * in the Cloud Run image `cloudbuild`'s `stage-hospitals` step replaces the
 * symlink with a real copy (a symlink would dangle — Docker context is apps/api).
 *
 * Issue #123: for ten days every production revision started with an EMPTY
 * directory because the miss was a WARN and both services fell back silently.
 * This module makes the outcome observable: callers log at ERROR and the
 * health endpoint reports `hospitalDirectory` from the status recorded here.
 */
import * as fs from "fs";
import * as path from "path";

export interface HospitalDirectoryFile {
  /** Path that was read (after pseudo-symlink resolution). */
  path: string;
  /** Raw entries from the `hospitals` array — callers filter tier/status. */
  hospitals: unknown[];
  resolvedVia: "file" | "pseudo-symlink";
}

export interface HospitalDirectoryStatus {
  loaded: boolean;
  count: number;
  path: string | null;
  error: string | null;
  checkedAt: string | null;
}

let status: HospitalDirectoryStatus = {
  loaded: false,
  count: 0,
  path: null,
  error: "not loaded yet",
  checkedAt: null,
};

/** Where the directory is expected relative to `cwd` (`/app` on Cloud Run, `apps/api` in Jest). */
export function hospitalDirectoryPath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, "data/hospitals.json");
}

/**
 * Read and parse the directory. Throws (with a message that names the path) on
 * a missing file, a dangling symlink, invalid JSON, or an empty `hospitals`
 * array — silence is what let #123 survive five revisions.
 */
export function readHospitalDirectoryFile(cwd: string = process.cwd()): HospitalDirectoryFile {
  const jsonPath = hospitalDirectoryPath(cwd);
  let raw = fs.readFileSync(jsonPath, "utf-8").trim();
  let resolvedPath = jsonPath;
  let resolvedVia: HospitalDirectoryFile["resolvedVia"] = "file";

  // Windows Git without symlink support checks the link out as a one-line text
  // file containing the relative target. Follow it.
  if (raw.startsWith("..") && !raw.includes("\n")) {
    resolvedPath = path.resolve(path.dirname(jsonPath), raw);
    raw = fs.readFileSync(resolvedPath, "utf-8");
    resolvedVia = "pseudo-symlink";
  }

  const parsed = JSON.parse(raw) as { hospitals?: unknown };
  if (!Array.isArray(parsed.hospitals)) {
    throw new Error(`${resolvedPath}: no "hospitals" array`);
  }
  if (parsed.hospitals.length === 0) {
    throw new Error(`${resolvedPath}: "hospitals" array is empty`);
  }
  return { path: resolvedPath, hospitals: parsed.hospitals, resolvedVia };
}

/** Record the outcome of a load attempt so `/v1/health` can report it. */
export function recordHospitalDirectoryStatus(next: Omit<HospitalDirectoryStatus, "checkedAt">): void {
  status = { ...next, checkedAt: new Date().toISOString() };
}

export function getHospitalDirectoryStatus(): HospitalDirectoryStatus {
  return { ...status };
}

/** Test hook. */
export function resetHospitalDirectoryStatusForTests(): void {
  status = { loaded: false, count: 0, path: null, error: "not loaded yet", checkedAt: null };
}
