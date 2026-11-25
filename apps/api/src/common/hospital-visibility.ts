/**
 * Which hospital directory entries the bot may use, and which of their fields
 * it may pass to the model or show to a user.
 *
 * Shared by `HospitalDirectoryService` (chat hospital search) and
 * `WhatsAppNavigatorFlowService` (legacy navigator), so both read the same
 * rule. The landing site applies the same exclusions to its hospital pages
 * and keeps the held ids in `apps/landing/src/lib/hospital-directory.mjs`
 * (HIDE_UNTIL_CORRECTED). `hospital-visibility.spec.ts` fails if the two
 * lists drift.
 *
 * The directory's free-text fields (`notes`, `navigation_notes`,
 * `sccf_notes`, the risk-flag text), `key_doctors`, the cost tier, the tier
 * letter and the score were written by a research agent and have not been
 * reviewed for publication. They never leave this module.
 */

/**
 * Entries held back until their data is corrected:
 *   nimhans-bangalore, sctimst-thiruvananthapuram: not cancer hospitals by
 *     their recorded type
 *   aiims-hyderabad: recorded city differs from its address
 */
export const HOSPITAL_HELD_IDS: ReadonlySet<string> = new Set([
  "nimhans-bangalore",
  "sctimst-thiruvananthapuram",
  "aiims-hyderabad",
  "ruban-memorial-patna",
  "ss-hospital-patna",
]);

/** The raw fields the visibility rule reads. */
export interface RawHospitalEntry {
  id: string;
  status?: string | null;
  risk_flag?: string | null;
  tier?: string | null;
  [key: string]: unknown;
}

/**
 * True when the bot may use an entry: status "active", no risk flag recorded,
 * not held, and not tier D (the directory's own "avoid" mark).
 */
export function isBotVisible(h: RawHospitalEntry): boolean {
  if (h.status !== "active") return false;
  if (typeof h.risk_flag === "string" && h.risk_flag.trim() !== "") return false;
  if (HOSPITAL_HELD_IDS.has(h.id)) return false;
  if (h.tier === "D") return false;
  return true;
}

/** Fields that must never reach the model or a user. */
export const UNREVIEWED_HOSPITAL_FIELDS = [
  "notes",
  "navigation_notes",
  "sccf_notes",
  "risk_flag",
  "key_doctors",
  "cost_tier",
  "cost_ranges",
  "tier",
  "score",
  "score_breakdown",
] as const;

/**
 * Exactly one Indian phone number, normalised for dialling, or null.
 * Accepted once spaces, hyphens, dots and brackets are removed: +91 and ten
 * digits, a ten-digit mobile, 0 and a ten-digit landline, or a 1800 toll-free
 * number. Two numbers, an extension or "+91-0..." give null.
 * Mirrors `apps/landing/src/lib/phone.mjs`.
 */
export function singleIndianPhone(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const s = phone.replace(/[\s\-().]/g, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^\+91([1-9]\d{9})$/))) return `+91${m[1]}`;
  if ((m = s.match(/^0([1-9]\d{9})$/))) return `+91${m[1]}`;
  if ((m = s.match(/^([6-9]\d{9})$/))) return `+91${m[1]}`;
  if ((m = s.match(/^(1800\d{6,7})$/))) return m[1];
  return null;
}
