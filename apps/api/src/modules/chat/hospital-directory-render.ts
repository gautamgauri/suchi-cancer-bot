/**
 * Deterministic rendering of hospital directory results, shared by the
 * navigation template (PlanExecutorService, issue #218) and the practical
 * hospital answer (issue #260).
 *
 * Moved out of plan-executor.service.ts unchanged, with the per-hospital line
 * factored into {@link renderHospitalBullet} so both callers state each centre
 * in the same reviewed words. Only the fields `toBotHospital` keeps reach this
 * file (PR #263).
 */

import { HospitalSearchGeography, normaliseDepartment } from "./hospital-directory.service";
import type { HospitalSearchResult } from "./execution-planner.service";
import { singleIndianPhone } from "../../common/hospital-visibility";

/**
 * Plain words for a canonical department name, for the directory-rendered
 * hospital section. Anything not listed falls back to the title-cased name.
 */
const DEPARTMENT_PLAIN_NAMES: Record<string, string> = {
  radiation_oncology: "Radiotherapy",
  medical_oncology: "Chemotherapy (medical oncology)",
  surgical_oncology: "Cancer surgery",
  head_and_neck: "Head and neck cancer care",
  gynaec_oncology: "Gynaecological cancer care",
  hemato_oncology: "Blood cancer care",
  pediatric_oncology: "Children's cancer care",
  palliative_care: "Palliative care",
  bone_marrow_transplant: "Bone marrow transplant",
  nuclear_medicine: "Nuclear medicine",
  neuro_oncology: "Brain and nerve cancer care",
  uro_oncology: "Urological cancer care",
};

/**
 * The sentence the LLM path is instructed to end every hospital answer with
 * (chat.service.ts, buildHospitalContextBlock). The template path has no LLM,
 * so it appends the same sentence itself.
 */
export const HOSPITAL_CONFIRMATION_SENTENCE =
  "Hospital services, doctors, costs, and PM-JAY availability can change. Please confirm directly with the hospital before travel or payment.";

/** Plain words for a canonical department name; title case otherwise. */
export function departmentPlainName(canonical: string): string {
  return (
    DEPARTMENT_PLAIN_NAMES[canonical] ??
    canonical.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * One centre as a bullet line. The wording is the one reviewed for the
 * navigation template (#218, SCCF sign-off recorded in chat.service.ts):
 * distance as "about N km", PM-JAY status "as recorded", a centre in another
 * state named with that state, and the phone only when the record holds one
 * valid Indian number.
 */
export function renderHospitalBullet(
  h: HospitalSearchResult,
  geography: HospitalSearchGeography | null
): string {
  const state = geography?.resolvedState?.trim() || null;
  const required = (geography?.requiredDepartments ?? []).map(normaliseDepartment);
  const parts: string[] = [];
  const title =
    h.short_name && h.short_name !== h.name ? `**${h.short_name}** (${h.name})` : `**${h.name}**`;
  parts.push(`${title}, ${h.city}, ${h.state}.`);

  if (geography?.stage === "distance" && typeof h.distance_km === "number") {
    parts.push(
      h.distance_km < 10 ? "Within 10 km." : `About ${Math.round(h.distance_km / 10) * 10} km away.`
    );
  }

  const canonical = (h.departments ?? []).map(normaliseDepartment);
  if (required.length > 0) {
    const offered = required.filter((d) => canonical.includes(d)).map((d) => departmentPlainName(d));
    if (offered.length > 0) parts.push(`${offered.join(", ")} available.`);
  } else if (canonical.length > 0) {
    parts.push(`Departments: ${canonical.map((d) => departmentPlainName(d)).join(", ")}.`);
  }

  if (h.pmjay_empanelled === true) parts.push("PM-JAY empanelled, as recorded. Confirm with the hospital.");
  else if (h.pmjay_empanelled === false) parts.push("Not PM-JAY empanelled, as recorded.");
  else parts.push("PM-JAY status not verified; confirm with the hospital.");

  if (state && h.state && h.state !== state) {
    parts.push(
      `This centre is in ${h.state}; before travelling, confirm with the hospital whether your PM-JAY card or ${state} state scheme is accepted there.`
    );
  }

  if (singleIndianPhone(h.contact?.phone)) parts.push(`Phone: ${h.contact.phone}.`);

  return `- ${parts.join(" ")}`;
}

/**
 * Render the hospital section of a navigation template from the directory
 * results the planner attached to the plan (issue #218).
 *
 * Deterministic, no LLM. The wording follows the rules the LLM path is
 * instructed with in `ChatService.buildHospitalContextBlock` and
 * `travelAndDistanceGuidance` (SCCF sign-off recorded there, 2026-09-30):
 *   - the order is the directory's order, nearest first on the distance rung,
 *     and is not presented as a ranking of quality;
 *   - a distance is "about N km" rounded to 10 km, or "within 10 km", never
 *     a travel time or a road distance, and the word "straight-line" is never
 *     shown to the patient; one line says the road or rail journey is longer;
 *   - a centre in another state is named with its state and the patient is
 *     told to confirm whether their card or state scheme is accepted there;
 *   - PM-JAY status is stated only as the record has it, marked "as recorded"
 *     with a prompt to confirm; unverified says so;
 *   - national referral centres are mentioned as places patients from the
 *     region also travel to, not as recommendations;
 *   - the section ends with the same confirmation sentence the LLM path must
 *     end with.
 * Headings are localised by renderTemplate; the bullets are English, like
 * every other template section today.
 */
export function renderHospitalDirectorySection(
  hospitals: HospitalSearchResult[],
  geography: HospitalSearchGeography | null,
  maxItems: number
): string {
  const regional = hospitals.filter((h) => h.national_referral !== true).slice(0, maxItems);
  const national = hospitals.filter((h) => h.national_referral === true);
  const city = geography?.requestedCity?.trim() || null;
  const state = geography?.resolvedState?.trim() || null;
  const required = (geography?.requiredDepartments ?? []).map(normaliseDepartment);
  const needs = required.map((d) => departmentPlainName(d).toLowerCase()).join(", ");

  const lines: string[] = [];

  // Lead line, by the rung that produced the candidates.
  if (regional.length === 0) {
    if (geography?.capabilityUnavailable === true) {
      lines.push(
        `The directory lists no centre near ${city ?? state ?? "your location"} that offers ${needs || "the treatment asked about"}.`
      );
    }
  } else {
    switch (geography?.stage) {
      case "distance":
        lines.push(
          `${city ? `Nearest cancer centres to ${city}` : "Nearest cancer centres"}, nearest first. Distances are approximate; the road or rail journey is longer.`
        );
        break;
      case "city":
        lines.push(city ? `Cancer centres in ${city}.` : "Cancer centres.");
        break;
      case "state":
        lines.push(state ? `Cancer centres in ${state}.` : "Cancer centres.");
        break;
      case "adjacent_state":
      case "unfiltered":
        lines.push(
          `The directory has no cancer centre in ${city ?? state ?? "your stated location"}. The centres below are in other districts or states and may involve significant travel.`
        );
        break;
      default:
        lines.push("Major cancer centres.");
    }
  }

  for (const h of regional) {
    lines.push(renderHospitalBullet(h, geography));
  }

  if (national.length > 0) {
    lines.push(
      `For complex or specialised care, patients from this region also travel to: ${national
        .map((h) => `${h.short_name || h.name} (${h.city})`)
        .join("; ")}.`
    );
  }

  lines.push(HOSPITAL_CONFIRMATION_SENTENCE);
  return lines.join("\n");
}
