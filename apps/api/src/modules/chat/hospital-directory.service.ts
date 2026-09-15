/**
 * Hospital Directory Service
 *
 * Loads hospitals.json at startup and provides deterministic in-memory search.
 * Called by ExecutionPlannerService BEFORE any LLM generation, so hospital facts
 * are authoritative structured data — not probabilistic RAG retrieval.
 *
 * Design principles:
 *  - OnModuleInit: load once, cache forever (no async in search path)
 *  - Graceful degradation: if JSON not found, log warning and return [] (system falls back to KB markdown)
 *  - Tier D hospitals are never surfaced in search results
 *  - All filtering is additive (each filter applied in sequence)
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  hospitalDirectoryPath,
  readHospitalDirectoryFile,
  recordHospitalDirectoryStatus,
} from "../../common/hospital-directory-file";
import {
  resolveCoordsForCity,
  resolveStateForCity,
} from "./utils/location-detector";

// ─── Public Types ──────────────────────────────────────────────

export interface HospitalSearchParams {
  city?: string | null;
  state?: string | null;
  cancerType?: string | null;      // e.g. "oral", "breast", "blood", "pediatric"
  pmjayRequired?: boolean;
  affordabilityTier?: "low" | "medium" | "any";
  maxResults?: number;
  /** When false, skip appending national referral centres (e.g. already national-scope query) */
  includeNational?: boolean;
  /**
   * Departments the patient's need actually requires, independent of cancer
   * type — e.g. `["radiation_oncology"]` for someone who has been told they
   * need radiotherapy. Names are normalised, so "Radiotherapy" and
   * "radiation_oncology" are the same requirement.
   *
   * This is a HARD filter. A centre that does not have the department is never
   * offered for that need, however close it is.
   */
  requiredDepartments?: string[];
}

export interface HospitalSearchResult {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  type: string;
  tier: "A" | "B" | "C" | "D" | null;
  departments: string[];
  cost_tier: string | null;
  pmjay_empanelled: boolean | null;
  ncg_member: boolean;
  tmc_affiliated?: boolean;
  contact: { phone: string | null; address: string | null };
  key_doctors: Array<{ name: string; role: string }>;
  notes: string;
  navigation_notes: string[];
  score: number;
  /** True when this is a national referral centre surfaced alongside regional results */
  national_referral?: boolean;
  /** Geocoded latitude — absent when the record has not been geocoded */
  latitude?: number | null;
  /** Geocoded longitude — absent when the record has not been geocoded */
  longitude?: number | null;
  /** Which geocoder produced the coordinates (e.g. "nominatim") */
  geocode_source?: string | null;
  /** Which query tier answered: "name_address" | "address" | "city" */
  geocode_confidence?: string | null;
  /**
   * Straight-line kilometres from the city the patient named, populated by
   * `searchHospitals` when both ends are geocoded. Absent when there is no
   * distance signal — which callers must render as "distance unknown", never
   * as zero. This is a great-circle distance, NOT a travel distance and NOT a
   * travel time; the road route is always longer and the journey time depends
   * on connections this data says nothing about.
   */
  distance_km?: number;
}


export interface ComparisonResult {
  hospitals: HospitalSearchResult[];
  comparison: {
    costTiers: Record<string, string>;
    pmjayStatus: Record<string, boolean | null>;
    departments: Record<string, string[]>;
    tiers: Record<string, string | null>;
    scores: Record<string, number>;
  };
}

/**
 * Which rung of the geographic fallback chain produced the candidate set.
 *  - "distance"       → the patient's city is geocoded, so the whole regional
 *                       pool was ordered by real distance and no state rung ran
 *  - "city"           → hospitals in the requested city
 *  - "state"          → no hospital in that city; widened to the city's state
 *  - "adjacent_state" → none in that state either; widened to neighbouring states
 *  - "unfiltered"     → no geographic match at all; full regional pool retained
 *  - "none"           → caller supplied no city and no state
 */
export type GeographicStage =
  /** hospitals ordered by real distance from the patient's geocoded city */
  | "distance"
  | "city"
  | "state"
  | "adjacent_state"
  | "unfiltered"
  | "none";

/**
 * How far the geographic fallback chain had to widen to produce the candidate
 * set, together with the location it widened *from*.
 *
 * This travels with the results so the patient-facing layer can label the list
 * truthfully. Without it a caller cannot tell hospitals in the requested city
 * from hospitals 400km away in another state, and the prompt block ends up
 * calling both "Regional / Nearby Centres" (PR #99 review blocker).
 */
export interface HospitalSearchGeography {
  stage: GeographicStage;
  /** City the search was requested for, as supplied by the caller (trimmed). */
  requestedCity: string | null;
  /** State used for widening — supplied by the caller or resolved from the city. */
  resolvedState: string | null;
  /**
   * Normalised departments this search required — from `requiredDepartments`
   * and from the cancer type — or an empty array when it required none.
   */
  requiredDepartments?: string[];
  /**
   * True when NO centre in the regional pool offers what the search required.
   *
   * This is why the regional half of `results` is empty rather than a signal
   * that the rows in it are suspect: the incapable centres were withheld to
   * {@link HospitalSearchOutcome.nonCapableRegional}. It distinguishes "nothing
   * near you can do this" from "nothing matched at all", which a caller needs
   * in order to say something truthful.
   *
   * The never-empty guarantee is deliberately NOT extended to this case. A list
   * that cannot serve the need is worse than no list; capability-filtered
   * national referrals are the fallback.
   */
  capabilityUnavailable?: boolean;
}

/** Search results plus the geographic provenance of the candidate set. */
export interface HospitalSearchOutcome {
  /**
   * The treatment-option list, and the ONLY field a patient-facing path may
   * present as places to go for the need that was searched for.
   *
   * Every row here satisfies the search's required departments. When the
   * requirement empties a pool, that pool contributes nothing to this field —
   * it does not fall back to centres that cannot deliver the treatment.
   */
  results: HospitalSearchResult[];
  geography: HospitalSearchGeography;
  /**
   * Regional centres WITHHELD from {@link results} because not one of them
   * offers what the search required (`geography.capabilityUnavailable`).
   *
   * These are real cancer centres and they are near the patient — they simply
   * cannot deliver the treatment that was asked about. They are kept here, off
   * the treatment-option list, so a caller that wants to say something truthful
   * about them ("these centres are near you but none offers radiotherapy") can,
   * while no recommendation path can reach them by accident. Empty in the
   * normal case.
   *
   * Anything rendered from this field is a separate, SCCF-reviewed surface; it
   * is NOT a substitute for {@link results}.
   */
  nonCapableRegional: HospitalSearchResult[];
}

export interface VisitPrep {
  hospitalId: string;
  hospitalName: string;
  documents: string[];
  logisticsNotes: string[];
  financialNotes: string[];
  navigationNotes: string[];
  disclaimer: string;
}

// ─── Service ───────────────────────────────────────────────────

// ─── Department names ──────────────────────────────────────────────────────
//
// `hospitals.json` spells departments two ways, because it was assembled from
// two research passes: snake_case (`radiation_oncology`) on 12 records and
// Title Case prose (`Radiation Oncology`, `Radiotherapy`, `Head & Neck
// Oncology`) on the other 71. The capability filter compared raw strings, so
// AIIMS Patna — which lists `Radiotherapy` — never matched a radiotherapy
// requirement, and `gynaecology` and `haematology` (the names the cancer-type
// map used) appear in NO record at all in that spelling, so those filters
// matched nothing and were silently skipped by the graceful-degradation branch.
//
// Both sides are normalised through this table before comparison. Synonyms map
// to one canonical name; anything unrecognised keeps its normalised form rather
// than being dropped, so a new department name fails closed (it simply does not
// match a requirement) instead of matching everything.

/** Collapse spelling/case/punctuation differences to one comparable token. */
function normaliseDepartmentToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Different names for the same clinical capability. */
const DEPARTMENT_SYNONYMS: Record<string, string> = {
  // Radiation. "Radiotherapy" is the department name AIIMS Patna uses.
  radiotherapy: "radiation_oncology",
  radiation_therapy: "radiation_oncology",
  radiation_oncology: "radiation_oncology",
  // Head and neck
  head_and_neck_oncology: "head_and_neck",
  head_and_neck_surgery: "head_and_neck",
  head_and_neck: "head_and_neck",
  // Gynaecologic
  gynaecologic_oncology: "gynaec_oncology",
  gynecologic_oncology: "gynaec_oncology",
  gynaec_oncology: "gynaec_oncology",
  gynec_oncology: "gynaec_oncology",
  gynaecology: "gynaec_oncology",
  gynecology: "gynaec_oncology",
  // Blood
  haematology: "hemato_oncology",
  hematology: "hemato_oncology",
  haemato_oncology: "hemato_oncology",
  hemato_oncology: "hemato_oncology",
  // Paediatric
  paediatric_oncology: "pediatric_oncology",
  pediatric_oncology: "pediatric_oncology",
  // Palliative
  palliative_medicine: "palliative_care",
  palliative_care: "palliative_care",
  // Straightforward case variants
  medical_oncology: "medical_oncology",
  surgical_oncology: "surgical_oncology",
  uro_oncology: "uro_oncology",
  urologic_oncology: "uro_oncology",
  nuclear_medicine: "nuclear_medicine",
  neuro_oncology: "neuro_oncology",
  neurosurgery_oncology: "neuro_oncology",
  bone_marrow_transplant: "bone_marrow_transplant",
};

/** Canonical name for a department as written anywhere in the directory. */
export function normaliseDepartment(raw: string): string {
  const token = normaliseDepartmentToken(raw);
  return DEPARTMENT_SYNONYMS[token] ?? token;
}

/**
 * True when `hospitalDepartments` satisfies EVERY requirement group.
 *
 * A requirement group is an "any of these departments will do" set — the
 * departments that treat a cancer type, say. Two groups therefore mean two
 * separate things the centre must be able to do, and they are ANDed.
 *
 * This matters for the common navigation query. "Bhagalpur mein oral cancer ki
 * radiotherapy kahan hoti hai" produces a cancer-type group
 * (head_and_neck / surgical_oncology / radiation_oncology) and a stated-need
 * group (radiation_oncology). Flattened into one set and matched with `some`,
 * surgery-only Healing Touch satisfies it through `surgical_oncology` and is
 * offered to a patient who came asking for radiotherapy. Kept apart, the
 * stated need has to be met on its own terms.
 */
function meetsAllRequirements(
  hospitalDepartments: string[],
  groups: string[][]
): boolean {
  if (groups.length === 0) return true;
  const have = new Set(hospitalDepartments.map(normaliseDepartment));
  return groups.every((group) =>
    group.some((d) => have.has(normaliseDepartment(d)))
  );
}

// ─── Distance ──────────────────────────────────────────────────────────────

/** Mean Earth radius in kilometres (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two points, in kilometres.
 *
 * This is a STRAIGHT-LINE distance. The road route is always longer, and the
 * journey time depends on rail and road connections this data says nothing
 * about — Darbhanga to Muzaffarpur is well connected, while other 100km hops in
 * the same region are four hours. Use it to ORDER centres; never render it as a
 * travel time (issue #103).
 */
export function haversineKm(
  a: [number, number],
  b: [number, number]
): number {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A hospital's coordinates, or null when it has not been geocoded. */
function hospitalCoords(h: HospitalSearchResult): [number, number] | null {
  return typeof h.latitude === "number" && typeof h.longitude === "number"
    ? [h.latitude, h.longitude]
    : null;
}

/**
 * Nearest first, directory `score` breaking ties.
 *
 * A hospital with no coordinates sorts LAST rather than first: an unknown
 * distance is not a short one, and the alternative — treating absent as zero —
 * would put exactly the records we know least about at the top of a list a
 * patient uses to decide where to travel.
 *
 * The score tiebreak matters more than it looks. Several centres share one
 * city, so they share a distance to the decimal; without it the order within a
 * city would be whatever the file happened to list first, and a tier-A TMC unit
 * could fall below a tier-C private hospital on the same street.
 */
function compareByDistanceThenScore(
  a: HospitalSearchResult,
  b: HospitalSearchResult
): number {
  const da = a.distance_km ?? Number.POSITIVE_INFINITY;
  const db = b.distance_km ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return b.score - a.score;
}

/** National states — queries for these locations don't need national referrals appended */
const NATIONAL_SCOPE_STATES = new Set([
  "Delhi", "Maharashtra", "Karnataka", "Tamil Nadu", "Telangana",
  "Gujarat", "Punjab", "Haryana", "Chandigarh",
]);

@Injectable()
export class HospitalDirectoryService implements OnModuleInit {
  private readonly logger = new Logger(HospitalDirectoryService.name);
  /** Regional hospitals: East India + Uttar Pradesh + Northeast */
  private hospitals: HospitalSearchResult[] = [];
  /** National referral centres: major cancer hospitals patients travel to from anywhere in India */
  private nationalHospitals: HospitalSearchResult[] = [];

  /** Cancer type keyword → departments that treat it */
  private readonly CANCER_TYPE_DEPARTMENTS: Record<string, string[]> = {
    oral: ["head_and_neck", "surgical_oncology", "radiation_oncology"],
    head_neck: ["head_and_neck", "surgical_oncology", "radiation_oncology"],
    breast: ["medical_oncology", "surgical_oncology"],
    cervical: ["gynaecology", "surgical_oncology", "radiation_oncology"],
    gynae: ["gynaecology", "surgical_oncology"],
    blood: ["haematology", "medical_oncology"],
    leukemia: ["haematology", "pediatric_oncology"],
    lymphoma: ["haematology", "medical_oncology"],
    pediatric: ["pediatric_oncology"],
    lung: ["medical_oncology", "surgical_oncology", "radiation_oncology"],
    gi: ["surgical_oncology", "medical_oncology"],
    stomach: ["surgical_oncology", "medical_oncology"],
    prostate: ["uro_oncology", "surgical_oncology", "radiation_oncology"],
    bone: ["surgical_oncology"],
    skin: ["surgical_oncology"],
  };

  /** States whose patients can plausibly reach adjacent-state hospitals */
  private readonly STATE_ADJACENCY: Record<string, string[]> = {
    "Bihar": ["Jharkhand", "West Bengal", "Uttar Pradesh"],
    "Jharkhand": ["Bihar", "West Bengal", "Odisha"],
    "West Bengal": ["Bihar", "Jharkhand", "Odisha"],
    "Sikkim": ["West Bengal"],
    "Odisha": ["West Bengal", "Jharkhand"],
  };

  // ─── Lifecycle ────────────────────────────────────────────────

  onModuleInit(): void {
    // Canonical file + resolution rules live in common/hospital-directory-file.ts
    // (shared with WhatsAppNavigatorFlowService). On Cloud Run cwd is /app and
    // cloudbuild's stage-hospitals step materialises the file as a regular copy.
    const jsonPath = hospitalDirectoryPath();
    try {
      const file = readHospitalDirectoryFile();
      const allHospitals = file.hospitals as (HospitalSearchResult & { national_referral?: boolean })[];
      const active = allHospitals.filter((h) => h.tier !== "D");
      this.nationalHospitals = active
        .filter((h) => h.national_referral === true)
        .map((h) => ({ ...h, national_referral: true as const }));
      this.hospitals = active.filter((h) => h.national_referral !== true);
      recordHospitalDirectoryStatus({ loaded: true, count: allHospitals.length, path: file.path, error: null });
      this.logger.log({
        event: "hospital_directory_loaded",
        path: file.path,
        resolvedVia: file.resolvedVia,
        total: allHospitals.length,
        regional: this.hospitals.length,
        national: this.nationalHospitals.length,
        tierDFiltered: allHospitals.length - active.length,
      });
    } catch (err: any) {
      // ERROR, not WARN: with an empty directory every hospital-navigation answer
      // silently loses the curated, scored, PMJAY-flagged centres (issue #123 —
      // this was the production state for ten days across five revisions).
      // /v1/health reports status "degraded" from the recorded status.
      recordHospitalDirectoryStatus({ loaded: false, count: 0, path: jsonPath, error: String(err?.message ?? err) });
      this.logger.error({
        event: "hospital_directory_not_found",
        path: jsonPath,
        error: err?.message,
        message: "Hospital directory unavailable — falling back to KB markdown for navigation queries",
      });
      this.hospitals = [];
      this.nationalHospitals = [];
    }
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Resolve the geographic candidate set for a search, degrading in steps
   * instead of ever returning an empty set:
   *
   *   1. exact city   — hospitals whose city matches the requested city
   *   2. same state   — the city has no oncology centre; widen to its state
   *   3. adjacent     — the state has none either; widen to neighbouring states
   *   4. unfiltered   — no geographic match anywhere; keep the full regional pool
   *
   * Why this exists (issue #95): the city filter used to assign its result
   * unconditionally, making it the only filter in `searchHospitals` without
   * graceful degradation, and it was reached via `else if` so a query that
   * carried a city never consulted the state pool. Bihar has active oncology
   * centres in exactly three cities (Patna, Muzaffarpur, Bhagalpur), so every
   * other district — the whole of North Bihar, Darbhanga included — produced
   * zero candidates. The caller then had no directory rows at all and the
   * answer was filled from elsewhere, which is how a Darbhanga patient was
   * pointed at Patna while HBCH&RC Muzaffarpur (a TMC unit, score 90, the
   * highest-scoring centre in Bihar) was never surfaced.
   *
   * This chain is now the FALLBACK path only. When the patient's city is in the
   * geocoded `INDIAN_CITIES` table, `searchHospitals` orders the whole regional
   * pool by real distance instead (stage "distance") and no state rung runs at
   * all — because a state border is an administrative fact, not a travel
   * burden. Kishanganj is 83km from Siliguri in West Bengal and 284km from
   * Patna in its own state; Buxar is nearer Varanasi in Uttar Pradesh than
   * Patna. The rungs below still run for a city the table does not know, where
   * there is no distance signal and administrative proximity is the only
   * geography available (issue #103).
   */
  private resolveGeographicCandidates(
    pool: HospitalSearchResult[],
    params: HospitalSearchParams
  ): { results: HospitalSearchResult[]; stage: GeographicStage } {
    const city = params.city?.trim() || null;
    // A caller may pass a city without a state (public API). Recover the state
    // from the canonical city table rather than losing the geography.
    const state = params.state?.trim() || resolveStateForCity(city);

    if (!city && !state) {
      return { results: pool, stage: "none" };
    }

    // ── Stage 1: exact city ──
    if (city) {
      const cityLower = city.toLowerCase();
      const cityFiltered = pool.filter(
        (h) =>
          h.city.toLowerCase().includes(cityLower) ||
          cityLower.includes(h.city.toLowerCase())
      );
      if (cityFiltered.length > 0) {
        return { results: cityFiltered, stage: "city" };
      }
    }

    if (state) {
      // ── Stage 2: same state ──
      const stateFiltered = pool.filter((h) => h.state === state);
      if (stateFiltered.length > 0) {
        if (city) {
          this.logger.log({
            event: "hospital_search_geographic_fallback",
            stage: "state",
            requestedCity: city,
            resolvedState: state,
            count: stateFiltered.length,
            reason:
              "no directory hospital in the requested city — widened to the state pool",
          });
        }
        return { results: stateFiltered, stage: "state" };
      }

      // ── Stage 3: adjacent states ──
      const neighbors = this.STATE_ADJACENCY[state] ?? [];
      if (neighbors.length > 0) {
        const adjacent = pool.filter((h) => neighbors.includes(h.state));
        if (adjacent.length > 0) {
          this.logger.log({
            event: "hospital_search_adjacency_fallback",
            requestedCity: city,
            requestedState: state,
            foundIn: neighbors,
            count: adjacent.length,
          });
          return { results: adjacent, stage: "adjacent_state" };
        }
      }
    }

    // ── Stage 4: no geographic match — keep the pool (same graceful
    // degradation the cancer-type, PMJAY and affordability filters use) ──
    this.logger.log({
      event: "hospital_search_geographic_fallback",
      stage: "unfiltered",
      requestedCity: city,
      requestedState: state,
      count: pool.length,
      reason:
        "no match at city, state or adjacent-state level — full regional pool retained",
    });
    return { results: pool, stage: "unfiltered" };
  }

  /**
   * Search hospitals with additive filters applied in order:
   * 1. Geographic (city → state → adjacent state → unfiltered fallback chain)
   * 2. Cancer type → departments
   * 3. PMJAY filter
   * 4. Affordability tier
   * 5. Sort by score desc, limit maxResults
   *
   * The geography, PMJAY and affordability filters degrade gracefully: when one
   * would empty the candidate set it is skipped and the previous set is kept.
   * The capability filter does NOT — a centre that cannot deliver the treatment
   * the search required is never returned for it, even when dropping it leaves
   * nothing regional. Those rows are available on
   * {@link HospitalSearchOutcome.nonCapableRegional} instead, which this
   * `results`-only wrapper discards.
   */
  searchHospitals(params: HospitalSearchParams): HospitalSearchResult[] {
    return this.searchHospitalsWithGeography(params).results;
  }

  /**
   * Same search as {@link searchHospitals}, but also returns which rung of the
   * geographic fallback chain produced the candidate set.
   *
   * Callers that render results to a patient (or to the LLM prompt) must use
   * this variant: an "adjacent state" or "unfiltered" set must never be
   * labelled as nearby. `searchHospitals` remains for callers that only need
   * the rows.
   */
  searchHospitalsWithGeography(params: HospitalSearchParams): HospitalSearchOutcome {
    const requestedCity = params.city?.trim() || null;
    const resolvedState = params.state?.trim() || resolveStateForCity(requestedCity);

    if (this.hospitals.length === 0) {
      return {
        results: [],
        geography: {
          stage: "none",
          requestedCity,
          resolvedState,
          requiredDepartments: [],
          capabilityUnavailable: false,
        },
        nonCapableRegional: [],
      };
    }

    let results = [...this.hospitals];

    // ── 1. Capability — a HARD filter, and it runs FIRST ──
    //
    // Distance alone is unsafe, and the directory proves it: Healing Touch
    // Bhagalpur (tier C) is the nearest centre to eastern Bihar, and its own
    // record reads "No radiation or medical oncology — refer to Patna or
    // Muzaffarpur for those needs." Nearest-by-km would route a radiotherapy
    // patient to a centre that cannot deliver it. So capability is resolved
    // before any geography is considered, and a centre that cannot serve the
    // need is dropped however near it is — even when dropping it empties the
    // city.
    //
    // The filter wins even when it empties the WHOLE regional pool — nothing in
    // East India offers what was asked for. An earlier revision failed OPEN
    // there: it kept the unfiltered pool in `results`, flagged
    // `capabilityUnavailable`, and left the patient-facing layer to append a
    // heading saying none of these centres can help. That made a safety
    // property depend on the generator honouring a label while being handed the
    // incapable centres as its authoritative hospital list (PR #148 review,
    // P0). Structure now carries what wording was carrying: those rows leave
    // `results` entirely and move to `nonCapableRegional` (see step 6), so no
    // recommendation path can offer them for a need they cannot meet. The
    // separately capability-filtered national referrals still stand, so a
    // patient who needs radiotherapy in a region without it is pointed at a
    // centre that has it rather than at nothing.
    const requirementGroups = this.resolveDepartmentRequirements(params);
    const requiredDepartments = requirementGroups.flat();
    let capabilityUnavailable = false;
    if (requirementGroups.length > 0) {
      const before = results.length;
      const capable = results.filter((h) =>
        meetsAllRequirements(h.departments, requirementGroups)
      );
      if (capable.length > 0) {
        results = capable;
      } else {
        capabilityUnavailable = true;
        this.logger.warn({
          event: "hospital_capability_filter_empty",
          requiredDepartments,
          cancerType: params.cancerType ?? null,
          candidatesBefore: before,
          reason:
            "no centre in the regional pool offers the required department — withholding the regional rows from the treatment-option list (nonCapableRegional) and falling back to capability-filtered national referrals",
        });
      }
    }

    // ── 2. Geography ──
    //
    // When the patient's city is geocoded, order the whole pool by real
    // distance: no state rung runs, because a border is not a travel burden
    // (issue #103). Otherwise fall back to #99's widening chain, which is the
    // only geography available for a city the table does not know.
    const origin = resolveCoordsForCity(requestedCity);
    let stage: GeographicStage;

    // Distance ordering needs BOTH ends geocoded. An origin alone is not a
    // distance signal, so if no candidate carries coordinates we must not claim
    // to have ordered by distance — fall back to the administrative chain
    // rather than head a list "Nearest centres to X" with nothing measured.
    const withDistance = origin
      ? results.map((h) => {
          const coords = hospitalCoords(h);
          return coords
            ? { ...h, distance_km: haversineKm(origin, coords) }
            : { ...h };
        })
      : [];
    const measured = withDistance.filter(
      (h) => typeof h.distance_km === "number"
    ).length;

    if (origin && measured > 0) {
      stage = "distance";
      results = withDistance;
      this.logger.log({
        event: "hospital_search_distance_ordering",
        requestedCity,
        resolvedState,
        count: results.length,
        measured,
        ungeocoded: results.length - measured,
      });
    } else {
      const geographic = this.resolveGeographicCandidates(results, params);
      results = geographic.results;
      stage = geographic.stage;
    }

    const geography: HospitalSearchGeography = {
      stage,
      requestedCity,
      resolvedState,
      requiredDepartments,
      capabilityUnavailable,
    };

    // ── 3. PMJAY filter ──
    if (params.pmjayRequired) {
      const pmjayFiltered = results.filter(
        (h) =>
          h.pmjay_empanelled === true ||
          h.type.includes("Government") ||
          h.cost_tier === "Low"
      );
      if (pmjayFiltered.length > 0) {
        results = pmjayFiltered;
      }
    }

    // ── 4. Affordability filter ──
    if (params.affordabilityTier && params.affordabilityTier !== "any") {
      if (params.affordabilityTier === "low") {
        const lowFiltered = results.filter(
          (h) =>
            h.cost_tier === "Low" ||
            h.type.includes("Government") ||
            h.type.includes("Trust") ||
            h.type.includes("TMC")
        );
        if (lowFiltered.length > 0) results = lowFiltered;
      } else if (params.affordabilityTier === "medium") {
        const medFiltered = results.filter(
          (h) => h.cost_tier === "Low" || h.cost_tier === "Medium"
        );
        if (medFiltered.length > 0) results = medFiltered;
      }
    }

    // ── 5. Sort + limit ──
    results.sort(
      stage === "distance" ? compareByDistanceThenScore : (a, b) => b.score - a.score
    );
    const regionalResults = results.slice(0, params.maxResults ?? 3);

    // ── 6. Fail closed on capability ──
    //
    // If not one regional centre can deliver what the search required, those
    // rows are not treatment options and must not be returned as if they were.
    // They move to `nonCapableRegional`, a field no recommendation path reads,
    // and the regional half of `results` is empty. The national referral pool
    // below is filtered by the same requirement, so what the patient is offered
    // is always a centre that can actually do the thing.
    const capableRegional = capabilityUnavailable ? [] : regionalResults;
    const nonCapableRegional = capabilityUnavailable ? regionalResults : [];

    // ── 7. Append national referral centres ──
    // Skip if: explicitly disabled, or the query is already national-scope
    // (i.e. user asked about Delhi/Mumbai/Bangalore directly)
    const skipNational =
      params.includeNational === false ||
      NATIONAL_SCOPE_STATES.has(params.state ?? "") ||
      NATIONAL_SCOPE_STATES.has(params.city ?? "");

    if (skipNational || this.nationalHospitals.length === 0) {
      return { results: capableRegional, geography, nonCapableRegional };
    }

    // The same hard capability rule applies to the national pool: a referral
    // centre that cannot serve the need is not a referral.
    let nationalPool = [...this.nationalHospitals];
    if (requirementGroups.length > 0) {
      nationalPool = nationalPool.filter((h) =>
        meetsAllRequirements(h.departments, requirementGroups)
      );
    }
    // When PMJAY required, prefer government/low-cost national centres
    if (params.pmjayRequired) {
      const govNational = nationalPool.filter(
        (h) =>
          h.pmjay_empanelled === true ||
          h.type.includes("Government") ||
          h.cost_tier === "Low"
      );
      if (govNational.length > 0) nationalPool = govNational;
    }

    nationalPool.sort((a, b) => b.score - a.score);
    const nationalResults = nationalPool
      .slice(0, 2)
      .map((h) => ({ ...h, national_referral: true as const }));

    this.logger.debug({
      event: "national_referrals_appended",
      count: nationalResults.length,
      ids: nationalResults.map((h) => h.id),
    });

    return {
      results: [...capableRegional, ...nationalResults],
      geography,
      nonCapableRegional,
    };
  }

  /**
   * What this search requires, as one "any of these will do" group per distinct
   * requirement — the explicitly stated treatment need, and whatever the cancer
   * type implies. Normalised and deduplicated, so "Radiotherapy" and
   * "radiation_oncology" collapse to one requirement.
   *
   * The groups stay apart rather than being merged into one set: see
   * {@link meetsAllRequirements} for why merging quietly re-admits a centre
   * that cannot deliver the treatment the patient named.
   */
  private resolveDepartmentRequirements(
    params: HospitalSearchParams
  ): string[][] {
    const groups: string[][] = [];

    const stated = [
      ...new Set(
        (params.requiredDepartments ?? []).map((d) => normaliseDepartment(d))
      ),
    ];
    if (stated.length > 0) groups.push(stated);

    const byCancerType = [
      ...new Set(
        (params.cancerType
          ? (this.CANCER_TYPE_DEPARTMENTS[params.cancerType] ?? [])
          : []
        ).map((d) => normaliseDepartment(d))
      ),
    ];
    if (byCancerType.length > 0) groups.push(byCancerType);

    return groups;
  }

  /**
   * Fetch a single hospital by its stable ID (checks both regional and national pools).
   */
  getHospitalById(id: string): HospitalSearchResult | null {
    return (
      this.hospitals.find((h) => h.id === id) ??
      this.nationalHospitals.find((h) => h.id === id) ??
      null
    );
  }

  /**
   * Return side-by-side comparison of up to 4 hospitals.
   */
  compareHospitals(ids: string[]): ComparisonResult {
    const hospitals = ids
      .slice(0, 4)
      .map((id) => this.getHospitalById(id))
      .filter((h): h is HospitalSearchResult => h !== null);

    const costTiers: Record<string, string> = {};
    const pmjayStatus: Record<string, boolean | null> = {};
    const departments: Record<string, string[]> = {};
    const tiers: Record<string, string | null> = {};
    const scores: Record<string, number> = {};

    for (const h of hospitals) {
      costTiers[h.short_name] = h.cost_tier ?? "Unknown";
      pmjayStatus[h.short_name] = h.pmjay_empanelled;
      departments[h.short_name] = h.departments;
      tiers[h.short_name] = h.tier;
      scores[h.short_name] = h.score;
    }

    return {
      hospitals,
      comparison: { costTiers, pmjayStatus, departments, tiers, scores },
    };
  }

  /**
   * Generate standard visit preparation checklist for a hospital.
   */
  generateVisitPrep(hospitalId: string): VisitPrep | null {
    const hospital = this.getHospitalById(hospitalId);
    if (!hospital) return null;

    const STANDARD_DISCLAIMER =
      "Hospital services, doctors, costs, and PM-JAY availability can change. Please confirm directly with the hospital before travel or payment.";

    // Base documents
    const documents = [
      "Government ID (Aadhaar/Voter ID)",
      "All previous reports and scans",
      "Referral letter if required",
      "PMJAY/Ayushman card if applicable",
      "Prescription history",
    ];

    // Logistics notes — extract lodging/dharmashala info from notes
    const logisticsNotes: string[] = [];
    const notesLower = hospital.notes.toLowerCase();
    if (notesLower.includes("dharmashala") || notesLower.includes("dharamshala")) {
      logisticsNotes.push("Dharmashala/patient accommodation available nearby — confirm before travel");
    }
    if (notesLower.includes("lodging") || notesLower.includes("guest house") || notesLower.includes("guesthouse")) {
      logisticsNotes.push("Patient lodging available nearby — confirm availability before travel");
    }
    if (hospital.type.includes("Government") || hospital.type.includes("TMC")) {
      logisticsNotes.push("Government/Trust hospital — typically no advance payment required for initial OPD");
    }

    // Financial notes
    const financialNotes: string[] = [];
    if (hospital.pmjay_empanelled === true) {
      financialNotes.push("PM-JAY (Ayushman Bharat) accepted — bring Ayushman card and Aadhaar");
      financialNotes.push("PM-JAY covers up to ₹5 lakh per year for inpatient care");
    } else if (hospital.cost_tier === "Low" || hospital.type.includes("Government")) {
      financialNotes.push("Government rates apply — treatment costs significantly lower than private hospitals");
      financialNotes.push("Check with hospital help desk about state government health schemes");
    }
    if (hospital.cost_tier === "Medium" || hospital.cost_tier === "High") {
      financialNotes.push("Ask the hospital social worker about financial assistance or instalment options");
    }

    // Navigation notes from the hospital record
    const navigationNotes =
      hospital.navigation_notes.length > 0
        ? [...hospital.navigation_notes]
        : [STANDARD_DISCLAIMER];

    return {
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      documents,
      logisticsNotes,
      financialNotes,
      navigationNotes,
      disclaimer: STANDARD_DISCLAIMER,
    };
  }

  /**
   * True when the hospital directory was loaded successfully.
   * Used by ExecutionPlannerService to decide whether to attempt structured lookup.
   */
  isLoaded(): boolean {
    return this.hospitals.length > 0;
  }
}
