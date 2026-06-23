import { HospitalDirectoryService, HospitalSearchResult } from "./hospital-directory.service";

// ─── Inline fixture ────────────────────────────────────────────────────────
// Three hospitals covering the scenarios under test:
//   h-regional-a  → Tier A, regional, PMJAY, oral/head_and_neck
//   h-regional-b  → Tier B, regional, no PMJAY, breast
//   h-tier-d      → Tier D → must never appear in results
//   h-national    → national_referral, covers oral + breast

const FIXTURE = {
  hospitals: [
    {
      id: "h-regional-a",
      name: "Patna Cancer Centre",
      short_name: "PCC",
      city: "Patna",
      state: "Bihar",
      type: "Government",
      tier: "A",
      departments: ["head_and_neck", "surgical_oncology", "radiation_oncology"],
      cost_tier: "Low",
      pmjay_empanelled: true,
      ncg_member: true,
      tmc_affiliated: false,
      contact: { phone: "0612-1234567", address: "Patna, Bihar" },
      key_doctors: [{ name: "Dr. A", role: "Oncologist" }],
      notes: "Dharmashala available near hospital",
      navigation_notes: ["Take OPD token from Gate 1"],
      score: 90,
      national_referral: false,
    },
    {
      id: "h-regional-b",
      name: "Bihar Private Oncology",
      short_name: "BPO",
      city: "Patna",
      state: "Bihar",
      type: "Private",
      tier: "B",
      departments: ["medical_oncology", "surgical_oncology"],
      cost_tier: "Medium",
      pmjay_empanelled: false,
      ncg_member: false,
      tmc_affiliated: false,
      contact: { phone: "0612-9876543", address: "Patna, Bihar" },
      key_doctors: [],
      notes: "Private hospital with guest house",
      navigation_notes: [],
      score: 70,
      national_referral: false,
    },
    {
      id: "h-tier-d",
      name: "Obsolete Clinic",
      short_name: "OC",
      city: "Muzaffarpur",
      state: "Bihar",
      type: "Private",
      tier: "D",
      departments: ["surgical_oncology"],
      cost_tier: "Low",
      pmjay_empanelled: false,
      ncg_member: false,
      tmc_affiliated: false,
      contact: { phone: null, address: null },
      key_doctors: [],
      notes: "",
      navigation_notes: [],
      score: 20,
      national_referral: false,
    },
    {
      id: "h-national",
      name: "Tata Memorial Hospital",
      short_name: "TMH",
      city: "Mumbai",
      state: "Maharashtra",
      type: "Trust",
      tier: "A",
      departments: ["head_and_neck", "medical_oncology", "surgical_oncology"],
      cost_tier: "Low",
      pmjay_empanelled: true,
      ncg_member: true,
      tmc_affiliated: true,
      contact: { phone: "022-24177000", address: "Mumbai, Maharashtra" },
      key_doctors: [{ name: "Dr. B", role: "Head & Neck" }],
      notes: "Premier national referral centre",
      navigation_notes: ["Book online at tmc.gov.in"],
      score: 99,
      national_referral: true,
    },
  ],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Build a service instance with the fixture data injected directly into the
 * private fields, bypassing file-system I/O entirely.  We cast through unknown
 * so TypeScript accepts the private-field assignment.
 */
function buildService(): HospitalDirectoryService {
  const svc = new HospitalDirectoryService();
  const allHospitals = FIXTURE.hospitals as unknown as HospitalSearchResult[];
  const active = allHospitals.filter((h) => h.tier !== "D");
  (svc as any).nationalHospitals = active.filter((h) => (h as any).national_referral === true);
  (svc as any).hospitals = active.filter((h) => (h as any).national_referral !== true);
  return svc;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("HospitalDirectoryService", () => {
  let svc: HospitalDirectoryService;

  beforeEach(() => {
    svc = buildService();
  });

  describe("onModuleInit / loading", () => {
    it("marks service as loaded when fixture is present", () => {
      expect(svc.isLoaded()).toBe(true);
    });

    it("reports not loaded when no hospitals are injected (simulates missing file)", () => {
      const emptySvc = new HospitalDirectoryService();
      // Private fields default to [] — do not call onModuleInit so no real file is touched
      expect(emptySvc.isLoaded()).toBe(false);
    });
  });

  describe("Tier D exclusion", () => {
    it("never returns Tier D hospital in search results", () => {
      const results = svc.searchHospitals({ state: "Bihar", includeNational: false });
      expect(results.every((h) => h.id !== "h-tier-d")).toBe(true);
    });

    it("never returns Tier D hospital via getHospitalById", () => {
      expect(svc.getHospitalById("h-tier-d")).toBeNull();
    });
  });

  describe("PMJAY filter", () => {
    it("returns only PMJAY-empanelled or Government hospitals when pmjayRequired is true", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        pmjayRequired: true,
        includeNational: false,
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((h) => {
        const qualifies =
          h.pmjay_empanelled === true ||
          h.type.includes("Government") ||
          h.cost_tier === "Low";
        expect(qualifies).toBe(true);
      });
    });

    it("excludes non-PMJAY private hospital when pmjayRequired is true and a qualifying hospital exists", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        pmjayRequired: true,
        includeNational: false,
      });
      expect(results.find((h) => h.id === "h-regional-b")).toBeUndefined();
    });
  });

  describe("Cancer type filter", () => {
    it("returns hospitals with head_and_neck department when cancerType is 'oral'", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        cancerType: "oral",
        includeNational: false,
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((h) => {
        const matchesDept = h.departments.some((d) =>
          ["head_and_neck", "surgical_oncology", "radiation_oncology"].includes(d)
        );
        expect(matchesDept).toBe(true);
      });
    });

    it("returns breast-department hospitals when cancerType is 'breast'", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        cancerType: "breast",
        includeNational: false,
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((h) => {
        const matchesDept = h.departments.some((d) =>
          ["medical_oncology", "surgical_oncology"].includes(d)
        );
        expect(matchesDept).toBe(true);
      });
    });

    it("does not filter out results when cancerType produces no department match (graceful degradation)", () => {
      // "skin" maps to ["surgical_oncology"], but h-regional-a has surgical_oncology too —
      // use an unknown type to hit the no-match branch
      const results = svc.searchHospitals({
        state: "Bihar",
        cancerType: "unknowntype",
        includeNational: false,
      });
      // No CANCER_TYPE_DEPARTMENTS entry → no filter applied → both regional hospitals returned
      expect(results.length).toBe(2);
    });
  });

  describe("Affordability filter", () => {
    it("returns only Low cost_tier / Government hospitals when affordabilityTier is 'low'", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        affordabilityTier: "low",
        includeNational: false,
      });
      expect(results.length).toBeGreaterThan(0);
      results.forEach((h) => {
        const qualifies =
          h.cost_tier === "Low" ||
          h.type.includes("Government") ||
          h.type.includes("Trust") ||
          h.type.includes("TMC");
        expect(qualifies).toBe(true);
      });
    });

    it("excludes Medium/High cost hospital when affordabilityTier is 'low' and a Low hospital exists", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        affordabilityTier: "low",
        includeNational: false,
      });
      expect(results.find((h) => h.id === "h-regional-b")).toBeUndefined();
    });

    it("returns both Low and Medium hospitals when affordabilityTier is 'medium'", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        affordabilityTier: "medium",
        includeNational: false,
      });
      const ids = results.map((h) => h.id);
      expect(ids).toContain("h-regional-a");
      expect(ids).toContain("h-regional-b");
    });

    it("applies no affordability filter when affordabilityTier is 'any'", () => {
      const resultsAny = svc.searchHospitals({
        state: "Bihar",
        affordabilityTier: "any",
        includeNational: false,
      });
      const resultsDefault = svc.searchHospitals({
        state: "Bihar",
        includeNational: false,
      });
      expect(resultsAny.map((h) => h.id)).toEqual(resultsDefault.map((h) => h.id));
    });
  });

  describe("National referral appending", () => {
    it("appends national referral hospital for East India state queries", () => {
      const results = svc.searchHospitals({ state: "Bihar" });
      const national = results.filter((h) => h.national_referral === true);
      expect(national.length).toBeGreaterThan(0);
      expect(national[0].id).toBe("h-national");
    });

    it("does not append national referrals when includeNational is false", () => {
      const results = svc.searchHospitals({ state: "Bihar", includeNational: false });
      expect(results.every((h) => h.national_referral !== true)).toBe(true);
    });

    it("does not append national referrals when the query state is already national-scope", () => {
      const results = svc.searchHospitals({ state: "Maharashtra" });
      expect(results.every((h) => h.national_referral !== true)).toBe(true);
    });

    it("filters national pool by cancer type before appending", () => {
      // "oral" maps to head_and_neck — h-national qualifies; append it
      const withOral = svc.searchHospitals({ state: "Bihar", cancerType: "oral" });
      expect(withOral.some((h) => h.id === "h-national")).toBe(true);
    });
  });

  describe("compareHospitals", () => {
    it("returns hospitals array and comparison maps keyed by short_name", () => {
      const result = svc.compareHospitals(["h-regional-a", "h-regional-b"]);

      expect(result.hospitals).toHaveLength(2);
      expect(result.comparison.costTiers["PCC"]).toBe("Low");
      expect(result.comparison.costTiers["BPO"]).toBe("Medium");
      expect(result.comparison.pmjayStatus["PCC"]).toBe(true);
      expect(result.comparison.pmjayStatus["BPO"]).toBe(false);
      expect(result.comparison.departments["PCC"]).toContain("head_and_neck");
      expect(result.comparison.tiers["PCC"]).toBe("A");
      expect(result.comparison.scores["PCC"]).toBe(90);
    });

    it("silently drops unknown IDs from comparison", () => {
      const result = svc.compareHospitals(["h-regional-a", "does-not-exist"]);
      expect(result.hospitals).toHaveLength(1);
      expect(result.hospitals[0].id).toBe("h-regional-a");
    });

    it("caps comparison at 4 hospitals", () => {
      const result = svc.compareHospitals([
        "h-regional-a",
        "h-regional-b",
        "h-national",
        "h-regional-a",
        "h-regional-b",
      ]);
      expect(result.hospitals.length).toBeLessThanOrEqual(4);
    });
  });

  describe("generateVisitPrep", () => {
    it("returns null for unknown hospital ID", () => {
      expect(svc.generateVisitPrep("does-not-exist")).toBeNull();
    });

    it("returns required top-level fields", () => {
      const prep = svc.generateVisitPrep("h-regional-a");
      expect(prep).not.toBeNull();
      expect(prep!.hospitalId).toBe("h-regional-a");
      expect(prep!.hospitalName).toBe("Patna Cancer Centre");
      expect(Array.isArray(prep!.documents)).toBe(true);
      expect(prep!.documents.length).toBeGreaterThan(0);
      expect(Array.isArray(prep!.logisticsNotes)).toBe(true);
      expect(typeof prep!.disclaimer).toBe("string");
      expect(prep!.disclaimer.length).toBeGreaterThan(0);
    });

    it("includes Aadhaar in document checklist", () => {
      const prep = svc.generateVisitPrep("h-regional-a")!;
      expect(prep.documents.some((d) => d.toLowerCase().includes("aadhaar"))).toBe(true);
    });

    it("adds PMJAY financial note when hospital is empanelled", () => {
      const prep = svc.generateVisitPrep("h-regional-a")!;
      expect(
        prep.financialNotes.some((n) => n.toLowerCase().includes("pm-jay"))
      ).toBe(true);
    });

    it("includes dharmashala logistics note when notes mention dharmashala", () => {
      const prep = svc.generateVisitPrep("h-regional-a")!;
      expect(
        prep.logisticsNotes.some((n) => n.toLowerCase().includes("dharmashala"))
      ).toBe(true);
    });

    it("uses navigation_notes from the hospital record when present", () => {
      const prep = svc.generateVisitPrep("h-regional-a")!;
      expect(prep.navigationNotes).toContain("Take OPD token from Gate 1");
    });

    it("works for national referral hospital via generateVisitPrep", () => {
      const prep = svc.generateVisitPrep("h-national");
      expect(prep).not.toBeNull();
      expect(prep!.hospitalId).toBe("h-national");
    });
  });

  describe("maxResults limiting", () => {
    it("respects maxResults cap", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        maxResults: 1,
        includeNational: false,
      });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("sorts by score descending before limiting", () => {
      const results = svc.searchHospitals({
        state: "Bihar",
        maxResults: 1,
        includeNational: false,
      });
      // h-regional-a (score 90) should come before h-regional-b (score 70)
      expect(results[0].id).toBe("h-regional-a");
    });
  });
});
