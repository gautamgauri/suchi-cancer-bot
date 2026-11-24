#!/usr/bin/env node
/**
 * Post-build checks for the landing site. Run after `astro build`:
 *   npm run verify
 *
 * Fails (exit 1) when:
 *   - robots.txt or the sitemap is missing, or the sitemap leaves out an indexable page
 *   - any JSON-LD block does not parse, or any page claims medical review
 *   - a page shows a review label ("Reviewed", "Last reviewed") beside an article whose
 *     frontmatter does not record a completed review (src/lib/review-status.mjs)
 *   - a page lacks a <title> or meta description, or an indexable page has a wrong canonical URL
 *   - an internal link points at a page that was not built
 *   - any JSON-LD block carries a rating or a review
 *   - the hospital section (src/lib/hospital-pages.mjs) is wrong: an entry without a
 *     page has one, an expected page is missing, a hospital page shows a value that is
 *     not in the data for that hospital, shows a doctor's name or a free-text note,
 *     or two pages in the section share a title
 *
 * Warns (exit 0) when:
 *   - two indexable pages share a <title> or meta description
 *   - a hub listed in THIN_HUBS has gained articles, or a 404 or noindex page is in the sitemap
 *   - an entry on the KNOWN_BROKEN list is no longer broken
 *
 * A 404 page and any page with a `noindex` robots meta are not indexable.
 * They are left out of the sitemap, canonical and duplicate checks.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THIN_HUBS, COMING_SOON_TEXT } from '../src/lib/sitemap-exclude.mjs';
import { REVIEW_LABEL_ATTR, isReviewed } from '../src/lib/review-status.mjs';
import {
  hospitalSite,
  hospitalPath,
  websiteFor,
  telHref,
  TEL_HREF_RE,
  HELD,
  APPROVED_PAGE_IDS,
  isUnknownDeptCode,
  hospitalPageTitle,
  cityHeading,
  stateHeading,
} from '../src/lib/hospital-pages.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ARTICLES = fileURLToPath(new URL('../src/content/articles/', import.meta.url));
const HOSPITALS = fileURLToPath(new URL('../src/content/hospitals.json', import.meta.url));
const SITE = 'https://suchitracancercare.org';
const errors = [];
const warnings = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));
const pagePath = (file) => '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/');
const builtPaths = new Set(htmlFiles.map(pagePath));

const is404 = (path) => path === '/404.html' || path === '/404/';
const hasNoindex = (html) =>
  [...html.matchAll(/<meta\s+name="robots"\s+content="([^"]*)"/gi)].some((m) => /noindex/i.test(m[1]));

// Review status of every article, from its frontmatter. A missing
// review_status is the schema default, ai_draft.
const reviewStatus = new Map();
for (const file of walk(ARTICLES).filter((f) => /\.mdx?$/.test(f))) {
  const front = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const field = (name) => front.match(new RegExp(`^${name}:\\s*["']?([^"'\\r\\n]+?)["']?\\s*$`, 'm'))?.[1];
  const id = field('page_id');
  if (id) reviewStatus.set(id, field('review_status') ?? 'ai_draft');
}
if (reviewStatus.size === 0) errors.push(`no articles found under ${ARTICLES}`);

// A review label is text a reader would take as a statement of clinical review.
const REVIEW_LABEL_RE = /(?<![A-Za-z])(?:(?:Last|Medically|Clinically) reviewed|Reviewed)(?![A-Za-z])/g;
const MARKED_LABEL_RE = new RegExp(
  `<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\b${REVIEW_LABEL_ATTR}="([^"]*)"[^>]*>[\\s\\S]*?<\\/\\1>`,
  'g',
);
const visibleText = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
let reviewLabels = 0;
let unmarkedLabels = 0;

// robots.txt
const robotsFile = join(DIST, 'robots.txt');
if (!existsSync(robotsFile)) errors.push('robots.txt missing');
else if (!readFileSync(robotsFile, 'utf8').includes(`Sitemap: ${SITE}/sitemap-index.xml`)) {
  errors.push('robots.txt does not point at the sitemap index');
}

// Sitemap
const sitemapFiles = readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f));
if (!existsSync(join(DIST, 'sitemap-index.xml')) || sitemapFiles.length === 0) errors.push('sitemap missing');
const sitemapUrls = sitemapFiles.flatMap((f) =>
  [...readFileSync(join(DIST, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
);
for (const u of sitemapUrls) {
  if (!u.startsWith(`${SITE}/`)) errors.push(`sitemap URL on wrong origin: ${u}`);
}
const sitemapPaths = new Set(sitemapUrls.map((u) => new URL(u).pathname));

// Per-page checks
const titles = new Map();
const descriptions = new Map();
let jsonLdBlocks = 0;
let notIndexable = 0;
const typeCounts = {};
const brokenLinks = new Set();

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const path = pagePath(file);
  const indexable = !is404(path) && !hasNoindex(html);

  if (indexable) {
    if (THIN_HUBS.includes(path)) {
      if (!html.includes(COMING_SOON_TEXT)) {
        warnings.push(`${path} now has articles. Remove it from THIN_HUBS so it joins the sitemap.`);
      }
    } else if (!sitemapPaths.has(path)) {
      errors.push(`page missing from sitemap: ${path}`);
    }
  } else {
    notIndexable += 1;
    if (sitemapPaths.has(path)) warnings.push(`${path} is a 404 or noindex page but is in the sitemap`);
  }

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!title) errors.push(`${path}: no <title>`);
  if (!desc) errors.push(`${path}: no meta description`);
  if (indexable && title) titles.set(title, [...(titles.get(title) ?? []), path]);
  if (indexable && desc) descriptions.set(desc, [...(descriptions.get(desc) ?? []), path]);
  if (!/<html lang="[a-zA-Z-]+"/.test(html)) errors.push(`${path}: no lang attribute`);
  if (indexable && !html.includes(`<link rel="canonical" href="${SITE}${path}"`)) {
    errors.push(`${path}: canonical missing or wrong`);
  }

  // Review labels. Each one must carry REVIEW_LABEL_ATTR naming a reviewed
  // article. Any label text left once the marked labels are removed is unmarked.
  for (const m of html.matchAll(MARKED_LABEL_RE)) {
    reviewLabels += 1;
    const id = m[2];
    if (!reviewStatus.has(id)) {
      errors.push(`${path}: review label for unknown article "${id}"`);
    } else if (!isReviewed({ review_status: reviewStatus.get(id) })) {
      errors.push(`${path}: review label beside article "${id}", whose review_status is ${reviewStatus.get(id)}`);
    }
  }
  const unmarked = visibleText(html.replace(MARKED_LABEL_RE, ' ')).match(REVIEW_LABEL_RE);
  if (unmarked) {
    unmarkedLabels += unmarked.length;
    errors.push(
      `${path}: ${unmarked.length} review label(s) ("${unmarked[0]}") with no ${REVIEW_LABEL_ATTR}. Show review labels only through isReviewed() in src/lib/review-status.mjs.`,
    );
  }

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    jsonLdBlocks += 1;
    try {
      const data = JSON.parse(m[1]);
      typeCounts[data['@type']] = (typeCounts[data['@type']] ?? 0) + 1;
      // Articles are AI drafts. No markup may claim review.
      for (const key of ['reviewedBy', 'lastReviewed', 'medicalAudience', 'aggregateRating', 'review']) {
        if (key in data) errors.push(`${path}: JSON-LD claims ${key}`);
      }
    } catch (e) {
      errors.push(`${path}: JSON-LD does not parse (${e.message})`);
    }
  }

  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    let href = m[1];
    if (href.startsWith(SITE)) href = href.slice(SITE.length) || '/';
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const target = href.split(/[?#]/)[0];
    if (/\.[a-z0-9]+$/i.test(target)) {
      if (!existsSync(join(DIST, target))) brokenLinks.add(`${path} -> ${href}`);
    } else {
      const withSlash = target.endsWith('/') ? target : `${target}/`;
      if (!builtPaths.has(withSlash)) brokenLinks.add(`${path} -> ${href}`);
    }
  }
}

// Repeated titles or descriptions are poor for search but are not a reason to
// stop a deploy. Two videos can share a title on YouTube, for example.
for (const [t, paths] of titles) if (paths.length > 1) warnings.push(`duplicate title "${t}": ${paths.join(', ')}`);
for (const [, paths] of descriptions) if (paths.length > 1) warnings.push(`duplicate description on: ${paths.join(', ')}`);

// Broken links that predate this check. Remove an entry once its page exists
// or the link is fixed. Anything not listed here fails the build. An entry
// that is no longer broken is reported as a warning so the list can be pruned.
//   /about/safety/  footer link, no page has been written yet
//   /articles/...   links inside article markdown bodies, which need SCCF review to edit
const KNOWN_BROKEN = new Set([
  '/about/safety/',
  '/articles/breast-cancer/',
  '/articles/cancer-care-in-bihar/',
  '/articles/cervical-cancer/',
  '/articles/colorectal-cancer/',
  '/articles/lung-cancer/',
  '/articles/lymphoma/',
  '/articles/oral-cancer/',
  '/articles/questions-to-ask-your-doctor/',
]);
const brokenTargets = new Set([...brokenLinks].map((l) => l.split(' -> ')[1]));
const unexpectedBroken = [...brokenLinks].filter((l) => !KNOWN_BROKEN.has(l.split(' -> ')[1]));
for (const t of KNOWN_BROKEN) {
  if (!brokenTargets.has(t)) warnings.push(`KNOWN_BROKEN entry ${t} is no longer broken. Remove it from the list.`);
}

// Hospital, city and state pages (src/lib/hospital-pages.mjs). These checks
// compare each page with the data it was built from, so a normal data update
// from the navigator pipeline passes. They fail only when a page shows
// something the data does not hold, or the set of pages is wrong.
const hospitalData = JSON.parse(readFileSync(HOSPITALS, 'utf8'));
const hsite = hospitalSite(hospitalData);
const SECTION = '/find-care/hospitals/';
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
};
const fieldValue = (h, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), h);
const presentValue = (v) => v !== null && v !== undefined && String(v).trim() !== '';

const expectedSection = new Map(); // path -> kind
for (const h of hsite.publishable) expectedSection.set(hospitalPath(h), 'hospital');
for (const p of hsite.places) expectedSection.set(p.path, 'city');
for (const s of hsite.states) expectedSection.set(s.path, 'state');
for (const e of hsite.excluded) {
  if (builtPaths.has(`${SECTION}${e.id}/`)) errors.push(`excluded hospital ${e.id} has a page (${e.reason})`);
}
for (const path of builtPaths) {
  const m = path.match(/^\/find-care\/hospitals\/([^/]+)\/$/);
  if (m && m[1] !== 'in' && m[1] !== 'state' && !APPROVED_PAGE_IDS.has(m[1])) {
    errors.push(`hospital page ${path} is for an id not on the approved list (src/content/hospital-pages-approved.mjs)`);
  }
}
for (const id of APPROVED_PAGE_IDS) {
  if (!hsite.publishable.some((h) => h.id === id)) {
    warnings.push(`approved id ${id} has no page (${hsite.excluded.find((e) => e.id === id)?.reason ?? 'not in hospitals.json'})`);
  }
}
for (const id of Object.keys(HELD)) {
  if (builtPaths.has(`${SECTION}${id}/`)) errors.push(`held hospital ${id} has a page (${HELD[id]})`);
}
for (const path of builtPaths) {
  if (path.startsWith(SECTION) && path !== SECTION && !expectedSection.has(path)) {
    errors.push(`unexpected page in the hospital section: ${path}`);
  }
}
for (const [path] of expectedSection) if (!builtPaths.has(path)) errors.push(`hospital section page not built: ${path}`);

// Text from fields that must never appear on the new pages: doctor names
// (an earlier research agent invented many), and free-text notes and flags
// that have not been through review for publication.
const doctorNames = hospitalData.hospitals.flatMap((h) =>
  (h.key_doctors ?? []).map((d) => (typeof d === 'string' ? d : d?.name)).filter((n) => n && n.length >= 6),
);
const sectionTitles = new Map();
const KNOWN_FIELDS = new Set(['name', 'type', 'city', 'state', 'contact.address', 'contact.phone', 'contact.phone_alt', 'contact.website']);
const FIELD_RE = /<([a-z][a-z0-9]*)\b([^>]*\bdata-field="[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g;

for (const [path, kind] of expectedSection) {
  if (!builtPaths.has(path)) continue;
  const html = readFileSync(join(DIST, path, 'index.html'), 'utf8');
  const text = visibleText(html);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (title) sectionTitles.set(title, [...(sectionTitles.get(title) ?? []), path]);
  for (const name of doctorNames) if (text.includes(name) || html.includes(name)) errors.push(`${path}: shows a doctor's name from key_doctors`);
  if (kind !== 'hospital') continue;

  const h = hsite.publishable.find((x) => hospitalPath(x) === path);
  const banned = [h.notes, h.risk_flag, h.sccf_notes, ...(h.navigation_notes ?? [])].filter((s) => typeof s === 'string' && s.length >= 12);
  for (const s of banned) if (decode(html).includes(s)) errors.push(`${path}: shows free-text notes from the data`);

  const rawSite = h.contact?.website;
  if (rawSite && !websiteFor(h) && decode(html).includes(rawSite)) errors.push(`${path}: links or shows a held or malformed website`);
  if (rawSite && websiteFor(h) && !html.includes(`href="${websiteFor(h)}"`)) warnings.push(`${path}: checked website not linked`);

  let marked = 0;
  for (const m of html.matchAll(FIELD_RE)) {
    marked += 1;
    const attrs = m[2];
    const field = attr(attrs, 'data-field');
    const shown = decode(m[3].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (field === 'departments') {
      const raw = attr(attrs, 'data-raw');
      if (!(h.departments ?? []).includes(raw)) errors.push(`${path}: department "${raw}" is not in the data`);
      else if (isUnknownDeptCode(raw)) warnings.push(`${path}: department code "${raw}" has no label in DEPT_LABELS (shown tidied)`);
    } else if (field === 'verified_date') {
      if (attr(attrs, 'datetime') !== h.verified_date) errors.push(`${path}: verified date does not match the data`);
    } else if (field === 'pmjay_empanelled') {
      if (h.pmjay_empanelled !== true) errors.push(`${path}: shows PMJAY but the data does not record it`);
    } else if (field === 'geo') {
      const geo = hsite.geoFor(h);
      if (!geo || !attr(attrs, 'href')?.includes(`${geo.latitude},${geo.longitude}`)) errors.push(`${path}: map link without address-level coordinates`);
    } else if (field === 'contact.website') {
      const site = websiteFor(h);
      if (!site) errors.push(`${path}: shows a website that is missing, malformed or held`);
      else if (shown !== site) errors.push(`${path}: website shown as "${shown}", data has "${site}"`);
    } else if (KNOWN_FIELDS.has(field)) {
      const value = fieldValue(h, field);
      if (!presentValue(value)) errors.push(`${path}: shows ${field}, which is empty in the data`);
      else if (shown !== String(value).replace(/\s+/g, ' ').trim()) errors.push(`${path}: ${field} shown as "${shown}", data has "${value}"`);
    } else {
      errors.push(`${path}: unknown data-field "${field}"`);
    }
  }
  if (marked === 0) errors.push(`${path}: no data-field markers found`);

  // Every value cell in the facts table must come from a marked field.
  const facts = html.match(/<table\b[^>]*\bdata-facts\b[^>]*>([\s\S]*?)<\/table>/)?.[1];
  if (!facts) errors.push(`${path}: facts table missing`);
  else for (const td of facts.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)) {
    if (!td[1].includes('data-field=')) errors.push(`${path}: facts table cell not taken from a data field`);
  }

  // Hospital JSON-LD must match the data and add nothing.
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let ld;
    try { ld = JSON.parse(m[1]); } catch { continue; }
    if (ld['@type'] !== 'Hospital') continue;
    const allowed = new Set(['@context', '@type', '@id', 'name', 'mainEntityOfPage', 'address', 'telephone', 'url', 'geo']);
    for (const k of Object.keys(ld)) if (!allowed.has(k)) errors.push(`${path}: Hospital JSON-LD has unexpected property ${k}`);
    if (ld.name !== h.name) errors.push(`${path}: Hospital JSON-LD name does not match the data`);
    const phone = h.contact?.phone || null;
    if ((ld.telephone ?? null) !== (phone && telHref(phone) ? phone : null)) errors.push(`${path}: Hospital JSON-LD telephone does not match the data`);
    if ((ld.url ?? null) !== websiteFor(h)) errors.push(`${path}: Hospital JSON-LD url is not the checked website`);
    if (ld.geo && !hsite.geoFor(h)) errors.push(`${path}: Hospital JSON-LD geo without address-level coordinates`);
  }
}
for (const [t, paths] of sectionTitles) if (paths.length > 1) errors.push(`hospital section pages share a title "${t}": ${paths.join(', ')}`);

// Every tel: link on the site must dial exactly one valid Indian number.
for (const file of htmlFiles) {
  for (const m of readFileSync(file, 'utf8').matchAll(/href="(tel:[^"]*)"/g)) {
    if (!TEL_HREF_RE.test(m[1])) errors.push(`${pagePath(file)}: tel: link "${m[1]}" is not a single valid number`);
  }
}

// Rules of src/lib/hospital-pages.mjs on made-up data, so a change to the
// rules that would let these cases through fails the build.
{
  const mk = (id, over = {}) => ({
    id,
    name: `Test Hospital ${id}`,
    city: 'Testpur',
    state: 'Teststate',
    type: 'Private',
    status: 'active',
    verified_date: '2026-05-01',
    departments: ['medical_oncology'],
    pmjay_empanelled: null,
    contact: { phone: null, address: 'Test Road', website: `https://${id}.example.in` },
    latitude: null,
    longitude: null,
    geocode_confidence: 'city',
    ...over,
  });
  const at = (lat, lon) => ({ latitude: lat, longitude: lon, geocode_confidence: 'address' });
  const cases = [
    {
      name: 'a renamed twin of a flagged entry sharing its website host gets no page',
      data: [
        mk('flagged', { risk_flag: 'x', contact: { phone: '0612-2000001', address: 'A', website: 'https://www.example-hosp.in' } }),
        mk('renamed', { name: 'Another Name', contact: { phone: '0612-2000002', address: 'B', website: 'https://example-hosp.in/cancer' } }),
      ],
      noPage: ['flagged', 'renamed'],
    },
    {
      name: 'a renamed twin of a flagged entry 100 m away gets no page',
      data: [mk('flagged', { risk_flag: 'x', ...at(25.6, 85.1) }), mk('renamed', { name: 'Another Name', ...at(25.6009, 85.1) })],
      noPage: ['flagged', 'renamed'],
    },
    {
      name: 'a held entry and its twin get no page',
      data: [mk('aiims-hyderabad'), mk('twin', { name: 'Test Hospital aiims-hyderabad' })],
      noPage: ['aiims-hyderabad', 'twin'],
    },
    {
      name: 'duplicates that disagree on the main phone get no page',
      data: [mk('one', { contact: { phone: '0612-2000001' } }), mk('two', { contact: { phone: '0612-2000009' }, name: 'Test Hospital one' })],
      noPage: ['one', 'two'],
    },
    {
      name: 'a hospital sharing coordinates with a flagged entry keeps its page',
      data: [mk('flagged', { risk_flag: 'x', ...at(25.6, 85.1) }), mk('neighbour', { name: 'Another Name', ...at(25.6, 85.1) })],
      noPage: ['flagged'],
      page: ['neighbour'],
    },
    {
      name: 'an entry with no dialable phone and no website gets no page',
      data: [mk('mute', { contact: { phone: '+91-0542-6917700', website: null } })],
      noPage: ['mute'],
    },
    {
      name: 'an entry not on the approved list gets no page',
      data: [mk('a'), mk('b')],
      approved: new Set(['a']),
      noPage: ['b'],
      page: ['a'],
    },
    {
      name: 'a duplicate of a listed hospital does not make a place page partial',
      data: [
        mk('a', { contact: { phone: '0612-2000001', website: null } }),
        mk('a-old', { name: 'Test Hospital a', verified_date: '2026-04-01', contact: { phone: '0612-2000001', website: null } }),
        mk('b'),
      ],
      noPage: ['a-old'],
      partial: false,
    },
    {
      name: 'a different hospital on the directory makes a place page partial',
      data: [mk('a'), mk('b'), mk('c', { status: 'needs_verification' })],
      noPage: ['c'],
      partial: true,
    },
    {
      name: 'a city with one hospital gets no city page',
      data: [mk('solo', { city: 'Lonely' }), mk('a'), mk('b')],
      noPage: [],
      cities: ['testpur'],
    },
    {
      name: 'a city and a state with the same name have different titles',
      data: [
        mk('d1', { city: 'Delhi', state: 'Delhi' }),
        mk('d2', { city: 'Delhi', state: 'Delhi' }),
        mk('d3', { city: 'New Delhi', state: 'Delhi' }),
        mk('d4', { city: 'Narela', state: 'Delhi' }),
        mk('d5', { city: 'Narela', state: 'Delhi' }),
      ],
      noPage: [],
      uniqueTitles: true,
    },
  ];
  let passed = 0;
  for (const c of cases) {
    const site = hospitalSite({ hospitals: c.data }, { approved: c.approved ?? null });
    const pageIds = new Set(site.publishable.map((h) => h.id));
    let ok = true;
    for (const id of c.noPage) if (pageIds.has(id)) ok = false;
    for (const id of c.page ?? []) if (!pageIds.has(id)) ok = false;
    if (c.partial !== undefined && (site.places.length !== 1 || site.hasMore.city(site.places[0]) !== c.partial)) ok = false;
    if (c.cities && JSON.stringify(site.places.map((p) => p.slug)) !== JSON.stringify(c.cities)) ok = false;
    if (c.uniqueTitles) {
      const all = [
        ...site.publishable.map(hospitalPageTitle),
        ...site.places.map(cityHeading),
        ...site.states.map(stateHeading),
      ];
      if (site.states.length === 0 || site.places.length === 0 || new Set(all).size !== all.length) ok = false;
    }
    if (ok) passed += 1;
    else errors.push(`hospital page rule broken: ${c.name}`);
  }
  for (const [phone, want] of [
    ['+91-612-2250127', 'tel:+916122250127'],
    ['0612-2297631', 'tel:+916122297631'],
    ['1800-313-4922', 'tel:18003134922'],
    ['+91-86177-87387', 'tel:+918617787387'],
    ['+91-0542-6917700', null],
    ['033-2475-9313 / 033-3506-0600', null],
  ]) {
    if (telHref(phone) !== want) errors.push(`telHref("${phone}") gave ${telHref(phone)}, expected ${want}`);
    else passed += 1;
  }
  console.log(`hospital rule self-tests passed: ${passed}`);
}

console.log(
  `hospital pages: ${hsite.publishable.length}, city pages: ${hsite.places.length}, state pages: ${hsite.states.length}, ` +
    `entries without a page: ${hsite.excluded.length} (${hsite.excluded.map((e) => e.id).join(', ')})`,
);
console.log(`pages built: ${builtPaths.size} (${notIndexable} not indexable, ${THIN_HUBS.length} thin hubs left out of the sitemap)`);
console.log(`sitemap URLs: ${sitemapUrls.length}`);
console.log(`JSON-LD blocks parsed: ${jsonLdBlocks} ${JSON.stringify(typeCounts)}`);
console.log(`unique titles: ${titles.size}, unique descriptions: ${descriptions.size}`);
console.log(`review labels: ${reviewLabels} marked, ${unmarkedLabels} unmarked (articles recorded as reviewed: ${[...reviewStatus.values()].filter((v) => isReviewed({ review_status: v })).length} of ${reviewStatus.size})`);
console.log(`broken internal links: ${brokenLinks.size} (${unexpectedBroken.length} not on the known list)`);
for (const l of unexpectedBroken) errors.push(`broken internal link: ${l}`);

if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  - ${w}`);
}
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('landing build verified');
