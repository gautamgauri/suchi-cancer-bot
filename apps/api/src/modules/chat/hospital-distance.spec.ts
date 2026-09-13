import {
  HospitalDirectoryService,
  HospitalSearchResult,
  haversineKm,
  normaliseDepartment,
} from "./hospital-directory.service";
import { ExecutionPlannerService } from "./execution-planner.service";
import { readHospitalDirectoryFile } from "../../common/hospital-directory-file";
import { resolveCoordsForCity } from "./utils/location-detector";
import * as fs from "fs";
import * as path from "path";

/**
 * Nearest-relevant-centre ordering (issue #103).
 *
 * These run against the SHIPPED directory, not a fixture, because the property
 * under test is a property of the real data: where the 83 centres actually are
 * relative to the districts patients ask from. A fixture would only prove the
 * comparator sorts numbers.
 *
 * Orderings are asserted, never absolute kilometres. The coordinates are
 * locality-level geocodes, so an exact distance is not a promise the data can
 * keep — but "Muzaffarpur is closer to Darbhanga than Patna is" survives any
 * reasonable geocoder imprecision, and ordering is the only thing the feature
 * actually claims.
 */

const INDIA_BBOX = { latMin: 6.5, latMax: 37.5, lonMin: 68.0, lonMax: 97.5 };

const UNRESOLVED_PATH = path.resolve(
  __dirname,
  "../../../../../scripts/geocode-unresolved.json"
);

describe("Hospital distance ordering (issue #103)", () => {
  let svc: HospitalDirectoryService;

  beforeAll(() => {
    svc = new HospitalDirectoryService();
    svc.onModuleInit();
  });

  /** Regional (non-national) results for a city, distance-ordered. */
  const near = (city: string, extra: Record<string, unknown> = {}) =>
    svc.searchHospitals({
      city,
      maxResults: 20,
      includeNational: false,
      ...extra,
    });

  /** Index of the first centre in `city`, or -1. */
  const firstIndexIn = (results: HospitalSearchResult[], city: string): number =>
    results.findIndex((h) => h.city === city);

  // ── Golden orderings ─────────────────────────────────────────────────────
  //
  // Each pair was hand-checked against a map. The claim in every row is the
  // same: the state model gets this wrong, and distance gets it right.
  //
  //   Darbhanga  → Muzaffarpur ~52km   vs Patna     ~96km   (same state, nearer)
  //   Purnia     → Siliguri   ~142km   vs Patna    ~232km   (CROSSES into West Bengal)
  //   Kishanganj → Siliguri    ~83km   vs Patna    ~284km   (CROSSES into West Bengal)
  //   Buxar      → Varanasi   ~100km   vs Patna    ~107km   (CROSSES into Uttar Pradesh)
  describe("golden orderings", () => {
    const GOLDEN: Array<[string, string, string]> = [
      ["Darbhanga", "Muzaffarpur", "Patna"],
      ["Purnia", "Siliguri", "Patna"],
      ["Kishanganj", "Siliguri", "Patna"],
      ["Buxar", "Varanasi", "Patna"],
    ];

    it.each(GOLDEN)(
      "from %s, a centre in %s is offered before any centre in %s",
      (origin, nearer, farther) => {
        const results = near(origin);
        const iNearer = firstIndexIn(results, nearer);
        const iFarther = firstIndexIn(results, farther);

        expect(iNearer).toBeGreaterThanOrEqual(0);
        expect(iFarther).toBeGreaterThanOrEqual(0);
        expect(iNearer).toBeLessThan(iFarther);
      }
    );

    it("crosses state borders when the nearer centre is in another state", () => {
      // The three cross-border rows above are the whole point of #103: under
      // the state model none of these centres could ever be reached, because
      // the same-state rung fired first and never widened.
      for (const [origin, nearer] of [
        ["Purnia", "Siliguri"],
        ["Kishanganj", "Siliguri"],
        ["Buxar", "Varanasi"],
      ]) {
        const results = near(origin);
        const hit = results.find((h) => h.city === nearer);
        expect(hit).toBeDefined();
        expect(hit!.state).not.toBe("Bihar");
      }
    });

    it("returns results in non-decreasing distance order", () => {
      for (const [origin] of GOLDEN) {
        const distances = near(origin).map(
          (h) => h.distance_km ?? Number.POSITIVE_INFINITY
        );
        expect(distances).toEqual([...distances].sort((a, b) => a - b));
      }
    });

    it("still surfaces HBCH Muzaffarpur first for Darbhanga — #95's outcome survives", () => {
      const results = near("Darbhanga");
      expect(results[0].id).toBe("homi-bhabha-cancer-hospital-muzaffarpur");
    });
  });

  // ── Capability before distance ───────────────────────────────────────────
  //
  // The safety-relevant assertion in the whole issue.
  describe("capability is filtered before distance is considered", () => {
    const HEALING_TOUCH = "healing-touch-bhagalpur";

    it("offers the nearest centre for a query with no stated need", () => {
      // Control for the test below: with no need stated, Healing Touch really
      // is the nearest centre to Bhagalpur, and nothing stops it leading.
      const results = near("Bhagalpur");
      expect(results[0].id).toBe(HEALING_TOUCH);
    });

    it("never offers a surgery-only centre for a radiotherapy need, however near", () => {
      const results = near("Bhagalpur", {
        requiredDepartments: ["radiation_oncology"],
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.map((h) => h.id)).not.toContain(HEALING_TOUCH);
      // And what it does offer can actually deliver radiotherapy.
      results.forEach((h) => {
        const depts = h.departments.map(normaliseDepartment);
        expect(depts).toContain("radiation_oncology");
      });
    });

    it("drops an incapable centre rather than keeping it to fill the list", () => {
      // Healing Touch is nearest AND the only centre in its city. The old
      // graceful-degradation branch would have kept it when the filter emptied
      // the city-scoped set; it must not.
      const results = svc.searchHospitals({
        city: "Bhagalpur",
        maxResults: 3,
        includeNational: false,
        requiredDepartments: ["radiation_oncology"],
      });
      expect(results.map((h) => h.id)).not.toContain(HEALING_TOUCH);
    });

    it("applies the same rule to national referral centres", () => {
      const results = svc.searchHospitals({
        city: "Bhagalpur",
        maxResults: 3,
        requiredDepartments: ["radiation_oncology"],
      });
      results
        .filter((h) => h.national_referral)
        .forEach((h) => {
          expect(h.departments.map(normaliseDepartment)).toContain(
            "radiation_oncology"
          );
        });
    });
  });

  // ── The capability filter must be reachable from the patient's words ─────
  //
  // End-to-end through ExecutionPlannerService, because that is where the gap
  // was: the hard filter existed and worked, but nothing in the patient-facing
  // flow ever set `requiredDepartments`, so it never ran on a real query
  // (PR #148 review, P1).
  describe("a patient's stated treatment need reaches the capability filter", () => {
    const HEALING_TOUCH = "healing-touch-bhagalpur";
    let planner: ExecutionPlannerService;

    beforeAll(() => {
      planner = new ExecutionPlannerService(svc);
    });

    const lookup = (text: string): HospitalSearchResult[] => {
      const plan = planner.plan(text, "NAVIGATION", undefined, "en");
      expect(plan.structuredHospitalResults).not.toBeNull();
      return plan.structuredHospitalResults as HospitalSearchResult[];
    };

    it("does not offer surgery-only Healing Touch first for a Bhagalpur radiotherapy query", () => {
      const results = lookup("Which hospital in Bhagalpur for radiotherapy?");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).not.toBe(HEALING_TOUCH);
      expect(results.map((h) => h.id)).not.toContain(HEALING_TOUCH);
      results
        .filter((h) => !h.national_referral)
        .forEach((h) =>
          expect(h.departments.map(normaliseDepartment)).toContain(
            "radiation_oncology"
          )
        );
    });

    it("does the same for the Hinglish and Devanagari forms of the question", () => {
      // The Devanagari row also covers the `\b` gate in `detectSignals`: before
      // it was split, `\bअस्पताल\b` never matched, so a Hindi-script hospital
      // question never reached the directory at all.
      for (const text of [
        "Bhagalpur me sikai ke liye kaun sa hospital hai",
        "भागलपुर में रेडियोथेरेपी के लिए कौन सा अस्पताल है",
      ]) {
        const results = lookup(text);
        expect(results.length).toBeGreaterThan(0);
        expect(results.map((h) => h.id)).not.toContain(HEALING_TOUCH);
      }
    });

    it("still offers Healing Touch when the patient states a need it can serve", () => {
      // The control: the filter must not be a blanket demotion of a tier-C
      // centre. Healing Touch does surgical oncology, and for a surgery
      // question it is the nearest centre in Bhagalpur.
      const results = lookup("Which hospital in Bhagalpur for cancer surgery?");
      expect(results[0].id).toBe(HEALING_TOUCH);
    });

    it("flags the search but still returns rows when nothing regional can serve the need", () => {
      // Never-empty guarantee: no centre in the regional pool offers proton
      // therapy, so the unfiltered pool is kept — and flagged, so the caller
      // says no capable centre was found rather than presenting these as
      // centres that deliver it.
      const outcome = svc.searchHospitalsWithGeography({
        city: "Bhagalpur",
        maxResults: 3,
        includeNational: false,
        requiredDepartments: ["proton_therapy"],
      });
      expect(outcome.results.length).toBeGreaterThan(0);
      expect(outcome.geography.capabilityUnavailable).toBe(true);
      expect(outcome.geography.requiredDepartments).toContain("proton_therapy");
    });

    it("does not flag a search the directory can actually serve", () => {
      const outcome = svc.searchHospitalsWithGeography({
        city: "Bhagalpur",
        maxResults: 3,
        includeNational: false,
        requiredDepartments: ["radiation_oncology"],
      });
      expect(outcome.geography.capabilityUnavailable).toBe(false);
    });

    it("ANDs a stated need against the cancer type instead of ORing them", () => {
      // Merged into one set and matched with `some`, an oral-cancer
      // radiotherapy query is satisfied by `surgical_oncology` — and
      // surgery-only Healing Touch comes back for a radiation question.
      const results = svc.searchHospitals({
        city: "Bhagalpur",
        maxResults: 5,
        includeNational: false,
        cancerType: "oral",
        requiredDepartments: ["radiation_oncology"],
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.map((h) => h.id)).not.toContain(HEALING_TOUCH);
      results.forEach((h) => {
        const depts = h.departments.map(normaliseDepartment);
        expect(depts).toContain("radiation_oncology");
      });
    });
  });

  // ── The department-casing bug the #99 review found ───────────────────────
  describe("department matching is spelling- and case-insensitive", () => {
    it("matches AIIMS Patna's 'Radiotherapy' against a radiation_oncology need", () => {
      // The concrete regression the #99 review found: AIIMS Patna lists the
      // department as "Radiotherapy", which never matched the snake_case
      // requirement, so a major government cancer centre was invisible to every
      // radiotherapy query. (It sits in the national referral pool, so it is
      // reached through that arm rather than the regional one.)
      const aiims = svc.getHospitalById("aiims-patna");
      expect(aiims).not.toBeNull();
      expect(aiims!.departments).toContain("Radiotherapy");
      expect(aiims!.departments).not.toContain("radiation_oncology");

      // Before normalisation this comparison was false, which is precisely why
      // the capability filter dropped it.
      expect(aiims!.departments.map(normaliseDepartment)).toContain(
        "radiation_oncology"
      );

      // And it survives a radiotherapy search rather than being filtered out.
      const local = new HospitalDirectoryService();
      (local as any).hospitals = [aiims!];
      expect(
        local
          .searchHospitals({
            city: "Patna",
            maxResults: 5,
            includeNational: false,
            requiredDepartments: ["radiation_oncology"],
          })
          .map((h) => h.id)
      ).toContain("aiims-patna");
    });

    it.each([
      ["Radiotherapy", "radiation_oncology"],
      ["Radiation Oncology", "radiation_oncology"],
      ["radiation_oncology", "radiation_oncology"],
      ["Head & Neck Oncology", "head_and_neck"],
      ["Gynaecologic Oncology", "gynaec_oncology"],
      ["gynaecology", "gynaec_oncology"],
      ["Haematology", "hemato_oncology"],
      ["Paediatric Oncology", "pediatric_oncology"],
      ["Palliative Medicine", "palliative_care"],
    ])("normalises %s to %s", (raw, canonical) => {
      expect(normaliseDepartment(raw)).toBe(canonical);
    });

    it("fails closed on an unrecognised department rather than matching everything", () => {
      expect(normaliseDepartment("Interpretive Dance")).toBe("interpretive_dance");
      const outcome = svc.searchHospitalsWithGeography({
        city: "Patna",
        maxResults: 20,
        includeNational: false,
        requiredDepartments: ["Interpretive Dance"],
      });
      // Failing closed means the requirement matches NOTHING — not that an
      // unknown name quietly matches every centre. The rows that come back are
      // the never-empty fallback, and they are flagged as not serving the need
      // (PR #148 review): a patient is never handed an empty list, and the
      // caller is never allowed to present these as capable centres.
      expect(outcome.geography.capabilityUnavailable).toBe(true);
      expect(outcome.geography.requiredDepartments).toEqual([
        "interpretive_dance",
      ]);
      expect(outcome.results.length).toBeGreaterThan(0);
    });

    it("finds gynaecologic centres, which matched nothing before normalisation", () => {
      const results = svc.searchHospitals({
        city: "Patna",
        maxResults: 20,
        includeNational: false,
        cancerType: "cervical",
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ── Distance semantics ───────────────────────────────────────────────────
  describe("distance semantics", () => {
    it("sorts a hospital with no coordinates last, not first", () => {
      const local = new HospitalDirectoryService();
      const base = svc.getHospitalById("homi-bhabha-cancer-hospital-muzaffarpur")!;
      (local as any).hospitals = [
        { ...base, id: "ungeocoded", latitude: null, longitude: null, score: 99 },
        { ...base, id: "far", latitude: 19.055, longitude: 72.8692, score: 10 },
        { ...base, id: "near", score: 10 },
      ];
      const results = local.searchHospitals({
        city: "Darbhanga",
        maxResults: 10,
        includeNational: false,
      });
      // Despite the highest score, the record we cannot place comes last.
      expect(results[results.length - 1].id).toBe("ungeocoded");
      expect(results[0].id).toBe("near");
    });

    it("breaks a distance tie by directory score", () => {
      // Patna's centres share a city and so share a distance from Darbhanga to
      // within metres; the tiebreak must be quality, not file order.
      const results = near("Darbhanga").filter((h) => h.city === "Patna");
      expect(results.length).toBeGreaterThan(1);
      const tied = results.filter(
        (h) => Math.abs((h.distance_km ?? 0) - (results[0].distance_km ?? 0)) < 0.5
      );
      const scores = tied.map((h) => h.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it("falls back to the administrative chain for a city with no coordinates", () => {
      // "Nowhereville" is not in INDIAN_CITIES, so there is no origin and #99's
      // widening chain must still produce a non-empty set.
      const { results, geography } = svc.searchHospitalsWithGeography({
        city: "Nowhereville",
        state: "Bihar",
        maxResults: 3,
        includeNational: false,
      });
      expect(geography.stage).not.toBe("distance");
      expect(results.length).toBeGreaterThan(0);
    });

    it("computes a sane haversine distance", () => {
      // Darbhanga → Muzaffarpur, hand-checked at roughly 50km.
      const darbhanga = resolveCoordsForCity("Darbhanga")!;
      const muzaffarpur = resolveCoordsForCity("Muzaffarpur")!;
      const km = haversineKm(darbhanga, muzaffarpur);
      expect(km).toBeGreaterThan(40);
      expect(km).toBeLessThan(65);
      expect(haversineKm(darbhanga, darbhanga)).toBeCloseTo(0, 6);
    });
  });

  // ── Data integrity ───────────────────────────────────────────────────────
  //
  // "Every record either carries coordinates or is listed as unresolved" is the
  // property that makes the geocoder's hard gates meaningful rather than
  // decorative. Without this there is a silent third state.
  describe("geocoded data integrity", () => {
    const file = readHospitalDirectoryFile();
    const hospitals = file.hospitals as HospitalSearchResult[];
    const unresolved = fs.existsSync(UNRESOLVED_PATH)
      ? JSON.parse(fs.readFileSync(UNRESOLVED_PATH, "utf-8"))
      : { hospitals: [], cities: [] };
    const unresolvedIds = new Set<string>(
      (unresolved.hospitals ?? []).map((h: { id: string }) => h.id)
    );

    it("ships all 83 hospitals", () => {
      expect(hospitals.length).toBe(83);
    });

    it("gives every hospital either coordinates or an entry in the unresolved file", () => {
      const silent = hospitals.filter(
        (h) =>
          (typeof h.latitude !== "number" || typeof h.longitude !== "number") &&
          !unresolvedIds.has(h.id)
      );
      expect(silent.map((h) => h.id)).toEqual([]);
    });

    it("places every coordinate inside India", () => {
      const outside = hospitals
        .filter((h) => typeof h.latitude === "number")
        .filter(
          (h) =>
            h.latitude! < INDIA_BBOX.latMin ||
            h.latitude! > INDIA_BBOX.latMax ||
            h.longitude! < INDIA_BBOX.lonMin ||
            h.longitude! > INDIA_BBOX.lonMax
        );
      expect(outside.map((h) => h.id)).toEqual([]);
    });

    it("records provenance on every geocoded hospital", () => {
      hospitals
        .filter((h) => typeof h.latitude === "number")
        .forEach((h) => {
          expect(h.geocode_source).toBe("nominatim");
          expect(["name_address", "address", "city"]).toContain(
            h.geocode_confidence
          );
        });
    });

    it("gives every INDIAN_CITIES entry coordinates inside India", () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, "./utils/location-detector.ts"),
        "utf-8"
      );
      const entries = [
        ...source.matchAll(
          /canonical: '([^']+)', state: '([^']+)'[^}]*?coords: \[([-\d.]+), ([-\d.]+)\]/g
        ),
      ];
      // Every declared entry must have matched, coords included.
      const declared = (source.match(/\{ canonical: '/g) ?? []).length;
      expect(entries.length).toBe(declared);
      expect(entries.length).toBeGreaterThanOrEqual(45);

      for (const [, city, , lat, lon] of entries) {
        const la = Number(lat);
        const lo = Number(lon);
        expect(`${city}:${la >= INDIA_BBOX.latMin && la <= INDIA_BBOX.latMax}`).toBe(
          `${city}:true`
        );
        expect(`${city}:${lo >= INDIA_BBOX.lonMin && lo <= INDIA_BBOX.lonMax}`).toBe(
          `${city}:true`
        );
      }
    });

    it.each([
      ["Patna", 25.61, 85.14],
      ["Darbhanga", 26.15, 85.9],
      ["Muzaffarpur", 26.12, 85.39],
      ["Bhagalpur", 25.25, 87.0],
      ["Purnia", 25.78, 87.47],
      ["Gaya", 24.79, 85.0],
    ])(
      "resolves %s within ~20km of its hand-checked position",
      (city, lat, lon) => {
        const coords = resolveCoordsForCity(city);
        expect(coords).not.toBeNull();
        expect(haversineKm(coords!, [lat, lon])).toBeLessThan(20);
      }
    );
  });
});
