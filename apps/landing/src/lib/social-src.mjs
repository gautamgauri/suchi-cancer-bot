/**
 * Visits from SCCF's own social posts arrive with `?src=social-<platform>`
 * (apps/api/src/modules/social/links.ts). The daily report counts chat
 * sessions by source code, and the chat links on the site carry a page-type
 * code (src/lib/chat-link.ts). On a visit from a post, this swaps the post's
 * code into the chat links instead, for the rest of the browser session, so
 * a visitor who reads the page and then opens the chat is counted under the
 * platform the post was on.
 *
 * Only these four codes are carried. Anything else in the address is ignored.
 */
export const SOCIAL_SRC_CODES = ['social-linkedin', 'social-facebook', 'social-instagram', 'social-x'];
export const CHAT_ORIGIN = 'https://chat.suchitracancercare.org';
const KEY = 'sccf-social-src';

/** The social code in a query string, or null. A repeated parameter counts as absent. */
export function socialSourceFrom(search) {
  const all = new URLSearchParams(search || '').getAll('src');
  return all.length === 1 && SOCIAL_SRC_CODES.includes(all[0]) ? all[0] : null;
}

/** Point each chat link at the same page with `src` set to `code`. Returns how many changed. */
export function retagChatLinks(anchors, code) {
  if (!SOCIAL_SRC_CODES.includes(code)) return 0;
  let n = 0;
  for (const a of anchors) {
    let url;
    try {
      url = new URL(a.getAttribute('href'));
    } catch {
      continue;
    }
    if (url.origin !== CHAT_ORIGIN) continue;
    url.searchParams.set('src', code);
    a.setAttribute('href', url.href);
    n++;
  }
  return n;
}

/** Browser entry point. Storage may be blocked, so every access is guarded. */
export function applySocialSource(win) {
  let code = socialSourceFrom(win.location.search);
  try {
    if (code) win.sessionStorage.setItem(KEY, code);
    else code = win.sessionStorage.getItem(KEY);
  } catch {
    // private mode or blocked storage: use only this page's code
  }
  if (!code || !SOCIAL_SRC_CODES.includes(code)) return 0;
  return retagChatLinks(win.document.querySelectorAll(`a[href^="${CHAT_ORIGIN}/"]`), code);
}
