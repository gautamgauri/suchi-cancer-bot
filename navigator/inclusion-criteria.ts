/**
 * Suchi Navigator — Hospital Inclusion Criteria Gate
 *
 * A hospital draft must pass all three gates before entering the approval queue:
 *  1. Oncology coverage — at least one core oncology department
 *  2. Treatment breadth — 2+ distinct treatment modalities
 *  3. Trust signal     — at least one verifiable credential
 */

import { HospitalDraft } from "./types";

// ---------------------------------------------------------------------------
// Gate definitions
// ---------------------------------------------------------------------------

const CORE_ONCOLOGY_DEPTS = new Set([
  "medical_oncology",
  "surgical_oncology",
  "radiation_oncology",
  "head_and_neck_surgery",
  "gynecologic_oncology",
  "pediatric_oncology",
  "hemato_oncology",
]);

const TREATMENT_MODALITIES = new Set([
  "medical_oncology",
  "surgical_oncology",
  "radiation_oncology",
  "chemotherapy",
  "immunotherapy",
  "bone_marrow_transplant",
  "targeted_therapy",
  "head_and_neck_surgery",
  "gynecologic_oncology",
]);

const TRUST_SIGNALS = new Set([
  "NABH",
  "NABL",
  "NCG_MEMBER",
  "TMC_AFFILIATED",
  "JCI",
  "ISO",
]);

const GOVERNMENT_TYPES = ["Government", "AIIMS", "ESIC"];

// ---------------------------------------------------------------------------
// Criteria check result
// ---------------------------------------------------------------------------

export interface CriteriaResult {
  pass: boolean;
  failures: string[];
  score: number; // rough 0–10 score for auto-tier estimation
}

// ---------------------------------------------------------------------------
// Main gate
// ---------------------------------------------------------------------------

export function passesInclusionCriteria(h: HospitalDraft): CriteriaResult {
  const failures: string[] = [];

  // Gate 1: at least one core oncology department
  const hasCoreOncology = h.departments.some((d) => CORE_ONCOLOGY_DEPTS.has(d));
  if (!hasCoreOncology) {
    failures.push(
      `No core oncology department (need at least one of: ${[...CORE_ONCOLOGY_DEPTS].join(", ")})`,
    );
  }

  // Gate 2: 2+ treatment modalities
  const modalityCount = h.departments.filter((d) => TREATMENT_MODALITIES.has(d)).length;
  if (modalityCount < 2) {
    failures.push(
      `Only ${modalityCount} treatment modality — need at least 2 (medical/surgical/radiation oncology, chemo, immunotherapy, etc.)`,
    );
  }

  // Gate 3: at least one trust signal (accreditation OR government type)
  const hasAccreditation = h.accreditation.some((a) => TRUST_SIGNALS.has(a));
  const isGovernmentType = GOVERNMENT_TYPES.some((t) =>
    h.type.toLowerCase().includes(t.toLowerCase()),
  );
  const isNcg = !!h.ncg_member;
  if (!hasAccreditation && !isGovernmentType && !isNcg) {
    failures.push(
      `No trust signal — need NABH/NABL/TMC_AFFILIATED/NCG_MEMBER accreditation, or Government/AIIMS type`,
    );
  }

  // Rough score (used for Tier estimation)
  let score = 0;
  if (hasAccreditation) score += 2;
  if (isNcg) score += 2;
  if (isGovernmentType) score += 1;
  if (h.departments.includes("radiation_oncology")) score += 1;
  if (h.pmjay_empanelled) score += 1;
  if (h.key_doctors.length >= 2) score += 1;
  if (h.contact.phone) score += 1;
  if (h.contact.address) score += 1;
  score = Math.min(score, 10);

  return { pass: failures.length === 0, failures, score };
}

// ---------------------------------------------------------------------------
// Tier estimator (runs after criteria pass)
// ---------------------------------------------------------------------------

export function estimateTier(h: HospitalDraft, score: number): "A" | "B" | "C" {
  if (h.ncg_member || h.accreditation.includes("TMC_AFFILIATED")) return "A";
  if (score >= 7) return "A";
  if (score >= 4) return "B";
  return "C";
}
