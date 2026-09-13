import {
  HospitalDirectoryService,
  HospitalSearchResult,
  haversineKm,
  normaliseDepartment,
} from "./hospital-directory.service";
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
      const results = svc.searchHospitals({
        city: "Patna",
        maxResults: 20,
        includeNational: false,
        requiredDepartments: ["Interpretive Dance"],
      });
      expect(results).toEqual([]);
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
