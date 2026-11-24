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
 *   - An entry on the HELD list gets no page until its data is corrected.
 *   - The same hospital entered twice gets one page at most. Entries count as
 *     one hospital when they share a name and city or a phone and city, or
 *     when they are listed in KNOWN_DUPLICATES. An entry that shares a
 *     website host and city with an excluded entry, or sits within
 *     TWIN_DISTANCE_M of one, also counts as its twin, so a renamed copy of
 *     a flagged or held entry gets no page. (Many address geocodes are
 *     locality centres, so two different hospitals can share coordinates.
 *     That is why the host and distance tests apply only next to an excluded
 *     entry.) The most
 *     recently recorded entry wins. If the entries disagree on the type of
 *     hospital, on PMJAY or on the main phone, or if any of them is excluded
 *     for another reason, none of them gets a page until the data is cleaned up.
 *   - An entry with no name, city, state, verified_date or departments gets
 *     no page.
 *   - An entry needs a dialable phone or a shown website, and its id must
 *     be on the approved list (src/content/hospital-pages-approved.mjs).
 *   - A city gets a page only when two or more hospitals there have pages.
 *     A state gets a page only when its hospitals with pages are in two or
 *     more cities. A hospital in a city without a page is linked directly.
 *
 * None of this needs maintenance as the navigator pipeline adds entries. A
 * cleaned-up duplicate, a cleared flag or a removed hold gives the hospital a
 * page on the next build.
 */

import { APPROVED_IDS } from '../content/hospital-pages-approved.mjs';

/** Slugs used by the section's own listing pages. A hospital id may not take one. */
export const RESERVED_SLUGS = new Set(['in', 'state']);

/**
 * Entries held back from a page of their own until the data is corrected.
 * They stay on the directory as before. Remove an id once its entry is fixed.
 */
export const HELD = {
  'aiims-hyderabad': 'city-differs-from-address',
  'nimhans-bangalore': 'not-a-cancer-hospital-by-type',
  'sctimst-thiruvananthapuram': 'not-a-cancer-hospital-by-type',
  'chittaranjan-national-cancer-institute-kolkata': 'duplicate-phones-differ',
  'gujarat-cancer-research-institute-ahmedabad': 'duplicate-phones-differ',
  'kidwai-memorial-bangalore': 'duplicate-phones-differ',
};

/**
 * Entries whose recorded website is not shown, because it did not resolve
 * in a DNS check. Remove an id once the website in the data is corrected.
 */
export const WEBSITE_HELD = new Set([
  'kidwai-memorial-bangalore',
  'gujarat-cancer-research-institute-ahmedabad',
  'nims-hyderabad',
  'aiims-bhubaneswar',
]);

/**
 * Pairs the automatic duplicate check cannot see. Remove a pair once one of
 * its entries is deleted from the data.
 */
export const KNOWN_DUPLICATES = [['cancer-institute-wia-chennai', 'cancer-institute-adyar-chennai']];

/**
 * An entry this close to an excluded entry, both geocoded to an address,
 * counts as its twin. Kept below the 159 m between two distinct institutes
 * in Bengaluru that share a campus road.
 */
export const TWIN_DISTANCE_M = 150;

/** Entries of different hospitals this close together have a locality geocode, not a building one. */
const SHARED_GEO_M = 50;

/**
 * Ids approved for a page of their own (src/content/hospital-pages-approved.mjs).
 * An entry gets a page only when it passes every rule above AND is on this
 * list, so each new page is a reviewed decision. verify-build.mjs fails if a
 * page exists for an id not on the list.
 */
export const APPROVED_PAGE_IDS = new Set(APPROVED_IDS);

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

/**
 * Plain labels for department codes. Covers the codes the research pipeline
 * is told to use (apps/api/src/modules/admin/navigator-research.service.ts)
 * and the older codes already in the data. Newer entries hold readable names,
 * which are shown as written.
 */
export const DEPT_LABELS = {
  medical_oncology: 'Medical Oncology',
  surgical_oncology: 'Surgical Oncology',
  radiation_oncology: 'Radiation Oncology',
  chemotherapy: 'Chemotherapy',
  immunotherapy: 'Immunotherapy',
  bone_marrow_transplant: 'Bone Marrow Transplant',
  targeted_therapy: 'Targeted Therapy',
  palliative_care: 'Palliative Care',
  head_and_neck_surgery: 'Head and Neck Surgery',
  gynecologic_oncology: 'Gynaecological Oncology',
  hemato_oncology: 'Haemato-Oncology',
  pediatric_oncology: 'Paediatric Oncology',
  nuclear_medicine: 'Nuclear Medicine',
  pathology: 'Pathology',
  radiology: 'Radiology',
  clinical_trials: 'Clinical Trials',
  gynaec_oncology: 'Gynaecological Oncology',
  gynec_oncology: 'Gynaecological Oncology',
  uro_oncology: 'Uro-Oncology',
  head_and_neck: 'Head and Neck Oncology',
  preventive_oncology: 'Preventive Oncology',
};

/** True for a value written as a code (lower case and underscores) with no label. */
export const isUnknownDeptCode = (d) => /^[a-z0-9_]+$/.test(d) && !(d in DEPT_LABELS);

/** Label for a department. An unknown code is tidied ("foo_bar" becomes "Foo bar"). */
export function deptLabel(d) {
  if (DEPT_LABELS[d]) return DEPT_LABELS[d];
  if (isUnknownDeptCode(d)) {
    const s = d.replace(/_+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return d;
}

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
 * `tel:` href for a phone field, or null when the field is not exactly one
 * Indian number. Accepted forms, once spaces, hyphens and brackets are gone:
 * +91 and ten digits, a ten-digit mobile, 0 and a ten-digit landline, or a
 * 1800 toll-free number. Anything else (two numbers, an extension, "+91-0...")
 * is shown as text with no link.
 */
export function telHref(phone) {
  const s = String(phone ?? '').replace(/[\s\-().]/g, '');
  let m;
  if ((m = s.match(/^\+91([1-9]\d{9})$/))) return `tel:+91${m[1]}`;
  if ((m = s.match(/^0([1-9]\d{9})$/))) return `tel:+91${m[1]}`;
  if ((m = s.match(/^([6-9]\d{9})$/))) return `tel:+91${m[1]}`;
  if ((m = s.match(/^(1800\d{6,7})$/))) return `tel:${m[1]}`;
  return null;
}

/** The form every `tel:` href on the site must take. */
export const TEL_HREF_RE = /^tel:(\+91[1-9]\d{9}|1800\d{6,7})$/;

/** The recorded website, when it is a well-formed absolute https URL and not held. */
export function websiteFor(h) {
  const w = h.contact?.website;
  if (!present(w) || WEBSITE_HELD.has(h.id)) return null;
  const raw = String(w).trim();
  if (/\s/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

const websiteHost = (h) => {
  try {
    return new URL(String(h.contact?.website ?? '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/**
 * Coordinates geocoded to an address. City-centre geocodes are not. Pages
 * use hospitalSite().geoFor(), which returns null for every entry for now.
 */
export function preciseGeo(h) {
  const ok =
    (h.geocode_confidence === 'address' || h.geocode_confidence === 'name_address') &&
    typeof h.latitude === 'number' &&
    typeof h.longitude === 'number';
  return ok ? { latitude: h.latitude, longitude: h.longitude } : null;
}

function distanceM(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.latitude - a.latitude);
  const dLon = r(b.longitude - a.longitude);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
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

/** <title> of a hospital page. */
export const hospitalPageTitle = (h) => `${hospitalTitle(h)} | SCCF Hospital Directory`;

/**
 * Introductory sentence for a hospital page, or null when the name carries a
 * suffix after a dash and the sentence would not read as English.
 */
export function hospitalIntro(h) {
  if (/\s[–—-]\s|[–—]/.test(h.name)) return null;
  return `${h.name} is a hospital in ${h.city}, ${h.state}.`;
}

/**
 * Headings of city and state pages. City pages say "in", state pages say
 * "across", so a city and a state with the same name never share a title.
 */
export const cityLabel = (p) => (p.place === p.state ? p.place : `${p.place}, ${p.state}`);
export const cityHeading = (p) => `Hospitals in ${cityLabel(p)} in the SCCF hospital directory`;
export const stateHeading = (s) => `Hospitals across ${s.state} in the SCCF hospital directory`;

function ownReason(h) {
  if (h.status !== 'active') return `status ${h.status}`;
  if (present(h.risk_flag)) return 'risk flag recorded';
  if (HELD[h.id]) return `held: ${HELD[h.id]}`;
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
  const byHost = new Map();
  for (const h of hospitals) {
    const place = slugify(placeName(h));
    const keys = [`n:${nameKey(h.name)}@${place}`];
    const pk = phoneKey(h.contact?.phone);
    if (pk.length >= 6) keys.push(`p:${pk}@${place}`);
    for (const k of keys) {
      if (seen.has(k)) union(h.id, seen.get(k));
      else seen.set(k, h.id);
    }
    const host = websiteHost(h);
    if (host) byHost.set(`${host}@${place}`, [...(byHost.get(`${host}@${place}`) ?? []), h.id]);
  }
  // Host and distance links only next to an entry that is already excluded.
  const nextToExcluded = (a, b) => reasons.has(a) || reasons.has(b);
  for (const group of byHost.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) if (nextToExcluded(group[i], group[j])) union(group[i], group[j]);
    }
  }
  const located = hospitals.map((h) => [h, preciseGeo(h)]).filter(([, g]) => g);
  for (let i = 0; i < located.length; i += 1) {
    for (let j = i + 1; j < located.length; j += 1) {
      const [a, ga] = located[i];
      const [b, gb] = located[j];
      // Pairs that share coordinates are skipped: those are locality geocodes,
      // and a flag on one hospital must not remove its neighbour.
      const d = distanceM(ga, gb);
      if (nextToExcluded(a.id, b.id) && d > SHARED_GEO_M && d <= TWIN_DISTANCE_M) union(a.id, b.id);
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
    const phones = new Set(members.map((m) => phoneKey(m.h.contact?.phone)).filter((p) => p.length >= 6));
    if (types.size > 1 || pmjay.size > 1 || phones.size > 1) {
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
  return { publishable, excluded, groupOf: (id) => find(id) };
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en');

/**
 * Every city with at least one publishable hospital. Only cities with two or
 * more get a page (`hasPage`). A city name shared by two states gets the
 * state in its slug.
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
      return {
        slug,
        place,
        state,
        path: `/find-care/hospitals/in/${slug}/`,
        hasPage: hs.length >= 2,
        hospitals: [...hs].sort(byName),
      };
    })
    .sort((a, b) => a.place.localeCompare(b.place, 'en'));
}

/** State pages, for a state whose publishable hospitals are in two or more cities. */
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

/** Entries the directory page lists (it hides only incomplete_departments). */
export const onDirectory = (h) => h.status !== 'incomplete_departments';

/** Everything the pages and the verify script need, from the raw JSON. */
export function hospitalSite(data, { approved = APPROVED_PAGE_IDS } = {}) {
  const classified = classifyHospitals(data.hospitals);
  const excluded = [...classified.excluded];
  // Applied after classification, so these entries still count as clean for
  // the twin rule. A page must give the reader a way to reach the hospital.
  const publishable = [];
  for (const h of classified.publishable) {
    if (!reachable(h)) excluded.push({ id: h.id, reason: 'no dialable phone or shown website' });
    else if (approved && !approved.has(h.id)) excluded.push({ id: h.id, reason: 'not on the approved list' });
    else publishable.push(h);
  }
  /**
   * Coordinates for a directions link and JSON-LD geo. None for now: a review
   * found recorded coordinates 7 to 8 km from the hospital in three of five
   * cases. Restore preciseGeo(h) here once the coordinates are verified.
   */
  const geoFor = () => null;
  const allPlaces = placeGroups(publishable);
  const places = allPlaces.filter((p) => p.hasPage);
  const states = stateGroups(publishable, allPlaces);
  const placeOf = new Map();
  for (const p of places) for (const h of p.hospitals) placeOf.set(h.id, p);
  const stateOf = new Map(states.map((s) => [s.state, s]));

  // Whether the directory lists a hospital in a place that the page does not.
  // An entry that is a duplicate of a listed hospital does not count.
  const listed = data.hospitals.filter(onDirectory);
  const more = (inPlace, shown) => {
    const shownGroups = new Set(shown.map((h) => classified.groupOf(h.id)));
    return listed.some((h) => inPlace(h) && !shownGroups.has(classified.groupOf(h.id)));
  };
  const hasMore = {
    city: (p) => more((h) => placeName(h) === p.place && h.state === p.state, p.hospitals),
    state: (s) => more((h) => h.state === s.state, s.hospitals),
  };
  return { publishable, excluded, allPlaces, places, states, placeOf, stateOf, hasMore, geoFor };
}

/** True when a page can offer a dialable phone or a shown website. */
export function reachable(h) {
  const phones = [h.contact?.phone, h.contact?.phone_alt].filter(Boolean);
  return phones.some((p) => telHref(p)) || Boolean(websiteFor(h));
}
