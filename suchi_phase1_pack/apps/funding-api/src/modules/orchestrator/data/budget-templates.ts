/**
 * Budget templates and unit cost benchmarks for Diksha Foundation.
 *
 * Derived from ProgramActivity cost data in the activity registry
 * plus standard Bihar NGO operating benchmarks (FY 2024-25).
 *
 * Used by BudgetEnvelopeService to generate realistic cost estimates
 * and flag outliers.
 *
 * KHEL centre validated cost: ~₹30L/centre/year (3 centres = ~₹90L).
 * Template produces ₹28-32L/centre depending on beneficiary count.
 */

export interface UnitCostBenchmark {
  min: number;
  max: number;
  typical: number;
  unit: string;
}

/** Bihar NGO unit cost benchmarks (INR), updated FY 2024-25 */
export const UNIT_COST_BENCHMARKS: Record<string, UnitCostBenchmark> = {
  // Staff — KHEL validated rates
  "Fellow Teacher stipend": { min: 12000, max: 22000, typical: 18000, unit: "per month" },
  "Center Coordinator salary": { min: 20000, max: 35000, typical: 28000, unit: "per month" },
  "Sports Coach / Facilitator salary": { min: 12000, max: 22000, typical: 15000, unit: "per month" },
  "Young Leader stipend": { min: 4000, max: 8000, typical: 6000, unit: "per month" },
  "Computer Instructor salary": { min: 12000, max: 22000, typical: 18000, unit: "per month" },
  "Program Manager salary": { min: 30000, max: 50000, typical: 38000, unit: "per month" },
  "M&E Officer salary": { min: 18000, max: 30000, typical: 22000, unit: "per month" },
  "SEL / Life Skills Facilitator salary": { min: 10000, max: 20000, typical: 14000, unit: "per month" },

  // Program Materials
  "Sports equipment bundle (per centre)": { min: 30000, max: 60000, typical: 50000, unit: "per centre" },
  "Educational materials (per student per year)": { min: 800, max: 2000, typical: 1500, unit: "per student" },
  "Digital devices / IT equipment (per centre)": { min: 50000, max: 200000, typical: 100000, unit: "per centre" },
  "Stationery and supplies (per centre per month)": { min: 2000, max: 5000, typical: 3000, unit: "per month" },

  // Training
  "External trainer workshop (per day)": { min: 15000, max: 40000, typical: 25000, unit: "per day" },
  "Staff training program (per person per year)": { min: 8000, max: 18000, typical: 12000, unit: "per person" },
  "Safeguarding / first-aid training": { min: 3000, max: 8000, typical: 5000, unit: "per session" },

  // Nutrition
  "Nutritious meal (per child per day)": { min: 25, max: 50, typical: 35, unit: "per day" },
  "Mid-day snack / refreshments": { min: 10, max: 25, typical: 15, unit: "per day" },

  // Events
  "Inter-centre festival / league (per event)": { min: 20000, max: 50000, typical: 35000, unit: "per event" },
  "Parent-teacher meeting (per centre per session)": { min: 2000, max: 5000, typical: 3000, unit: "per session" },
  "Community event / awareness drive": { min: 5000, max: 15000, typical: 8000, unit: "per event" },

  // Transport & Safety
  "Girls safe participation support (per centre per month)": {
    min: 8000,
    max: 20000,
    typical: 12000,
    unit: "per month",
  },
  "Student transport / field visits": { min: 3000, max: 10000, typical: 5000, unit: "per trip" },

  // M&E
  "M&E tools and data systems (per year)": { min: 50000, max: 120000, typical: 80000, unit: "per year" },
  "Assessment materials (per centre per year)": { min: 8000, max: 20000, typical: 12000, unit: "per year" },

  // Technology (AI/software product builds)
  "Technology vendor / engineering team": { min: 300000, max: 2000000, typical: 600000, unit: "per year" },
  "AI platform subscription (Glific + Gemini)": { min: 50000, max: 300000, typical: 120000, unit: "per year" },
  "Cloud infrastructure (Google Cloud)": { min: 30000, max: 200000, typical: 80000, unit: "per year" },
  "Curriculum and content development": { min: 150000, max: 800000, typical: 350000, unit: "one-time" },
  "Field coordinator (pilot deployment)": { min: 180000, max: 360000, typical: 240000, unit: "per year" },
  "Device and connectivity support": { min: 200, max: 1000, typical: 500, unit: "per beneficiary" },
  "Post-launch maintenance and support": { min: 50000, max: 300000, typical: 120000, unit: "per year" },
  "Data privacy and safeguarding setup": { min: 30000, max: 150000, typical: 60000, unit: "one-time" },
  "Pilot training and adoption (per centre)": { min: 15000, max: 60000, typical: 30000, unit: "per centre" },

  // Overhead / Facilities
  "Rent / facility maintenance (per centre per month)": {
    min: 8000,
    max: 25000,
    typical: 15000,
    unit: "per month",
  },
  "Utilities (per centre per month)": { min: 2000, max: 6000, typical: 3500, unit: "per month" },
  "Communication / internet (per centre per month)": { min: 1500, max: 4000, typical: 2500, unit: "per month" },
};

/** Standard budget category distribution ranges for Bihar NGO grants */
export const BUDGET_CATEGORY_DISTRIBUTION: Record<string, { min: number; max: number; label: string }> = {
  staff: { min: 0.40, max: 0.60, label: "Human Resources" },
  programMaterials: { min: 0.10, max: 0.20, label: "Program Materials & Equipment" },
  training: { min: 0.03, max: 0.10, label: "Training & Capacity Building" },
  events: { min: 0.03, max: 0.10, label: "Events & Community Engagement" },
  transport: { min: 0.03, max: 0.08, label: "Transport & Safety" },
  mAndE: { min: 0.03, max: 0.08, label: "Monitoring & Evaluation" },
  administrative: { min: 0.05, max: 0.15, label: "Administrative & Overhead" },
  contingency: { min: 0.03, max: 0.05, label: "Contingency" },
};

/**
 * Standard line item templates by program type.
 * The budget service selects the matching template based on opportunity themes.
 *
 * BUDGET ANCHOR PRINCIPLE
 * -----------------------
 * Total budget = costPerChildPerYearINR × beneficiaryCount × (durationMonths / 12)
 * Line items are generated bottom-up then proportionally scaled to hit this anchor.
 *
 * Intensity tiers (Bihar NGO validated, FY 2024-25):
 *   daily    — Mon–Sat full-day engagement (e.g. KHEL):       ₹20,000/child/yr
 *   frequent — 4-5x/week structured programme:               ₹15,000/child/yr
 *   weekly   — 2-3x/week (e.g. Empowering Futures girls):    ₹10,000/child/yr
 *   periodic — monthly camps / once-a-week light touch:       ₹5,000/child/yr
 */
export interface BudgetTemplate {
  programType: string;
  matchThemes: string[];
  /** How often beneficiaries engage with the programme — drives cost per child. */
  programIntensity: "daily" | "frequent" | "weekly" | "periodic";
  /** Primary cost anchor for field programmes: total budget = this × beneficiaryCount × years.
   * For tech-product templates, use baseFixedCostINR + variableCostPerBeneficiaryINR instead. */
  costPerChildPerYearINR: number;
  /** Fixed engineering/build cost that doesn't scale with beneficiary count (tech products). */
  baseFixedCostINR?: number;
  /** Per-beneficiary platform/ops cost that scales with user count (tech products). */
  variableCostPerBeneficiaryINR?: number;
  standardLineItems: Array<{
    category: string;
    item: string;
    benchmarkKey: string;
    defaultQuantity: number;
    scaleFactor: "per_centre" | "per_beneficiary" | "per_leader" | "fixed";
    months: number;
  }>;
}

export const BUDGET_TEMPLATES: BudgetTemplate[] = [
  {
    programType: "football-for-development",
    matchThemes: ["sports", "football", "physical activity", "grassroots sports", "play"],
    programIntensity: "weekly",
    costPerChildPerYearINR: 10000, // 2-3 sessions/week, outdoor venue
    standardLineItems: [
      { category: "Staff", item: "Sports Facilitator & Coordinator", benchmarkKey: "Sports Coach / Facilitator salary", defaultQuantity: 1, scaleFactor: "fixed", months: 12 },
      { category: "Staff", item: "Young Leader stipends", benchmarkKey: "Young Leader stipend", defaultQuantity: 3, scaleFactor: "per_centre", months: 12 },
      { category: "Training", item: "Football training workshop (trainer + materials)", benchmarkKey: "External trainer workshop (per day)", defaultQuantity: 4, scaleFactor: "fixed", months: 1 },
      { category: "Training", item: "Safeguarding + first-aid refreshers", benchmarkKey: "Safeguarding / first-aid training", defaultQuantity: 3, scaleFactor: "fixed", months: 1 },
      { category: "Equipment", item: "Sports equipment bundles (balls, cones, bibs, first-aid)", benchmarkKey: "Sports equipment bundle (per centre)", defaultQuantity: 1, scaleFactor: "per_centre", months: 1 },
      { category: "Safety", item: "Girls safe participation support (transport/refreshments)", benchmarkKey: "Girls safe participation support (per centre per month)", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      { category: "Events", item: "Inter-centre festivals/leagues (quarterly)", benchmarkKey: "Inter-centre festival / league (per event)", defaultQuantity: 4, scaleFactor: "fixed", months: 1 },
      { category: "M&E", item: "M&E tools (registers, rubrics, data entry)", benchmarkKey: "M&E tools and data systems (per year)", defaultQuantity: 1, scaleFactor: "fixed", months: 1 },
      { category: "Overhead", item: "Program management overhead", benchmarkKey: "Program Manager salary", defaultQuantity: 1, scaleFactor: "fixed", months: 12 },
    ],
  },
  {
    /**
     * education-holistic — matches KHEL (Knowledge Hub for Education and Learning).
     * Covers all 5 KHEL components: academic FLN, digital literacy, sports, SEL, civic engagement.
     * Daily full-programme engagement → ₹20,000/child/year.
     * 476 children × ₹20k = ₹95.2L/year → ~₹31.7L/centre/year ✓
     */
    programType: "education-holistic",
    programIntensity: "daily",
    costPerChildPerYearINR: 20000, // Mon-Sat full programme (KHEL validated)
    matchThemes: [
      "education", "learning", "literacy", "numeracy", "academic", "digital literacy",
      "girls", "sel", "life skills", "fln", "out-of-school", "government schools",
    ],
    standardLineItems: [
      // Academic staff — 3 Fellow Teachers per centre
      { category: "Staff", item: "Fellow Teachers (academic FLN)", benchmarkKey: "Fellow Teacher stipend", defaultQuantity: 3, scaleFactor: "per_centre", months: 12 },
      // Centre Coordinator (per centre)
      { category: "Staff", item: "Center Coordinators", benchmarkKey: "Center Coordinator salary", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      // Digital / IT instructor (per centre)
      { category: "Staff", item: "Computer Instructors (digital literacy)", benchmarkKey: "Computer Instructor salary", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      // Sports & SEL facilitator (per centre — covers KHEL sports + SEL components)
      { category: "Staff", item: "Sports and SEL Facilitators", benchmarkKey: "Sports Coach / Facilitator salary", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      // Shared program lead (fixed, across all centres)
      { category: "Staff", item: "Program Lead / Project Manager", benchmarkKey: "Program Manager salary", defaultQuantity: 1, scaleFactor: "fixed", months: 12 },
      // Shared M&E Officer (fixed)
      { category: "Staff", item: "M&E Officer", benchmarkKey: "M&E Officer salary", defaultQuantity: 1, scaleFactor: "fixed", months: 12 },
      // Educational materials per student
      { category: "Materials", item: "Educational and learning materials (per student)", benchmarkKey: "Educational materials (per student per year)", defaultQuantity: 1, scaleFactor: "per_beneficiary", months: 1 },
      // Digital devices — one-time / annual refresh per centre
      { category: "Equipment", item: "Digital devices and IT infrastructure (per centre)", benchmarkKey: "Digital devices / IT equipment (per centre)", defaultQuantity: 1, scaleFactor: "per_centre", months: 1 },
      // Sports equipment per centre
      { category: "Equipment", item: "Sports equipment bundles (per centre)", benchmarkKey: "Sports equipment bundle (per centre)", defaultQuantity: 1, scaleFactor: "per_centre", months: 1 },
      // Consumable stationery
      { category: "Materials", item: "Stationery and consumable supplies", benchmarkKey: "Stationery and supplies (per centre per month)", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      // Staff training (6 staff per centre on average)
      { category: "Training", item: "Staff training and professional development", benchmarkKey: "Staff training program (per person per year)", defaultQuantity: 6, scaleFactor: "per_centre", months: 1 },
      // Community engagement
      { category: "Events", item: "Parent-teacher meetings (quarterly per centre)", benchmarkKey: "Parent-teacher meeting (per centre per session)", defaultQuantity: 4, scaleFactor: "per_centre", months: 1 },
      // Inter-centre learning festivals / showcases
      { category: "Events", item: "Inter-centre learning festivals and showcases", benchmarkKey: "Inter-centre festival / league (per event)", defaultQuantity: 4, scaleFactor: "fixed", months: 1 },
      // Girls safe participation
      { category: "Safety", item: "Girls safe participation support (transport / accompaniment)", benchmarkKey: "Girls safe participation support (per centre per month)", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      // M&E tools and systems
      { category: "M&E", item: "Assessment and M&E systems (ASER-aligned tools)", benchmarkKey: "M&E tools and data systems (per year)", defaultQuantity: 1, scaleFactor: "fixed", months: 1 },
      // Facility rent per centre
      { category: "Overhead", item: "Facility rent and maintenance", benchmarkKey: "Rent / facility maintenance (per centre per month)", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      // Utilities
      { category: "Overhead", item: "Utilities and internet connectivity", benchmarkKey: "Utilities (per centre per month)", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
    ],
  },
  {
    programType: "girls-empowerment",
    programIntensity: "weekly",
    costPerChildPerYearINR: 10000, // 2-3x/week sessions (Empowering Futures-style)
    matchThemes: ["girls", "empowerment", "gender", "adolescent", "women", "leadership", "life skills"],
    standardLineItems: [
      { category: "Staff", item: "Program Facilitators", benchmarkKey: "Fellow Teacher stipend", defaultQuantity: 2, scaleFactor: "fixed", months: 12 },
      { category: "Staff", item: "Program Coordinator", benchmarkKey: "Center Coordinator salary", defaultQuantity: 1, scaleFactor: "fixed", months: 12 },
      { category: "Materials", item: "Life skills curriculum materials", benchmarkKey: "Educational materials (per student per year)", defaultQuantity: 1, scaleFactor: "per_beneficiary", months: 1 },
      { category: "Safety", item: "Girls safe participation support", benchmarkKey: "Girls safe participation support (per centre per month)", defaultQuantity: 1, scaleFactor: "per_centre", months: 12 },
      { category: "Training", item: "Facilitator training and capacity building", benchmarkKey: "Staff training program (per person per year)", defaultQuantity: 3, scaleFactor: "fixed", months: 1 },
      { category: "Events", item: "Leadership camps and community events", benchmarkKey: "Community event / awareness drive", defaultQuantity: 4, scaleFactor: "fixed", months: 1 },
      { category: "M&E", item: "Agency rubric and assessment tools", benchmarkKey: "Assessment materials (per centre per year)", defaultQuantity: 1, scaleFactor: "fixed", months: 1 },
      { category: "Overhead", item: "Program management and coordination", benchmarkKey: "Program Manager salary", defaultQuantity: 1, scaleFactor: "fixed", months: 12 },
    ],
  },
  {
    /**
     * ai-tech-product — matches grants for building digital/AI tools.
     * Fixed cost dominant (engineering, content) + per-student variable (platform ops).
     * Anchor: max(baseFixed, variable×users) × durationYears.
     * Use overrideBudgetTemplate: "ai-tech-product" for explicit selection.
     */
    programType: "ai-tech-product",
    programIntensity: "periodic",
    baseFixedCostINR: 1000000,           // ₹10L minimum build cost — doesn't scale with users
    variableCostPerBeneficiaryINR: 500,  // per-student platform ops
    costPerChildPerYearINR: 5000,        // fallback anchor if above fields absent
    matchThemes: ["ai tool", "technology platform", "digital product", "software", "bot", "whatsapp", "app"],
    standardLineItems: [
      { category: "Technology", item: "Technology vendor / engineering team",         benchmarkKey: "Technology vendor / engineering team",         defaultQuantity: 1, scaleFactor: "fixed",           months: 12 },
      { category: "Technology", item: "AI platform subscription (Glific + Gemini)",   benchmarkKey: "AI platform subscription (Glific + Gemini)",   defaultQuantity: 1, scaleFactor: "fixed",           months: 12 },
      { category: "Technology", item: "Cloud infrastructure (Google Cloud)",           benchmarkKey: "Cloud infrastructure (Google Cloud)",           defaultQuantity: 1, scaleFactor: "fixed",           months: 12 },
      { category: "Content",    item: "Curriculum and content development",            benchmarkKey: "Curriculum and content development",            defaultQuantity: 1, scaleFactor: "fixed",           months: 1  },
      { category: "Programme",  item: "Field coordinator (pilot deployment)",          benchmarkKey: "Field coordinator (pilot deployment)",          defaultQuantity: 1, scaleFactor: "fixed",           months: 12 },
      { category: "Programme",  item: "Device and connectivity support (per student)", benchmarkKey: "Device and connectivity support",               defaultQuantity: 1, scaleFactor: "per_beneficiary", months: 1  },
      { category: "Training",   item: "Pilot training and adoption",                   benchmarkKey: "Pilot training and adoption (per centre)",      defaultQuantity: 1, scaleFactor: "per_centre",      months: 1  },
      { category: "Safety",     item: "Data privacy and safeguarding setup",           benchmarkKey: "Data privacy and safeguarding setup",           defaultQuantity: 1, scaleFactor: "fixed",           months: 1  },
      { category: "Technology", item: "Post-launch maintenance and support",           benchmarkKey: "Post-launch maintenance and support",           defaultQuantity: 1, scaleFactor: "fixed",           months: 6  },
      { category: "M&E",        item: "Assessment and M&E systems (ASER-aligned)",    benchmarkKey: "M&E tools and data systems (per year)",         defaultQuantity: 1, scaleFactor: "fixed",           months: 1  },
      { category: "Staff",      item: "Program Lead / Project Manager",                benchmarkKey: "Program Manager salary",                        defaultQuantity: 1, scaleFactor: "fixed",           months: 12 },
      { category: "Overhead",   item: "Utilities and internet connectivity",           benchmarkKey: "Communication / internet (per centre per month)", defaultQuantity: 1, scaleFactor: "fixed",         months: 12 },
    ],
  },
];
