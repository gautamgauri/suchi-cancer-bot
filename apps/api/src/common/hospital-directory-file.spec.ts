import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getHospitalDirectoryStatus,
  readHospitalDirectoryFile,
  recordHospitalDirectoryStatus,
  resetHospitalDirectoryStatusForTests,
} from "./hospital-directory-file";

function tmpCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "suchi-hospdir-"));
  fs.mkdirSync(path.join(dir, "data"));
  return dir;
}

describe("readHospitalDirectoryFile (issue #123)", () => {
  it("reads a regular file", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(path.join(cwd, "data/hospitals.json"), JSON.stringify({ hospitals: [{ id: "a" }, { id: "b" }] }));
    const out = readHospitalDirectoryFile(cwd);
    expect(out.hospitals).toHaveLength(2);
    expect(out.resolvedVia).toBe("file");
  });

  it("follows a Windows pseudo-symlink (one-line relative path)", () => {
    const cwd = tmpCwd();
    fs.mkdirSync(path.join(cwd, "landing"));
    fs.writeFileSync(path.join(cwd, "landing/hospitals.json"), JSON.stringify({ hospitals: [{ id: "a" }] }));
    fs.writeFileSync(path.join(cwd, "data/hospitals.json"), "../landing/hospitals.json");
    const out = readHospitalDirectoryFile(cwd);
    expect(out.hospitals).toHaveLength(1);
    expect(out.resolvedVia).toBe("pseudo-symlink");
  });

  it("throws on a missing file — the production shape (ENOENT)", () => {
    const cwd = tmpCwd();
    expect(() => readHospitalDirectoryFile(cwd)).toThrow(/ENOENT/);
  });

  it("throws on a dangling real symlink — the exact image shape", () => {
    const cwd = tmpCwd();
    fs.symlinkSync("../../landing/src/content/hospitals.json", path.join(cwd, "data/hospitals.json"));
    expect(() => readHospitalDirectoryFile(cwd)).toThrow(/ENOENT/);
  });

  it("throws on an empty hospitals array instead of loading nothing silently", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(path.join(cwd, "data/hospitals.json"), JSON.stringify({ hospitals: [] }));
    expect(() => readHospitalDirectoryFile(cwd)).toThrow(/empty/);
  });

  it("throws when the hospitals key is missing", () => {
    const cwd = tmpCwd();
    fs.writeFileSync(path.join(cwd, "data/hospitals.json"), JSON.stringify({ nope: [] }));
    expect(() => readHospitalDirectoryFile(cwd)).toThrow(/no "hospitals" array/);
  });
});

describe("hospital directory status registry", () => {
  beforeEach(() => resetHospitalDirectoryStatusForTests());

  it("starts as not loaded", () => {
    expect(getHospitalDirectoryStatus()).toMatchObject({ loaded: false, count: 0 });
  });

  it("records a load result with a timestamp", () => {
    recordHospitalDirectoryStatus({ loaded: true, count: 83, path: "/app/data/hospitals.json", error: null });
    const s = getHospitalDirectoryStatus();
    expect(s).toMatchObject({ loaded: true, count: 83, error: null });
    expect(s.checkedAt).toMatch(/^\d{4}-/);
  });
});
