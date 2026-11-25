/**
 * LinkedIn organisation posts and X posts.
 *
 * LinkedIn: POST https://api.linkedin.com/rest/posts with the LinkedIn-Version
 * (YYYYMM) and X-Restli-Protocol-Version: 2.0.0 headers. Needs a member token
 * with w_organization_social from a page ADMINISTRATOR, CONTENT_ADMIN or
 * DIRECT_SPONSORED_CONTENT_POSTER. Tokens last 60 days. The post id comes
 * back in the x-restli-id header
 * (learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api).
 *
 * X: POST https://api.x.com/2/tweets with {"text": ...}, signed with OAuth
 * 1.0a user context (docs.x.com/x-api/posts/create-post and the v2
 * authentication mapping). The four keys come from the X developer console.
 * OAuth 1.0a user tokens do not expire but can be revoked. X charges per
 * request, and a post containing a link costs more than one without
 * (docs.x.com/x-api/getting-started/pricing). Behind SOCIAL_X_ENABLED.
 */
import { createHmac, randomBytes } from "node:crypto";
import {
  FetchLike, fetchWithTimeout, httpOutcome, networkOutcome, PlatformClient, PlatformPayload, PublishOutcome, readBody,
} from "./platform-client";

// ---------------------------------------------------------------------------
// LinkedIn
// ---------------------------------------------------------------------------

export const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
/** A version listed on the Posts API page (li-lms-2026-01 to 2026-11 on 25 Nov 2026). */
export const LINKEDIN_API_VERSION = "202608";

/** Escape LinkedIn "little text" reserved characters in commentary. */
export function escapeLittleText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

export class LinkedInClient implements PlatformClient {
  readonly platform = "linkedin" as const;
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  isConfigured(): boolean {
    return Boolean(process.env.LINKEDIN_ACCESS_TOKEN && /^urn:li:(organization|person):\S+$/.test(process.env.LINKEDIN_AUTHOR_URN ?? ""));
  }

  private body(text: string) {
    return {
      author: process.env.LINKEDIN_AUTHOR_URN ?? "{LINKEDIN_AUTHOR_URN}",
      commentary: escapeLittleText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
  }

  render(p: PlatformPayload) {
    return { method: "POST", url: LINKEDIN_POSTS_URL, headers: { "LinkedIn-Version": LINKEDIN_API_VERSION, "X-Restli-Protocol-Version": "2.0.0" }, body: this.body(p.text) };
  }

  async publish(p: PlatformPayload): Promise<PublishOutcome> {
    const token = process.env.LINKEDIN_ACCESS_TOKEN;
    if (!token) return { kind: "not_configured", error: "LINKEDIN_ACCESS_TOKEN is not set" };
    if (!/^urn:li:(organization|person):\S+$/.test(process.env.LINKEDIN_AUTHOR_URN ?? "")) {
      return { kind: "not_configured", error: 'LINKEDIN_AUTHOR_URN must be "urn:li:organization:<id>"' };
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(this.fetchFn, LINKEDIN_POSTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Restli-Protocol-Version": "2.0.0",
          "LinkedIn-Version": LINKEDIN_API_VERSION,
        },
        body: JSON.stringify(this.body(p.text)),
      });
    } catch (err) {
      return networkOutcome(err);
    }
    if (!res.ok) {
      const { text } = await readBody(res);
      const detail = res.status === 401
        ? "token expired or revoked, see docs/LINKEDIN_ORG_POSTING.md"
        : res.status === 403
          ? "token lacks w_organization_social or the member lost the page role"
          : text;
      return httpOutcome(res.status, detail, res.status === 401);
    }
    const id = res.headers.get("x-restli-id");
    if (!id) return { kind: "uncertain", error: "LinkedIn answered without x-restli-id", httpStatus: res.status };
    return { kind: "published", postId: id, permalink: `https://www.linkedin.com/feed/update/${id}/`, httpStatus: res.status };
  }
}

// ---------------------------------------------------------------------------
// X
// ---------------------------------------------------------------------------

export const X_POSTS_URL = "https://api.x.com/2/tweets";

export function xEnabled(): boolean {
  return process.env.SOCIAL_X_ENABLED === "true";
}

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
export function oauthEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface OAuth1Keys {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/**
 * OAuth 1.0a HMAC-SHA1 signature (docs.x.com, "Creating a signature").
 * `params` are the query or form parameters that take part in the signature.
 * A JSON body does not.
 */
export function oauth1Signature(method: string, url: string, oauthParams: Record<string, string>, params: Record<string, string>, consumerSecret: string, tokenSecret: string): string {
  const all = { ...params, ...oauthParams };
  const paramString = Object.keys(all)
    .map((k) => [oauthEncode(k), oauthEncode(all[k])] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${method.toUpperCase()}&${oauthEncode(url)}&${oauthEncode(paramString)}`;
  const key = `${oauthEncode(consumerSecret)}&${oauthEncode(tokenSecret)}`;
  return createHmac("sha1", key).update(base).digest("base64");
}

export function oauth1Header(method: string, url: string, keys: OAuth1Keys, now = Date.now(), nonce = randomBytes(16).toString("hex")): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(now / 1000)),
    oauth_token: keys.token,
    oauth_version: "1.0",
  };
  oauth.oauth_signature = oauth1Signature(method, url, oauth, {}, keys.consumerSecret, keys.tokenSecret);
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${oauthEncode(k)}="${oauthEncode(oauth[k])}"`).join(", ");
}

function xKeys(): OAuth1Keys | null {
  const k = {
    consumerKey: process.env.X_API_KEY ?? "",
    consumerSecret: process.env.X_API_SECRET ?? "",
    token: process.env.X_ACCESS_TOKEN ?? "",
    tokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? "",
  };
  return k.consumerKey && k.consumerSecret && k.token && k.tokenSecret ? k : null;
}

export class XClient implements PlatformClient {
  readonly platform = "x" as const;
  constructor(private readonly fetchFn: FetchLike = fetch) {}

  isConfigured(): boolean {
    return xEnabled() && xKeys() !== null;
  }

  render(p: PlatformPayload) {
    return { method: "POST", url: X_POSTS_URL, auth: "OAuth 1.0a user context", body: { text: p.text } };
  }

  async publish(p: PlatformPayload): Promise<PublishOutcome> {
    if (!xEnabled()) return { kind: "not_configured", error: "X is switched off (SOCIAL_X_ENABLED is not true)" };
    const keys = xKeys();
    if (!keys) return { kind: "not_configured", error: "X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET must all be set" };
    let res: Response;
    try {
      res = await fetchWithTimeout(this.fetchFn, X_POSTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: oauth1Header("POST", X_POSTS_URL, keys) },
        body: JSON.stringify({ text: p.text }),
      });
    } catch (err) {
      return networkOutcome(err);
    }
    const { text, json } = await readBody(res);
    if (!res.ok) {
      const j = json as { detail?: string; title?: string; errors?: Array<{ message?: string }> } | undefined;
      const detail = j?.detail ?? j?.title ?? j?.errors?.[0]?.message ?? text;
      return httpOutcome(res.status, detail, res.status === 401);
    }
    const id = (json as { data?: { id?: string } } | undefined)?.data?.id;
    if (!id) return { kind: "uncertain", error: "X answered without a post id", httpStatus: res.status };
    return { kind: "published", postId: id, permalink: `https://x.com/i/web/status/${id}`, httpStatus: res.status };
  }
}
