/**
 * Structured data (JSON-LD) and locale helpers for the landing site.
 *
 * Rule for everything in this file: emit only properties backed by real data
 * in the repo. Articles are AI drafts (frontmatter `review_status: ai_draft`),
 * so nothing here may claim medical review, a reviewer, or a review date.
 */

export const SITE_URL = 'https://suchitracancercare.org';
export const ORG_ID = `${SITE_URL}/#organization`;
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/channel/UCI242a2_VRTCdCbpXzyeW4w';

type JsonLd = Record<string, unknown>;

/** Map an article `locale` value to a BCP 47 tag for `<html lang>` and `inLanguage`. */
export function localeToLang(locale: string | undefined): string {
  switch (locale) {
    case 'hi':
      return 'hi';
    case 'hinglish':
      // Hindi written in Latin script.
      return 'hi-Latn';
    default:
      return 'en';
  }
}

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'NGO',
    '@id': ORG_ID,
    name: 'Suchitra Cancer Care Foundation',
    alternateName: 'SCCF',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    email: 'info@suchitracancercare.org',
    sameAs: [YOUTUBE_CHANNEL_URL],
  };
}

export interface Crumb {
  name: string;
  /** Site-relative path with leading and trailing slash, e.g. `/watch/`. */
  path: string;
}

export function breadcrumbJsonLd(crumbs: Crumb[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: new URL(c.path, SITE_URL).href,
    })),
  };
}

export interface ArticleLdInput {
  title: string;
  summary: string;
  path: string;
  locale?: string;
}

/**
 * Plain `Article`. `MedicalWebPage` was considered and not used: its value
 * lies in `lastReviewed` and `reviewedBy`, which these drafts cannot carry.
 */
export function articleJsonLd(a: ArticleLdInput): JsonLd {
  const url = new URL(a.path, SITE_URL).href;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.summary.trim(),
    url,
    mainEntityOfPage: url,
    inLanguage: localeToLang(a.locale),
    publisher: { '@id': ORG_ID },
  };
}

export interface VideoLdInput {
  youtubeId: string;
  title: string;
  description: string;
  path: string;
}

/**
 * `uploadDate` is left out on purpose: the `date` values in videos.json are
 * sequential placeholders (2024-01-01, 2024-01-02, ...), not YouTube upload
 * dates. Add it once real dates are recorded. Until then Search Console will
 * report these items as missing a required field.
 */
export function videoJsonLd(v: VideoLdInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: v.title,
    description: v.description,
    thumbnailUrl: [`https://img.youtube.com/vi/${v.youtubeId}/hqdefault.jpg`],
    // No `contentUrl`. It must point at the media file itself, and a YouTube
    // watch page is a player page. The player belongs in `embedUrl` only.
    embedUrl: `https://www.youtube.com/embed/${v.youtubeId}`,
    url: new URL(v.path, SITE_URL).href,
    publisher: { '@id': ORG_ID },
  };
}

/** Serialise for a `<script type="application/ld+json">` body. Escapes `<` so text cannot close the tag. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
