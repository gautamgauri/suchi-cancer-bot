/**
 * Pages kept out of the sitemap. Read by astro.config.mjs (sitemap filter)
 * and by scripts/verify-build.mjs.
 *
 * THIN_HUBS are hub pages that have no articles yet and show only a
 * "coming soon" notice. They are still built and linked, but there is
 * nothing on them worth offering to search engines. The verify script
 * warns when a listed hub gains articles, so it can be removed from here.
 */
export const THIN_HUBS = ['/living-with-cancer/', '/resources/'];

/** Text that marks a hub page as having no articles. */
export const COMING_SOON_TEXT = 'Articles in this section are coming soon.';

/** Sitemap filter for @astrojs/sitemap. `page` is an absolute URL. */
export function includeInSitemap(page) {
  return !THIN_HUBS.includes(new URL(page).pathname);
}
