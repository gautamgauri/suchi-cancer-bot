#!/usr/bin/env ts-node
/**
 * sync-hospital-kb.ts
 *
 * Reads apps/landing/src/content/hospitals.json (single source of truth)
 * and regenerates kb/en/99_local_navigation/hospital-directory.md.
 *
 * Usage:
 *   npx ts-node scripts/sync-hospital-kb.ts           # writes file
 *   npx ts-node scripts/sync-hospital-kb.ts --dry-run # prints to stdout only
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, "..");
const JSON_SRC = path.join(
  REPO_ROOT,
  "apps/landing/src/content/hospitals.json"
);
const MD_OUT = path.join(
  REPO_ROOT,
  "kb/en/99_local_navigation/hospital-directory.md"
);

// ---------------------------------------------------------------------------
// Types — core fields always present; new fields optional (future-proofing)
// ---------------------------------------------------------------------------
interface Doctor {
  name: string;
  role: string;
}

interface Contact {
  phone?: string | null;
  phone_alt?: string | null;
  address?: string | null;
}

interface CostRanges {
  opd?: string;
  chemo?: string;
  surgery?: string;
}

interface Logistics {
  railway?: string;
  airport?: string;
  lodging?: string;
  languages?: string[];
  telemedicine?: boolean;
}

interface TrustSignals {
  tumor_board?: boolean;
  case_volume?: string;
  academic_affiliation?: string;
}

interface Hospital {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  region: string;
  type: string;
  accreditation: string[];
  ncg_member: boolean;
  tmc_affiliated: boolean;
  specialization: string;
  departments: string[];
  cost_tier: string;
  pmjay_empanelled: boolean | null;
  referral_required: boolean;
  contact: Contact;
  key_doctors: Doctor[];
  notes: string;
  sccf_affiliated: boolean;
  sccf_notes: string;
  score: number;
  score_breakdown: Record<string, number>;
  risk_flag?: string;
  verified_date: string;
  status: string;
  // Future fields — optional
  tier?: string;
  cost_ranges?: CostRanges;
  logistics?: Logistics;
  trust_signals?: TrustSignals;
  navigation_notes?: string[];
}

interface HospitalsJson {
  _meta: Record<string, unknown>;
  hospitals: Hospital[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pretty-print a department slug into a human label. */
function deptLabel(slug: string): string {
  const map: Record<string, string> = {
    medical_oncology: "Medical Oncology",
    surgical_oncology: "Surgical Oncology",
    radiation_oncology: "Radiation Oncology",
    hemato_oncology: "Haematology",
    pediatric_oncology: "Pediatric Oncology",
    palliative_care: "Palliative Care",
    nuclear_medicine: "Nuclear Medicine",
    gynaec_oncology: "Gynaecology",
    gynec_oncology: "Gynaecology",
    uro_oncology: "Uro-Oncology",
    head_and_neck: "Head & Neck",
    preventive_oncology: "Preventive Oncology",
  };
  return map[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format PMJAY field to a readable string. */
function pmjayLabel(val: boolean | null): string {
  if (val === true) return "Yes";
  if (val === false) return "No";
  return "Check before visiting";
}

/** Format cost_tier into a readable string. */
function costLabel(tier: string): string {
  switch (tier) {
    case "Low":
      return "Free / Government rates";
    case "Medium":
      return "Medium (affordable)";
    case "High":
      return "High (private rates)";
    default:
      return tier;
  }
}

/** Render a list of accreditation codes into a readable string. */
function accreditationLabel(codes: string[]): string {
  const map: Record<string, string> = {
    NABH: "NABH",
    NABL: "NABL",
    NABH_RECOMMENDED: "NABH Recommended",
    TMC_AFFILIATED: "TMC Affiliated",
    AERB: "AERB",
    NABL_ACCREDITED: "NABL",
    JCI: "JCI",
  };
  return codes.map((c) => map[c] ?? c).join(", ");
}

/** Group hospitals by state, preserving the order they appear in JSON. */
function groupByState(hospitals: Hospital[]): Map<string, Hospital[]> {
  const map = new Map<string, Hospital[]>();
  for (const h of hospitals) {
    if (!map.has(h.state)) map.set(h.state, []);
    map.get(h.state)!.push(h);
  }
  return map;
}

/** Determine section heading and intro paragraph for each state group. */
function stateSectionMeta(
  state: string,
  hospitals: Hospital[]
): { heading: string; intro: string } {
  const count = hospitals.length;
  const headingMap: Record<string, string> = {
    Bihar: "Bihar Cancer Hospitals",
    Jharkhand: "Jharkhand Cancer Hospitals",
    Odisha: "Odisha Cancer Hospitals",
    "West Bengal": "West Bengal Cancer Hospitals",
    Assam: "Assam (Northeast) Cancer Hospitals",
    Meghalaya: "Meghalaya Cancer Hospitals",
    "Uttar Pradesh": "Uttar Pradesh (Eastern UP) Cancer Hospitals",
    Delhi: "National Referral Centres — Delhi",
    Maharashtra: "National Referral Centres — Mumbai",
    Gujarat: "National Referral Centres — Gujarat",
    "Tamil Nadu": "National Referral Centres — Tamil Nadu",
    Karnataka: "National Referral Centres — Karnataka / Bangalore",
    Telangana: "National Referral Centres — Telangana / Hyderabad",
    Punjab: "National Referral Centres — North India",
    Haryana: "National Referral Centres — Haryana / NCR",
  };

  const introMap: Record<string, string> = {
    Bihar: `Bihar has ${count} verified cancer hospitals. The best starting points are HBCH Muzaffarpur (for North Bihar) and AIIMS Patna / Mahavir Cancer Sansthan (for Patna and surrounding districts).`,
    Jharkhand: `Jharkhand has ${count} verified hospitals. AIIMS Deoghar (for eastern Jharkhand / Santhal Pargana) and RCHRC Ranchi (Tata Trusts, PMJAY) are the top public-sector options.`,
    Odisha: `Odisha has ${count} verified hospitals. AHPGIC Cuttack is completely free — the primary referral centre for all of Odisha. Note: Odisha uses BSKY scheme, not central PMJAY.`,
    "West Bengal": `West Bengal has ${count} verified hospitals. **Important:** West Bengal does NOT use central PMJAY — Bihar patients' PMJAY cards will not work at WB hospitals. CNCI Kolkata accepts both PMJAY and Swasthya Sathi (WB state scheme).`,
    Assam: ``,
    Meghalaya: ``,
    "Uttar Pradesh": `Bihar patients can reach Varanasi by road (3 hours from Patna) or train. The two TMC Varanasi hospitals complement each other: MPMMCC handles adult solid tumours; HBCH handles blood cancers and childhood cancers.`,
    Delhi: `Patients from Bihar with complex or rare cancers, or who need a second opinion, may be referred to national centres in Delhi.`,
    Maharashtra: `Patients from Bihar with complex or rare cancers, or who need a second opinion, may be referred to national centres in Mumbai.`,
    Gujarat: ``,
    "Tamil Nadu": ``,
    Karnataka: ``,
    Telangana: ``,
    Punjab: ``,
    Haryana: ``,
  };

  return {
    heading: headingMap[state] ?? `${state} Cancer Hospitals`,
    intro: introMap[state] ?? "",
  };
}

/** Render a single hospital entry as markdown. */
function renderHospital(h: Hospital): string {
  const lines: string[] = [];

  // Heading: ShortName — Full Name (Score: X/10)
  lines.push(`### ${h.short_name} — ${h.name} (Score: ${h.score}/10)`);

  // Type line
  const typeStr = `**Type:** ${h.type} | **City:** ${h.city}, ${h.state}`;
  lines.push(typeStr);

  // Departments
  if (h.departments.length > 0) {
    lines.push(`**Departments:** ${h.departments.map(deptLabel).join(", ")}`);
  }

  // Cost and PMJAY line
  let costPmjayLine = `**Cost:** ${costLabel(h.cost_tier)} | **PMJAY:** ${pmjayLabel(h.pmjay_empanelled)}`;
  if (h.ncg_member) costPmjayLine += " | **NCG Member:** Yes";
  if (h.tmc_affiliated) costPmjayLine += " | **TMC affiliated:** Yes";
  lines.push(costPmjayLine);

  // Tier (future field)
  if (h.tier) {
    lines.push(`**Tier:** ${h.tier}`);
  }

  // Cost ranges (future field)
  if (h.cost_ranges) {
    const cr = h.cost_ranges;
    const parts: string[] = [];
    if (cr.opd) parts.push(`OPD: ${cr.opd}`);
    if (cr.chemo) parts.push(`Chemo: ${cr.chemo}`);
    if (cr.surgery) parts.push(`Surgery: ${cr.surgery}`);
    if (parts.length > 0) {
      lines.push(`**Cost ranges:** ${parts.join(" | ")}`);
    }
  }

  // Contact
  const hasPhone = h.contact.phone || h.contact.phone_alt;
  const hasAddress = h.contact.address;
  if (hasPhone || hasAddress) {
    const parts: string[] = [];
    if (h.contact.phone) parts.push(h.contact.phone);
    if (h.contact.phone_alt) parts.push(h.contact.phone_alt);
    if (h.contact.address) parts.push(h.contact.address);
    lines.push(`**Contact:** ${parts.join(" | ")}`);
  }

  // Accreditation (if non-empty and non-trivial)
  if (h.accreditation.length > 0) {
    lines.push(`**Accreditation:** ${accreditationLabel(h.accreditation)}`);
  }

  // Key doctors
  if (h.key_doctors.length > 0) {
    const doctorStr = h.key_doctors
      .map((d) => `${d.name} (${d.role})`)
      .join("; ");
    lines.push(`**Key doctors:** ${doctorStr}`);
  }

  // Trust signals (future field)
  if (h.trust_signals) {
    const ts = h.trust_signals;
    const parts: string[] = [];
    if (ts.tumor_board) parts.push("Tumour Board: Yes");
    if (ts.case_volume) parts.push(`Case volume: ${ts.case_volume}`);
    if (ts.academic_affiliation) parts.push(`Affiliation: ${ts.academic_affiliation}`);
    if (parts.length > 0) {
      lines.push(`**Trust signals:** ${parts.join(" | ")}`);
    }
  }

  // Logistics (future field)
  if (h.logistics) {
    const lg = h.logistics;
    const parts: string[] = [];
    if (lg.railway) parts.push(`Railway: ${lg.railway}`);
    if (lg.airport) parts.push(`Airport: ${lg.airport}`);
    if (lg.lodging) parts.push(`Lodging: ${lg.lodging}`);
    if (lg.languages && lg.languages.length > 0) parts.push(`Languages: ${lg.languages.join(", ")}`);
    if (lg.telemedicine !== undefined) parts.push(`Telemedicine: ${lg.telemedicine ? "Yes" : "No"}`);
    if (parts.length > 0) {
      lines.push(`**Logistics:** ${parts.join(" | ")}`);
    }
  }

  // Key facts (notes)
  if (h.notes) {
    lines.push(`**Key facts:** ${h.notes}`);
  }

  // Risk flag
  if (h.risk_flag) {
    lines.push(`**Warning:** ⚠ ${h.risk_flag}`);
  }

  // Navigation notes (future field)
  if (h.navigation_notes && h.navigation_notes.length > 0) {
    lines.push(`**Navigation notes:**`);
    for (const note of h.navigation_notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build the full markdown document
// ---------------------------------------------------------------------------
function buildMarkdown(data: HospitalsJson): string {
  const out: string[] = [];

  // Auto-generated comment
  out.push(
    "<!-- AUTO-GENERATED — do not edit manually. Edit hospitals.json and run: npx ts-node scripts/sync-hospital-kb.ts -->"
  );

  // YAML frontmatter
  const today = new Date().toISOString().slice(0, 10);
  out.push("---");
  out.push(`title: "Cancer Hospital Directory — East India and National Referral Centres"`);
  out.push(`version: "v1"`);
  out.push(`status: "active"`);
  out.push(`source: "SCCF Navigator Research"`);
  out.push(`sourceType: "99_local_navigation"`);
  out.push(`license: "sccf_owned"`);
  out.push(`lastReviewed: "${today}"`);
  out.push(`reviewFrequency: "quarterly"`);
  out.push(`audienceLevel: "patient"`);
  out.push(`language: "en"`);
  out.push(`cancerTypes: ["general"]`);
  out.push(
    `tags: ["hospitals", "find-care", "navigation", "Bihar", "East India", "PMJAY", "NCG", "referral"]`
  );
  out.push(`citation: "SCCF Navigator Research, 2026"`);
  out.push("---");
  out.push("");

  // Document title
  out.push("# Cancer Hospital Directory — East India and National Referral Centres");
  out.push("");

  // Intro paragraph (preserved from original format)
  const total = data.hospitals.filter((h) => h.status === "active").length;
  out.push(
    `This directory covers ${data._meta.total_hospitals ?? data.hospitals.length} verified cancer hospitals that have at least a Medical Oncologist and Surgical Oncologist. Hospitals are scored on clinical quality, cost, East India location, and PMJAY empanelment (max score 10).`
  );
  out.push("");
  out.push(
    "**Important — West Bengal:** West Bengal does NOT use central PMJAY. WB hospitals use Swasthya Sathi (the WB state scheme). Patients from Bihar with PMJAY cards cannot use them at West Bengal state hospitals."
  );
  out.push("");
  out.push("---");
  out.push("");

  // Group hospitals by state in order of first appearance
  const byState = groupByState(data.hospitals);

  for (const [state, hospitals] of byState) {
    const { heading, intro } = stateSectionMeta(state, hospitals);

    out.push(`## ${heading}`);
    out.push("");

    if (intro) {
      out.push(intro);
      out.push("");
    }

    for (const h of hospitals) {
      out.push(renderHospital(h));
      out.push("");
    }

    out.push("---");
    out.push("");
  }

  // Quick Routing Guide (static — must be maintained manually in this template
  // as it contains curated routing logic that goes beyond raw JSON fields)
  out.push("## Quick Routing Guide");
  out.push("");
  out.push(
    "**I'm in North Bihar (Muzaffarpur/Sitamarhi/Gopalganj)** → HBCH Muzaffarpur (TMC unit, closest option)"
  );
  out.push("");
  out.push(
    "**I'm in Patna** → AIIMS Patna or Mahavir Cancer Sansthan (government/trust, affordable); Paras HMRI / Medanta (private, high cost)"
  );
  out.push("");
  out.push(
    "**I'm in East Bihar (Bhagalpur/Munger)** → For surgical cases: AIIMS Patna or Mahavir Patna; Healing Touch Bhagalpur was surgical-only and is under review"
  );
  out.push("");
  out.push(
    "**I need blood cancer treatment (leukemia/lymphoma)** → HBCH Varanasi (TMC, PMJAY, free); or Paras HMRI Patna (bone marrow transplant, private); or CNCI Kolkata"
  );
  out.push("");
  out.push(
    "**My child has cancer** → AIIMS Patna (pediatric oncology), HBCH Varanasi (TMC pediatric, PMJAY), AIIMS Bhubaneswar (only govt pediatric oncology for Odisha/JH/WB)"
  );
  out.push("");
  out.push(
    "**I need free treatment and have PMJAY** → HBCH Muzaffarpur, AIIMS Patna, Mahavir Sansthan, IGIMS Patna (Bihar); RCHRC Ranchi or RIMS Ranchi (Jharkhand); BBCI Guwahati, CNCI Kolkata (outside Bihar); MPMMCC/HBCH Varanasi (UP)"
  );
  out.push("");
  out.push(
    "**I need a second opinion on a complex case** → TMH Mumbai or AIIMS Delhi (national centres, long waits, plan logistics)"
  );
  out.push("");
  out.push(
    "**I'm in Jharkhand** → AIIMS Deoghar (east JH) or RCHRC Ranchi / RIMS Ranchi (Ranchi); HCG Ranchi (private)"
  );
  out.push("");
  out.push(
    "**I'm in Odisha** → AIIMS Bhubaneswar (comprehensive, central govt); AHPGIC Cuttack (free, regional cancer centre; note: BSKY not PMJAY)"
  );

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const dryRun = process.argv.includes("--dry-run");

  // Read JSON source
  if (!fs.existsSync(JSON_SRC)) {
    console.error(`ERROR: Source file not found: ${JSON_SRC}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(JSON_SRC, "utf-8");
  const data: HospitalsJson = JSON.parse(raw);

  if (!Array.isArray(data.hospitals) || data.hospitals.length === 0) {
    console.error("ERROR: hospitals array is missing or empty in JSON source.");
    process.exit(1);
  }

  console.log(
    `Loaded ${data.hospitals.length} hospitals from ${path.relative(REPO_ROOT, JSON_SRC)}`
  );

  const markdown = buildMarkdown(data);

  if (dryRun) {
    console.log("\n--- DRY RUN: output below (file not written) ---\n");
    console.log(markdown);
  } else {
    // Ensure output directory exists
    const outDir = path.dirname(MD_OUT);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(MD_OUT, markdown, "utf-8");
    console.log(`Written: ${path.relative(REPO_ROOT, MD_OUT)}`);
  }
}

main();
