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
import * as fs from "fs";
import * as path from "path";

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
    // Single canonical path: apps/api/data/hospitals.json is a symlink to
    // apps/landing/src/content/hospitals.json.
    //   - Jest: process.cwd() = apps/api/
    //   - Cloud Run: process.cwd() = /app  (cloudbuild stages the file there)
    const jsonPath = path.resolve(process.cwd(), "data/hospitals.json");

    try {
      const raw = fs.readFileSync(jsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      const allHospitals: (HospitalSearchResult & { national_referral?: boolean })[] =
        parsed.hospitals ?? [];
      const active = allHospitals.filter((h) => h.tier !== "D");
      this.nationalHospitals = active
        .filter((h) => h.national_referral === true)
        .map((h) => ({ ...h, national_referral: true as const }));
      this.hospitals = active.filter((h) => h.national_referral !== true);
      this.logger.log({
        event: "hospital_directory_loaded",
        path: jsonPath,
        total: allHospitals.length,
        regional: this.hospitals.length,
        national: this.nationalHospitals.length,
        tierDFiltered: allHospitals.length - active.length,
      });
    } catch (err: any) {
      this.logger.warn({
        event: "hospital_directory_not_found",
        path: jsonPath,
        message: "Hospital directory unavailable — falling back to KB markdown for navigation queries",
      });
      this.hospitals = [];
      this.nationalHospitals = [];
    }
  }

  // ─── Public API ────────────────────────────────────────────────

  /**
   * Search hospitals with additive filters applied in order:
   * 1. Geographic (city/state) with adjacency fallback
   * 2. Cancer type → departments
   * 3. PMJAY filter
   * 4. Affordability tier
   * 5. Sort by score desc, limit maxResults
   */
  searchHospitals(params: HospitalSearchParams): HospitalSearchResult[] {
    if (this.hospitals.length === 0) return [];

    let results = [...this.hospitals];

    // ── 1. Geographic filter ──
    if (params.city) {
      const cityLower = params.city.toLowerCase();
      const cityFiltered = results.filter(
        (h) =>
          h.city.toLowerCase().includes(cityLower) ||
          cityLower.includes(h.city.toLowerCase())
      );
      results = cityFiltered;
    } else if (params.state) {
      const stateFiltered = results.filter((h) => h.state === params.state);
      if (stateFiltered.length > 0) {
        results = stateFiltered;
      } else {
        // Adjacency fallback: try neighboring states
        const neighbors = this.STATE_ADJACENCY[params.state] ?? [];
        if (neighbors.length > 0) {
          results = results.filter((h) => neighbors.includes(h.state));
          if (results.length > 0) {
            this.logger.debug({
              event: "hospital_search_adjacency_fallback",
              requestedState: params.state,
              foundIn: neighbors,
              count: results.length,
            });
          }
        }
      }
    }

    // ── 2. Cancer type filter ──
    if (params.cancerType) {
      const targetDepts = this.CANCER_TYPE_DEPARTMENTS[params.cancerType] ?? [];
      if (targetDepts.length > 0) {
        const typeFiltered = results.filter((h) =>
          h.departments.some((d) => targetDepts.includes(d))
        );
        // Graceful degradation: if no match, skip this filter
        if (typeFiltered.length > 0) {
          results = typeFiltered;
        } else {
          this.logger.debug({
            event: "hospital_cancer_type_filter_skipped",
            cancerType: params.cancerType,
            reason: "no results after filter — graceful degradation",
          });
        }
      }
    }

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
    results.sort((a, b) => b.score - a.score);
    const regionalResults = results.slice(0, params.maxResults ?? 3);

    // ── 6. Append national referral centres ──
    // Skip if: explicitly disabled, or the query is already national-scope
    // (i.e. user asked about Delhi/Mumbai/Bangalore directly)
    const skipNational =
      params.includeNational === false ||
      NATIONAL_SCOPE_STATES.has(params.state ?? "") ||
      NATIONAL_SCOPE_STATES.has(params.city ?? "");

    if (skipNational || this.nationalHospitals.length === 0) {
      return regionalResults;
    }

    // Filter national pool by cancer type if specified, then pick top 2 by score
    let nationalPool = [...this.nationalHospitals];
    if (params.cancerType) {
      const targetDepts = this.CANCER_TYPE_DEPARTMENTS[params.cancerType] ?? [];
      if (targetDepts.length > 0) {
        const typeFiltered = nationalPool.filter((h) =>
          h.departments.some((d) => targetDepts.includes(d))
        );
        if (typeFiltered.length > 0) nationalPool = typeFiltered;
      }
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

    return [...regionalResults, ...nationalResults];
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
