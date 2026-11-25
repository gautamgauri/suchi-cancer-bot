import * as fs from "fs";
import * as path from "path";
import { readHospitalDirectoryFile } from "./hospital-directory-file";
import {
  HOSPITAL_HELD_IDS,
  isBotVisible,
  RawHospitalEntry,
  singleIndianPhone,
} from "./hospital-visibility";

describe("hospital visibility rule", () => {
  const raws = readHospitalDirectoryFile().hospitals as RawHospitalEntry[];

  it("reads the full shipped directory", () => {
    expect(raws.length).toBeGreaterThanOrEqual(80);
  });

  it("excludes every entry whose status is not active", () => {
    const inactive = raws.filter((h) => h.status !== "active");
    expect(inactive.length).toBeGreaterThan(0);
    for (const h of inactive) expect(isBotVisible(h)).toBe(false);
  });

  it("excludes every entry with a risk flag recorded", () => {
    const flagged = raws.filter((h) => typeof h.risk_flag === "string" && h.risk_flag.trim() !== "");
    expect(flagged.length).toBeGreaterThan(0);
    for (const h of flagged) expect(isBotVisible(h)).toBe(false);
  });

  it("excludes the held ids, and each held id is in the directory", () => {
    for (const id of HOSPITAL_HELD_IDS) {
      const h = raws.find((x) => x.id === id);
      expect(h).toBeDefined();
      expect(isBotVisible(h!)).toBe(false);
    }
  });

  it("excludes tier D", () => {
    expect(isBotVisible({ id: "x", status: "active", tier: "D" })).toBe(false);
  });

  it("keeps an active, unflagged, unheld entry", () => {
    expect(isBotVisible({ id: "x", status: "active", tier: "A", risk_flag: null })).toBe(true);
  });

  /**
   * The landing site keeps its own copy of the held ids
   * (apps/landing/src/lib/hospital-directory.mjs, HIDE_UNTIL_CORRECTED). The
   * two lists must not drift. Until that file is on main, the API list must
   * equal the three ids agreed for both.
   */
  it("holds the same ids as the landing site", () => {
    const landing = path.resolve(__dirname, "../../../landing/src/lib/hospital-directory.mjs");
    const agreed = ["aiims-hyderabad", "nimhans-bangalore", "sctimst-thiruvananthapuram"];
    let landingIds = agreed;
    if (fs.existsSync(landing)) {
      const src = fs.readFileSync(landing, "utf8");
      const block = src.match(/HIDE_UNTIL_CORRECTED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
      expect(block).not.toBeNull();
      landingIds = [...block![1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    }
    expect([...HOSPITAL_HELD_IDS].sort()).toEqual([...landingIds].sort());
  });
});

describe("singleIndianPhone", () => {
  it.each([
    ["+91-612-2250127", "+916122250127"],
    ["0612-2297631", "+916122297631"],
    ["1800-313-4922", "18003134922"],
    ["+91-86177-87387", "+918617787387"],
    ["9876543210", "+919876543210"],
  ])("accepts %s", (input, want) => {
    expect(singleIndianPhone(input)).toBe(want);
  });

  it.each([["+91-0542-6917700"], ["033-2475-9313 / 033-3506-0600"], ["112"], [""], [null]])(
    "rejects %s",
    (input) => {
      expect(singleIndianPhone(input)).toBeNull();
    },
  );
});
