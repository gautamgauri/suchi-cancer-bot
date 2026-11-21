/**
 * Links from the site to the Suchi web chat carry a short `src` code that
 * names the kind of page the visitor came from. The chat app passes it to
 * the API, which counts sessions by source in the daily report.
 *
 * Codes must stay short: lower-case letters, digits, hyphen and underscore,
 * at most 32 characters. The API drops anything else.
 */
export const CHAT_URL = 'https://chat.suchitracancercare.org/';

export type ChatSource =
  | 'site-home'
  | 'site-about'
  | 'site-hub'
  | 'site-article'
  | 'site-video'
  | 'site-hospitals'
  | 'site-other';

const HUB_PATHS = new Set([
  '/cancer-types/',
  '/symptoms/',
  '/tests-treatment/',
  '/living-with-cancer/',
  '/find-care/',
  '/resources/',
  '/watch/',
]);

const ARTICLE_PREFIXES = [
  '/cancer-types/',
  '/symptoms/',
  '/tests-treatment/',
  '/living-with-cancer/',
  '/find-care/',
  '/resources/',
];

/** Page-type code for a site path such as `/cancer-types/breast-cancer/`. */
export function chatSourceFor(pathname: string): ChatSource {
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  if (path === '/') return 'site-home';
  if (path === '/about/') return 'site-about';
  if (path === '/find-care/hospitals/') return 'site-hospitals';
  if (HUB_PATHS.has(path)) return 'site-hub';
  if (path.startsWith('/watch/')) return 'site-video';
  if (ARTICLE_PREFIXES.some((p) => path.startsWith(p))) return 'site-article';
  return 'site-other';
}

/** Web chat URL tagged with the page type of `pathname`. */
export function chatUrlFor(pathname: string): string {
  return `${CHAT_URL}?src=${chatSourceFor(pathname)}`;
}
