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

  // ── Cross-border travel caveat (SCCF review) ───────────────────────────
  //
  // AGENTS.md §1.3: prompt changes under chat/ go through SCCF human/medical
  // review in their own labelled PR. This is that change. #99 keeps the
  // structural half — the stage-derived headings — and the assertion it uses
  // to keep this instruction OUT is flipped here to assert it is present.
  //
  // It exists because on the adjacent-state and unfiltered rungs the block
  // hands the model centres that can be 300–400 km from the patient, and a
  // heading is easy to paraphrase away. Without the instruction there is
  // nothing stopping the generator calling Siliguri "close by" to someone in
  // Kishanganj, or inventing a journey time the directory holds no data for.
  it("tells the model not to call a cross-border fallback nearby", () => {
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

  it("carries the same instruction on the unfiltered rung", () => {
    const block = build(
      [hospital({ city: "Kolkata", state: "West Bengal" })],
      geo("unfiltered", "Jaipur", "Rajasthan")
    );
    expect(block).toContain(
      "no cancer centre in the directory serves Jaipur directly"
    );
    expect(block).toContain('Do NOT describe them as "nearby"');
  });

  it("does not carry it when the centres really are in the patient's city or state", () => {
    for (const stage of ["city", "state"] as const) {
      const block = build([hospital()], geo(stage, "Darbhanga", "Bihar"));
      expect(block).not.toContain("no cancer centre in the directory serves");
      expect(block).not.toContain("Do NOT describe them as");
    }
  });

  it("keeps the structural travel language on the heading too", () => {
    // The heading disclosure from #99 is unchanged by this branch: the
    // instruction is additional to it, not a replacement for it.
    expect(
      build(
        [hospital({ city: "Siliguri", state: "West Bengal" })],
        geo("adjacent_state", "Kishanganj", "Bihar")
      )
    ).toContain("may involve significant travel");
    expect(
      build(
        [hospital({ city: "Kolkata", state: "West Bengal" })],
        geo("unfiltered", "Jaipur", "Rajasthan")
      )
    ).toContain("travel distance not established");

    // ...and a genuine city/state match claims nothing about travel at all.
    for (const stage of ["city", "state"] as const) {
      const block = build([hospital()], geo(stage, "Darbhanga", "Bihar"));
      expect(block).not.toContain("may involve significant travel");
      expect(block).not.toContain("travel distance not established");
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
});
