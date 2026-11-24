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
 *   - a WhatsApp link (wa.me or api.whatsapp.com) does not use SUCHI_WHATSAPP_NUMBER, does
 *     not open in a new tab with rel="noopener", or its decoded text does not end with a
 *     valid "(src: <code>)" line for a known code (src/lib/whatsapp-link.mjs)
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
  SUCHI_WHATSAPP_NUMBER,
  WHATSAPP_SOURCES,
  SOURCE_LINE_RE,
  whatsappGreeting,
} from '../src/lib/whatsapp-link.mjs';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ARTICLES = fileURLToPath(new URL('../src/content/articles/', import.meta.url));
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

// WhatsApp links. Each must go to Suchi's number with the site greeting and a
// known source code on its last line, and open in a new tab.
const WHATSAPP_LINK_RE = /<a\b[^>]*\bhref="(https?:\/\/(?:wa\.me|api\.whatsapp\.com|(?:www\.)?whatsapp\.com)\/[^"]*)"[^>]*>/gi;
const whatsappBySource = Object.fromEntries(WHATSAPP_SOURCES.map((s) => [s, 0]));
const decodeAttr = (v) =>
  v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function checkWhatsAppLink(path, tag, rawHref) {
  const href = decodeAttr(rawHref);
  let url;
  try {
    url = new URL(href);
  } catch {
    errors.push(`${path}: WhatsApp link does not parse: ${href}`);
    return;
  }
  if (url.hostname !== 'wa.me' || url.pathname !== `/${SUCHI_WHATSAPP_NUMBER}`) {
    errors.push(`${path}: WhatsApp link is not https://wa.me/${SUCHI_WHATSAPP_NUMBER}: ${href}`);
    return;
  }
  if (url.protocol !== 'https:') errors.push(`${path}: WhatsApp link is not https: ${href}`);
  if (!/\btarget="_blank"/.test(tag) || !/\brel="[^"]*\bnoopener\b[^"]*"/.test(tag)) {
    errors.push(`${path}: WhatsApp link must have target="_blank" and rel="noopener"`);
  }
  const text = url.searchParams.get('text') ?? '';
  const code = text.match(SOURCE_LINE_RE)?.[1];
  if (!code) {
    errors.push(`${path}: WhatsApp link text does not end with a valid "(src: <code>)" line`);
    return;
  }
  if (!WHATSAPP_SOURCES.includes(code)) {
    errors.push(`${path}: WhatsApp link has unknown source code "${code}"`);
    return;
  }
  if (text !== whatsappGreeting(code)) errors.push(`${path}: WhatsApp link text differs from whatsappGreeting("${code}")`);
  whatsappBySource[code] += 1;
}

// Web chat links, counted by their ?src= code (report only).
const chatBySource = {};

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
      for (const key of ['reviewedBy', 'lastReviewed', 'medicalAudience']) {
        if (key in data) errors.push(`${path}: JSON-LD claims ${key}`);
      }
    } catch (e) {
      errors.push(`${path}: JSON-LD does not parse (${e.message})`);
    }
  }

  for (const m of html.matchAll(WHATSAPP_LINK_RE)) checkWhatsAppLink(path, m[0], m[1]);
  for (const m of html.matchAll(/href="https:\/\/chat\.suchitracancercare\.org\/?([^"]*)"/g)) {
    const src = new URLSearchParams(decodeAttr(m[1]).replace(/^[^?]*\?/, '')).get('src') ?? '(no src)';
    chatBySource[src] = (chatBySource[src] ?? 0) + 1;
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

console.log(`pages built: ${builtPaths.size} (${notIndexable} not indexable, ${THIN_HUBS.length} thin hubs left out of the sitemap)`);
console.log(`sitemap URLs: ${sitemapUrls.length}`);
console.log(`JSON-LD blocks parsed: ${jsonLdBlocks} ${JSON.stringify(typeCounts)}`);
console.log(`unique titles: ${titles.size}, unique descriptions: ${descriptions.size}`);
console.log(`review labels: ${reviewLabels} marked, ${unmarkedLabels} unmarked (articles recorded as reviewed: ${[...reviewStatus.values()].filter((v) => isReviewed({ review_status: v })).length} of ${reviewStatus.size})`);
console.log(`broken internal links: ${brokenLinks.size} (${unexpectedBroken.length} not on the known list)`);
console.log(`WhatsApp links to ${SUCHI_WHATSAPP_NUMBER}: ${JSON.stringify(whatsappBySource)}`);
console.log(`web chat links by src: ${JSON.stringify(chatBySource)}`);
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
