import { ChatService } from "./chat.service";
import {
  HospitalSearchGeography,
  HospitalSearchResult,
} from "./execution-planner.service";

/**
 * Regression: the hospital block heading must describe how far the search
 * actually widened, not assert proximity (PR #99 review blocker).
 *
 * Before this, `buildHospitalContextBlock()` headed every list
 * `--- Regional / Nearby Centres ---`. That was harmless while an unmatched
 * city returned zero rows and the block was omitted entirely. Once #95's
 * fallback chain started widening the candidate set instead of returning
 * nothing, the heading became false on two rungs:
 *
 *   - adjacent_state — a Darbhanga query widening into West Bengal presents
 *     Siliguri or Kolkata (300–400km) to the model as "nearby";
 *   - unfiltered     — a Jaipur query matching no rung presents the whole
 *     East-India pool the same way.
 *
 * `searchHospitalsWithGeography()` now carries the stage, so the heading is
 * derived from it. No heading claims a distance or a travel time: the
 * directory holds no coordinates (issue #103), so any such claim would be
 * invented.
 *
 * `buildHospitalContextBlock` is a pure string formatter with no `this`
 * dependencies beyond its own heading helper, so it is exercised directly off
 * the prototype rather than standing up the full ChatService provider graph.
 */
describe("ChatService — hospital context block heading (PR #99 review)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc: any = Object.create(ChatService.prototype);

  const hospital = (
    over: Partial<HospitalSearchResult> = {}
  ): HospitalSearchResult =>
    ({
      id: "h-1",
      name: "Homi Bhabha Cancer Hospital",
      short_name: "HBCH",
      city: "Muzaffarpur",
      state: "Bihar",
      type: "Trust (TMC)",
      tier: "A",
      departments: ["medical_oncology", "surgical_oncology"],
      cost_tier: "Low",
      pmjay_empanelled: true,
      ncg_member: true,
      contact: { phone: "0621-000000", address: "Muzaffarpur, Bihar" },
      key_doctors: [],
      notes: "",
      navigation_notes: [],
      score: 90,
      ...over,
    }) as HospitalSearchResult;

  const geo = (
    stage: HospitalSearchGeography["stage"],
    requestedCity: string | null,
    resolvedState: string | null
  ): HospitalSearchGeography => ({ stage, requestedCity, resolvedState });

  const build = (
    results: HospitalSearchResult[] | null,
    geography?: HospitalSearchGeography | null
  ): string => svc.buildHospitalContextBlock(results, geography);

  it("never emits the old proximity-asserting heading, on any stage", () => {
    const stages: HospitalSearchGeography["stage"][] = [
      "city",
      "state",
      "adjacent_state",
      "unfiltered",
      "none",
    ];
    for (const stage of stages) {
      const block = build([hospital()], geo(stage, "Darbhanga", "Bihar"));
      expect(block).not.toContain("Regional / Nearby Centres");
    }
  });

  it("names the city when the hospitals are in the city the patient asked about", () => {
    const block = build(
      [hospital({ city: "Patna" })],
      geo("city", "Patna", "Bihar")
    );
    expect(block).toContain("--- Centres in Patna ---");
  });

  it("names the state when the search widened past the patient's city", () => {
    const block = build([hospital()], geo("state", "Darbhanga", "Bihar"));
    expect(block).toContain("--- Centres in Bihar ---");
    // Muzaffarpur is not Darbhanga — the block must not imply it is.
    expect(block).not.toContain("Centres in Darbhanga");
  });

  it("discloses a cross-border widening instead of calling it nearby", () => {
    const block = build(
      [hospital({ city: "Siliguri", state: "West Bengal" })],
      geo("adjacent_state", "Kishanganj", "Bihar")
    );
    expect(block).toContain(
      "--- Centres in neighbouring states — may involve significant travel ---"
    );
  });

  it("discloses an unfiltered fallback and names the city nothing was found near", () => {
    const block = build(
      [hospital({ city: "Kolkata", state: "West Bengal" })],
      geo("unfiltered", "Jaipur", "Rajasthan")
    );
    expect(block).toContain(
      "--- Major cancer centres (none found near Jaipur) — travel distance not established ---"
    );
  });

  it("falls back to a location-free heading when no city was supplied", () => {
    const block = build([hospital()], geo("none", null, null));
    expect(block).toContain("--- Major cancer centres ---");
  });

  it("stays truthful when the geography argument is missing entirely", () => {
    const block = build([hospital()]);
    expect(block).not.toContain("Regional / Nearby Centres");
    expect(block).toContain("--- Major cancer centres ---");
  });

  it("adds an explicit do-not-call-it-nearby instruction on the adjacent-state rung", () => {
    const block = build(
      [hospital({ city: "Siliguri", state: "West Bengal" })],
      geo("adjacent_state", "Kishanganj", "Bihar")
    );
    expect(block).toContain(
      "no cancer centre in the directory serves Kishanganj directly"
    );
    expect(block).toContain('Do NOT describe them as "nearby"');
    expect(block).toContain("do NOT state or estimate a travel time or distance");
  });

  it("adds the same instruction on the unfiltered rung", () => {
    const block = build(
      [hospital({ city: "Kolkata", state: "West Bengal" })],
      geo("unfiltered", "Jaipur", "Rajasthan")
    );
    expect(block).toContain(
      "no cancer centre in the directory serves Jaipur directly"
    );
  });

  it("does not add the travel caveat when the hospitals really are in the patient's city or state", () => {
    for (const stage of ["city", "state"] as const) {
      const block = build([hospital()], geo(stage, "Darbhanga", "Bihar"));
      expect(block).not.toContain("may involve significant travel");
      expect(block).not.toContain("directly. The centres listed above");
    }
  });

  it("still labels national referral centres separately, unchanged", () => {
    const block = build(
      [
        hospital(),
        hospital({
          id: "h-nat",
          name: "Tata Memorial Hospital",
          city: "Mumbai",
          state: "Maharashtra",
          national_referral: true,
        }),
      ],
      geo("state", "Darbhanga", "Bihar")
    );
    expect(block).toContain("--- Centres in Bihar ---");
    expect(block).toContain("--- National Referral Centres");
  });

  it("returns an empty block when there are no results at all", () => {
    expect(build(null, geo("state", "Darbhanga", "Bihar"))).toBe("");
    expect(build([], geo("state", "Darbhanga", "Bihar"))).toBe("");
  });

  // ── Distance rendering (PR #148 review, P2) ────────────────────────────
  //
  // `Math.max(10, …)` floored every measured distance at ten kilometres, so a
  // hospital geocoded to city confidence — i.e. to the very coordinate the
  // patient's city resolves to, which is how many records are geocoded —
  // measured 0km and was fed to the model as "~10 km away". A bound is
  // truthful there; a number is not.
  describe("distance lines", () => {
    const withDistance = (km: number): string =>
      build([hospital({ distance_km: km })], geo("distance", "Patna", "Bihar"));

    it.each([0, 0.4, 3.2, 9.9])(
      "renders a sub-10km distance (%s) as a bound, never as ~10 km",
      (km) => {
        const block = withDistance(km);
        expect(block).toContain("within 10 km (straight-line)");
        expect(block).not.toContain("~10 km away");
        expect(block).not.toContain("0 km away");
      }
    );

    it("rounds a longer distance to the nearest 10km, as before", () => {
      expect(withDistance(52.4)).toContain("~50 km away (straight-line)");
      expect(withDistance(96)).toContain("~100 km away (straight-line)");
      expect(withDistance(11)).toContain("~10 km away (straight-line)");
    });

    it("says nothing at all when no distance was measured", () => {
      const block = build([hospital()], geo("distance", "Patna", "Bihar"));
      expect(block).not.toContain("km away");
      expect(block).not.toContain("within 10 km");
    });

    it("heads a distance-ordered list by the city it is ordered from", () => {
      expect(withDistance(52)).toContain("--- Nearest cancer centres to Patna ---");
    });
  });

  // ── Distance-handling instruction (SCCF review) ────────────────────────
  //
  // AGENTS.md §1.3: prompt changes under chat/ go through SCCF human/medical
  // review in their own labelled PR. This is that change. It exists because
  // the block now carries kilometre figures, and without an instruction the
  // model is free to call a 90km centre "nearby" or to turn "~50 km" into
  // "about an hour away" — a journey time this data cannot support, on roads
  // it knows nothing about, to a patient deciding where to travel for
  // treatment.
  it("tells the model a distance is straight-line and must not become a travel time", () => {
    const block = build(
      [hospital({ distance_km: 52 })],
      geo("distance", "Patna", "Bihar")
    );
    expect(block).toContain(
      "Where a distance is given it is a STRAIGHT-LINE distance, already rounded."
    );
    expect(block).toContain("Repeat it as written if you mention it.");
    expect(block).toContain(
      "NEVER convert it into a travel time, a road distance, or a journey duration"
    );
  });

  // ── Capability label (PR #148 review, P1) ──────────────────────────────
  //
  // When no centre in the regional pool offers what was asked for, the
  // directory keeps its never-empty guarantee by returning the unfiltered
  // pool. The list must then say so, or the rows read as centres that can
  // deliver the treatment.
  describe("capability label", () => {
    const geoWith = (
      over: Partial<HospitalSearchGeography>
    ): HospitalSearchGeography => ({
      ...geo("distance", "Bhagalpur", "Bihar"),
      ...over,
    });

    it("says no centre offers the need when the search could not be served", () => {
      const block = build(
        [hospital({ distance_km: 52 })],
        geoWith({
          capabilityUnavailable: true,
          requiredDepartments: ["radiation_oncology"],
        })
      );
      expect(block).toContain(
        "--- Nearest cancer centres to Bhagalpur — no centre listed here offers radiation oncology ---"
      );
    });

    it("stays silent when the search was served", () => {
      const block = build(
        [hospital({ distance_km: 52 })],
        geoWith({
          capabilityUnavailable: false,
          requiredDepartments: ["radiation_oncology"],
        })
      );
      expect(block).toContain("--- Nearest cancer centres to Bhagalpur ---");
      expect(block).not.toContain("no centre listed here offers");
    });

    it("stays silent for a search that required nothing", () => {
      const block = build([hospital({ distance_km: 52 })], geoWith({}));
      expect(block).not.toContain("no centre listed here offers");
    });
  });
});
