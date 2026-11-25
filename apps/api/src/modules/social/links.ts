/**
 * Links that end every post, each carrying a source code so visits are
 * counted in the daily report under the platform they came from.
 *
 * Web links use `?src=` with the rule in sessions/source-code.ts. WhatsApp
 * links prefill the site's greeting followed by a `(src: <code>)` line, which
 * whatsapp-source.ts strips and records. Only allow-listed WhatsApp codes are
 * read, so every code below must be in WHATSAPP_SOURCE_CODES (a test checks).
 */
import { Platform } from "./social.types";
import { normalizeSourceCode } from "../sessions/source-code";

export const SITE_URL = (process.env.SUCHI_SITE_URL ?? "https://suchitracancercare.org").replace(/\/$/, "");
export const CHAT_URL = "https://chat.suchitracancercare.org/";
/** SCCF's public WhatsApp number for Suchi, as wa.me wants it (country code, no plus). */
export const SUCHI_WHATSAPP_NUMBER = "919430674464";

/** `?src=` codes for web links, one per platform. */
export const WEB_SOURCE_CODES: Record<Platform, string> = {
  linkedin: "social-linkedin",
  facebook: "social-facebook",
  instagram: "social-instagram",
  x: "social-x",
};

/** WhatsApp `(src: ...)` codes, one per platform. Must be on the API allow-list. */
export const WHATSAPP_SOCIAL_CODES: Record<Platform, string> = {
  linkedin: "wa-linkedin",
  facebook: "wa-facebook",
  instagram: "wa-instagram",
  x: "wa-x",
};

for (const code of [...Object.values(WEB_SOURCE_CODES), ...Object.values(WHATSAPP_SOCIAL_CODES)]) {
  if (normalizeSourceCode(code) !== code) throw new Error(`Invalid source code ${code}`);
}

export function webChatLink(platform: Platform): string {
  return `${CHAT_URL}?src=${WEB_SOURCE_CODES[platform]}`;
}

/** A site page such as `/watch/onco-talks-episode-1-oral-cancer/`. */
export function siteLink(path: string, platform: Platform): string {
  if (!path.startsWith("/")) throw new Error(`Site path must start with "/": ${path}`);
  return `${SITE_URL}${path}?src=${WEB_SOURCE_CODES[platform]}`;
}

/**
 * A short greeting keeps the link readable when a platform shows it as text
 * (the site's two-line Hindi and English greeting makes a link of several
 * hundred characters once encoded). whatsapp-source.ts reads the code line
 * whatever greeting sits above it.
 */
export const SOCIAL_WHATSAPP_GREETING = "Hello Suchi";

export function whatsappLink(platform: Platform): string {
  const text = `${SOCIAL_WHATSAPP_GREETING}\n(src: ${WHATSAPP_SOCIAL_CODES[platform]})`;
  // encodeURIComponent leaves brackets alone. Encode them too, so no link
  // finder (ours, or a platform's) ends the link at the ")".
  const encoded = encodeURIComponent(text).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `https://wa.me/${SUCHI_WHATSAPP_NUMBER}?text=${encoded}`;
}

/**
 * Instagram captions cannot hold a working link. The profile link carries
 * the code instead, so the owner sets the profile link to this once.
 */
export function instagramProfileLink(): string {
  return `${SITE_URL}/?src=${WEB_SOURCE_CODES.instagram}`;
}

/** Does `url` carry this platform's code? */
export function carriesPlatformCode(url: string, platform: Platform): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin === "https://wa.me" && parsed.pathname === `/${SUCHI_WHATSAPP_NUMBER}`) {
    const text = parsed.searchParams.get("text") ?? "";
    return text.split("\n").some((l) => l.trim() === `(src: ${WHATSAPP_SOCIAL_CODES[platform]})`);
  }
  const ours = parsed.origin === SITE_URL || `${parsed.origin}/` === CHAT_URL;
  const src = parsed.searchParams.getAll("src");
  return ours && src.length === 1 && src[0] === WEB_SOURCE_CODES[platform];
}

/** The phrase every Instagram caption ends with in place of a link. */
export const INSTAGRAM_PROFILE_PHRASE = /\blink\b[^.]*\bin our profile\b/i;
