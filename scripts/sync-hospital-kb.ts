#!/usr/bin/env ts-node
/**
 * sync-hospital-kb.ts
 *
 * Reads apps/landing/src/content/hospitals.json (single source of truth)
 * and regenerates kb/en/99_local_navigation/hospital-directory.md.
 *
 * DO NOT INGEST the generated article until the hospital data has been
 * reviewed. It is marked inactive in kb/manifest.json and in its own
 * frontmatter. The article holds only what the landing site shows: name,
 * type, city, state, departments, PMJAY status as recorded and a single valid
 * phone. It never holds notes, navigation notes, SCCF notes, risk-flag text,
 * doctors' names, the score, the cost tier or the tier letter, and it lists
 * only the entries the bot may use (apps/api/src/common/hospital-visibility.ts).
 *
 * Usage:
 *   npx ts-node scripts/sync-hospital-kb.ts           # writes file
 *   npx ts-node scripts/sync-hospital-kb.ts --dry-run # prints to stdout only
 */

import * as fs from "fs";
import * as path from "path";
import { isBotVisible, singleIndianPhone } from "../apps/api/src/common/hospital-visibility";

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
    gynaec_oncology: "Gynaecological Oncology",
    gynec_oncology: "Gynaecological Oncology",
    uro_oncology: "Uro-Oncology",
    head_and_neck: "Head & Neck",
    preventive_oncology: "Preventive Oncology",
  };
  return map[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format PMJAY field to a readable string. */
function pmjayLabel(val: boolean | null): string {
  if (val === true) return "Yes, as recorded. Confirm with the hospital.";
  if (val === false) return "No, as recorded";
  return "Not recorded. Confirm with the hospital.";
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

/** Render a single hospital entry as markdown, from reviewed-for-display fields only. */
function renderHospital(h: Hospital): string {
  const lines: string[] = [];
  lines.push(`### ${h.name}`);
  lines.push(`**Type:** ${h.type} | **City:** ${h.city}, ${h.state}`);
  if (h.departments.length > 0) {
    lines.push(`**Departments:** ${h.departments.map(deptLabel).join(", ")}`);
  }
  lines.push(`**PMJAY:** ${pmjayLabel(h.pmjay_empanelled)}`);
  if (singleIndianPhone(h.contact.phone)) {
    lines.push(`**Phone:** ${h.contact.phone}`);
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
  out.push(`status: "inactive"`);
  out.push(`source: "SCCF Navigator Research"`);
  out.push(`sourceType: "99_local_navigation"`);
  out.push(`license: "sccf_owned"`);
  // No lastReviewed: generating the file is not a review. The date it was
  // generated is recorded instead.
  out.push(`generated: "${today}"`);
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

  // Intro paragraph: plain facts only.
  const listed = data.hospitals.filter((h) => isBotVisible(h as unknown as { id: string }));
  out.push(
    `This article lists ${listed.length} entries for hospitals with cancer services recorded in the SCCF hospital directory. Details can change. Please confirm with the hospital before you travel.`
  );
  out.push("");
  out.push("---");
  out.push("");

  // Group hospitals by state in order of first appearance
  const byState = groupByState(listed);

  for (const [state, hospitals] of byState) {
    out.push(`## ${state}`);
    out.push("");

    for (const h of hospitals) {
      out.push(renderHospital(h));
      out.push("");
    }

    out.push("---");
    out.push("");
  }

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
