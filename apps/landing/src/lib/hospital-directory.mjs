/**
 * Shared rules for the Hospital Directory page (/find-care/hospitals/).
 * Read by the page and by scripts/verify-build.mjs, so both agree on which
 * entries are listed and what each card shows.
 */

/**
 * Entries kept off the directory until their data is corrected. Remove an id
 * once its entry is fixed in hospitals.json.
 *   nimhans-bangalore, sctimst-thiruvananthapuram: not cancer hospitals by
 *     their recorded type
 *   aiims-hyderabad: recorded city differs from its address
 */
export const HIDE_UNTIL_CORRECTED = new Set([
  'nimhans-bangalore',
  'sctimst-thiruvananthapuram',
  'aiims-hyderabad',
]);

/** True for an entry the directory lists. */
export function listable(h) {
  return h.status !== 'incomplete_departments' && !HIDE_UNTIL_CORRECTED.has(h.id);
}

/** Labels for department codes. Newer entries hold readable names, shown as written. */
export const DEPT_LABELS = {
  medical_oncology: 'Medical Oncology',
  surgical_oncology: 'Surgical Oncology',
  radiation_oncology: 'Radiation Oncology',
  hemato_oncology: 'Haematology',
  pediatric_oncology: 'Paediatric',
  palliative_care: 'Palliative Care',
  nuclear_medicine: 'Nuclear Medicine',
  gynaec_oncology: 'Gynaecological Oncology',
  uro_oncology: 'Uro-Oncology',
  head_and_neck: 'Head & Neck',
};

export const deptLabel = (d) => DEPT_LABELS[d] ?? d;

const parse = (iso) => {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const monthYear = (d) => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * "in May 2026" or "between April 2026 and May 2026", from the dates the
 * entries were recorded (verified_date). Missing or unparseable dates are
 * left out. Returns null when no date parses.
 */
export function monthsRecorded(dates) {
  const parsed = dates.map(parse).filter(Boolean).sort((a, b) => a - b);
  if (parsed.length === 0) return null;
  const first = monthYear(parsed[0]);
  const last = monthYear(parsed[parsed.length - 1]);
  return first === last ? `in ${last}` : `between ${first} and ${last}`;
}
