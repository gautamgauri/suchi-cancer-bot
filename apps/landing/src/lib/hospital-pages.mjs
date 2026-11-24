/**
 * Which hospitals in src/content/hospitals.json get a page of their own, and
 * which places (city and state) get a listing page. Read by the Astro pages
 * under src/pages/find-care/hospitals/ and by scripts/verify-build.mjs, so the
 * build and the check always agree.
 *
 * Rules (health navigation data, so the bar is high):
 *   - Only entries with status "active" get a page. Entries flagged
 *     "incomplete_departments" or "needs_verification" stay on the directory
 *     as before, with no page of their own.
 *   - An entry with a risk_flag gets no page. The directory still shows it
 *     with its flag. A page of its own would either hide the flag or put it
 *     in front of search engines, and neither is right without review.
 *   - The same hospital entered twice (same name and place, or same phone and
 *     place, or listed in KNOWN_DUPLICATES) gets one page at most. The most
 *     recently verified entry wins. If the entries disagree on the type of
 *     hospital or on PMJAY, or if any of them is excluded for the reasons
 *     above, none of them gets a page until the data is cleaned up.
 *   - An entry with no name, city, state, verified_date or departments gets
 *     no page.
 *
 * None of this needs maintenance as the navigator pipeline adds entries. A
 * cleaned-up duplicate or a cleared flag gives the hospital a page on the
 * next build.
 */

/** Slugs used by the section's own listing pages. A hospital id may not take one. */
export const RESERVED_SLUGS = new Set(['in', 'state']);

/**
 * Pairs the automatic duplicate check cannot see (different names and
 * phones). Remove a pair once one of its entries is deleted from the data.
 */
export const KNOWN_DUPLICATES = [['cancer-institute-wia-chennai', 'cancer-institute-adyar-chennai']];

/** Spelling variants of the same city. Key and value as written in the data. */
const PLACE_ALIASES = {
  Bangalore: 'Bengaluru',
  'New Delhi': 'Delhi',
  Gurgaon: 'Gurugram',
  Calcutta: 'Kolkata',
  Bombay: 'Mumbai',
  Madras: 'Chennai',
  Trivandrum: 'Thiruvananthapuram',
};

/** Department codes used by older entries. Newer entries hold readable names. */
export const DEPT_LABELS = {
  medical_oncology: 'Medical Oncology',
  surgical_oncology: 'Surgical Oncology',
  radiation_oncology: 'Radiation Oncology',
  hemato_oncology: 'Haematology',
  pediatric_oncology: 'Paediatric',
  palliative_care: 'Palliative Care',
  nuclear_medicine: 'Nuclear Medicine',
  gynaec_oncology: 'Gynaecology',
  gynec_oncology: 'Gynaecology',
  uro_oncology: 'Uro-Oncology',
  head_and_neck: 'Head & Neck',
  preventive_oncology: 'Preventive Oncology',
};

export const deptLabel = (d) => DEPT_LABELS[d] ?? d;

export function slugify(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** The city name used for place pages, with spelling variants merged. */
export function placeName(h) {
  const city = String(h.city ?? '').trim();
  return PLACE_ALIASES[city] ?? city;
}

/** Digits of a phone number, for comparing entries. */
const phoneKey = (p) => String(p ?? '').replace(/\D/g, '').replace(/^(91)?0?/, '');

/** Name for comparing entries: lower case, letters and digits only, "and"/"the" dropped. */
const nameKey = (n) =>
  slugify(n)
    .split('-')
    .filter((w) => w && w !== 'and' && w !== 'the')
    .join('-');

/** First part of the type ("Government / TMC" becomes "government"). */
const typeHead = (t) => String(t ?? '').split('/')[0].trim().toLowerCase();

/**
 * `tel:` href for a number as written in the data. Spaces and hyphens go,
 * and "+91-0..." becomes "+91..." so the number dials. The text shown on the
 * page stays as written.
 */
export function telHref(phone) {
  return `tel:${String(phone).replace(/[^\d+]/g, '').replace(/^\+910/, '+91')}`;
}

/** Coordinates precise enough for a directions link. City-centre geocodes are not. */
export function preciseGeo(h) {
  const ok =
    (h.geocode_confidence === 'address' || h.geocode_confidence === 'name_address') &&
    typeof h.latitude === 'number' &&
    typeof h.longitude === 'number';
  return ok ? { latitude: h.latitude, longitude: h.longitude } : null;
}

export function directionsUrl(geo) {
  return `https://www.google.com/maps/dir/?api=1&destination=${geo.latitude},${geo.longitude}`;
}

/** "2026-04-30" to "30 April 2026". */
export function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Title shown for a hospital: its name, with the city added unless the name already holds it. */
export function hospitalTitle(h) {
  const city = String(h.city).trim();
  return h.name.toLowerCase().includes(city.toLowerCase()) ? h.name : `${h.name}, ${city}`;
}

function ownReason(h) {
  if (h.status !== 'active') return `status ${h.status}`;
  if (present(h.risk_flag)) return 'risk flag recorded';
  for (const f of ['id', 'name', 'city', 'state', 'verified_date']) {
    if (!present(h[f])) return `missing ${f}`;
  }
  if (!Array.isArray(h.departments) || h.departments.length === 0) return 'no departments recorded';
  if (RESERVED_SLUGS.has(h.id) || slugify(h.id) !== h.id) return 'id cannot be used as a URL';
  return null;
}

/**
 * Split the directory into entries that get a page and entries that do not.
 * Returns { publishable, excluded } where excluded is [{ id, reason }].
 */
export function classifyHospitals(hospitals) {
  const reasons = new Map();
  for (const h of hospitals) {
    const r = ownReason(h);
    if (r) reasons.set(h.id, r);
  }

  // Group duplicates with a small union-find over shared keys.
  const parent = new Map(hospitals.map((h) => [h.id, h.id]));
  const find = (x) => (parent.get(x) === x ? x : find(parent.get(x)));
  const union = (a, b) => parent.set(find(a), find(b));
  const seen = new Map();
  for (const h of hospitals) {
    const place = slugify(placeName(h));
    const keys = [`n:${nameKey(h.name)}@${place}`];
    const pk = phoneKey(h.contact?.phone);
    if (pk.length >= 6) keys.push(`p:${pk}@${place}`);
    for (const k of keys) {
      if (seen.has(k)) union(h.id, seen.get(k));
      else seen.set(k, h.id);
    }
  }
  const ids = new Set(hospitals.map((h) => h.id));
  for (const [a, b] of KNOWN_DUPLICATES) if (ids.has(a) && ids.has(b)) union(a, b);

  const groups = new Map();
  hospitals.forEach((h, i) => {
    const root = find(h.id);
    groups.set(root, [...(groups.get(root) ?? []), { h, i }]);
  });

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const memberIds = members.map((m) => m.h.id);
    if (members.some((m) => reasons.has(m.h.id))) {
      for (const m of members) {
        if (!reasons.has(m.h.id)) reasons.set(m.h.id, `duplicate of an excluded entry (${memberIds.join(', ')})`);
      }
      continue;
    }
    const types = new Set(members.map((m) => typeHead(m.h.type)));
    const pmjay = new Set(members.map((m) => m.h.pmjay_empanelled).filter((v) => typeof v === 'boolean'));
    if (types.size > 1 || pmjay.size > 1) {
      for (const m of members) reasons.set(m.h.id, `duplicate entries disagree (${memberIds.join(', ')})`);
      continue;
    }
    const keep = [...members].sort(
      (a, b) => String(b.h.verified_date).localeCompare(String(a.h.verified_date)) || b.i - a.i,
    )[0];
    for (const m of members) {
      if (m !== keep) reasons.set(m.h.id, `duplicate of ${keep.h.id}`);
    }
  }

  const publishable = hospitals.filter((h) => !reasons.has(h.id));
  const excluded = hospitals.filter((h) => reasons.has(h.id)).map((h) => ({ id: h.id, reason: reasons.get(h.id) }));
  return { publishable, excluded };
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en');

/**
 * City pages: one per place with at least one publishable hospital.
 * A place name shared by two states gets the state in its slug.
 */
export function placeGroups(publishable) {
  const byPlace = new Map();
  for (const h of publishable) {
    const key = `${placeName(h)}|${h.state}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), h]);
  }
  const slugCount = new Map();
  for (const key of byPlace.keys()) {
    const s = slugify(key.split('|')[0]);
    slugCount.set(s, (slugCount.get(s) ?? 0) + 1);
  }
  return [...byPlace.entries()]
    .map(([key, hs]) => {
      const [place, state] = key.split('|');
      const base = slugify(place);
      const slug = slugCount.get(base) > 1 ? `${base}-${slugify(state)}` : base;
      return { slug, place, state, path: `/find-care/hospitals/in/${slug}/`, hospitals: [...hs].sort(byName) };
    })
    .sort((a, b) => a.place.localeCompare(b.place, 'en'));
}

/**
 * State pages: only for a state whose publishable hospitals sit in two or
 * more places. Otherwise the single city page already covers the state.
 */
export function stateGroups(publishable, places) {
  const byState = new Map();
  for (const p of places) byState.set(p.state, [...(byState.get(p.state) ?? []), p]);
  return [...byState.entries()]
    .filter(([, ps]) => ps.length >= 2)
    .map(([state, ps]) => ({
      slug: slugify(state),
      state,
      path: `/find-care/hospitals/state/${slugify(state)}/`,
      places: ps,
      hospitals: publishable.filter((h) => h.state === state).sort(byName),
    }))
    .sort((a, b) => a.state.localeCompare(b.state, 'en'));
}

export const hospitalPath = (h) => `/find-care/hospitals/${h.id}/`;

/** Everything the pages and the verify script need, from the raw JSON. */
export function hospitalSite(data) {
  const { publishable, excluded } = classifyHospitals(data.hospitals);
  const places = placeGroups(publishable);
  const states = stateGroups(publishable, places);
  const placeOf = new Map();
  for (const p of places) for (const h of p.hospitals) placeOf.set(h.id, p);
  const stateOf = new Map(states.map((s) => [s.state, s]));
  return { publishable, excluded, places, states, placeOf, stateOf };
}
