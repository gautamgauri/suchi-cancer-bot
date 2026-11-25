/**
 * Credential health for the four platforms, checked once a day by the social
 * tick. The owner gets an email well before a token lapses, and again as the
 * date gets closer, never more than once per stage.
 *
 * LinkedIn: tokens last 60 days and LinkedIn gives no way to ask a token's
 *   age, so the age comes from the creation time of the latest version of the
 *   LINKEDIN_ACCESS_TOKEN secret in Secret Manager (metadata only, never the
 *   value). That needs roles/secretmanager.viewer on that secret for the
 *   runtime service account. Without it the expiry is reported as unknown.
 * Meta: the Graph debug_token endpoint reports whether the Page token is
 *   valid, when it expires (0 means never) and which permissions it carries.
 *   A missing instagram_content_publish permission is reported as a problem.
 * X: OAuth 1.0a user tokens do not expire. Only missing keys are reported.
 */
import { FetchLike, fetchWithTimeout, readBody } from "./platforms/platform-client";
import { GRAPH_VERSION } from "./platforms/meta.clients";
import { xEnabled } from "./platforms/linkedin-x.clients";
import { Platform } from "./social.types";

export const LINKEDIN_TOKEN_DAYS = 60;
/** Warn at these many days left, once each. */
export const WARN_AT_DAYS = [14, 7, 3, 1, 0];

export type HealthStatus = "ok" | "expiring" | "expired" | "invalid" | "missing" | "off" | "unknown";

export interface PlatformHealth {
  platform: Platform;
  status: HealthStatus;
  detail: string;
  expiresAt?: string;
  daysLeft?: number;
  /** Stage key used to send each warning only once. */
  alertKey?: string;
}

export type SecretCreatedAt = (secretName: string) => Promise<Date | null>;

/** Secret Manager metadata via the runtime identity. Returns null when not allowed or not found. */
export function secretManagerCreatedAt(fetchFn: FetchLike = fetch): SecretCreatedAt {
  return async (name: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GoogleAuth } = require("google-auth-library");
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const token = await auth.getAccessToken();
      const project = process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132";
      const res = await fetchWithTimeout(fetchFn, `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions/latest`, {
        headers: { Authorization: `Bearer ${token}` },
      }, 10_000);
      if (!res.ok) return null;
      const { json } = await readBody(res);
      const t = (json as { createTime?: string } | undefined)?.createTime;
      return t ? new Date(t) : null;
    } catch {
      return null;
    }
  };
}

/** The smallest warning threshold at or above daysLeft, e.g. 10 days left gives 14. */
export function warningStage(daysLeft: number): number | null {
  const eligible = WARN_AT_DAYS.filter((d) => daysLeft <= d);
  return eligible.length ? Math.min(...eligible) : null;
}

export async function checkLinkedIn(createdAt: SecretCreatedAt, now = new Date()): Promise<PlatformHealth> {
  if (!process.env.LINKEDIN_ACCESS_TOKEN || !process.env.LINKEDIN_AUTHOR_URN) {
    return { platform: "linkedin", status: "missing", detail: "LINKEDIN_ACCESS_TOKEN or LINKEDIN_AUTHOR_URN is not set", alertKey: "linkedin:missing" };
  }
  const issued = await createdAt("LINKEDIN_ACCESS_TOKEN");
  if (!issued) {
    return {
      platform: "linkedin",
      status: "unknown",
      detail: "The token's age could not be read. Grant the runtime service account roles/secretmanager.viewer on the LINKEDIN_ACCESS_TOKEN secret, or keep a 55-day reminder.",
      alertKey: "linkedin:unknown",
    };
  }
  const expires = new Date(issued.getTime() + LINKEDIN_TOKEN_DAYS * 86_400_000);
  const daysLeft = Math.floor((expires.getTime() - now.getTime()) / 86_400_000);
  const base = { platform: "linkedin" as const, expiresAt: expires.toISOString(), daysLeft };
  if (daysLeft < 0) return { ...base, status: "expired", detail: `The LinkedIn token expired on ${expires.toISOString().slice(0, 10)}.`, alertKey: `linkedin:expired:${expires.toISOString().slice(0, 10)}` };
  const st = warningStage(daysLeft);
  if (st !== null) return { ...base, status: "expiring", detail: `The LinkedIn token expires on ${expires.toISOString().slice(0, 10)}, in ${daysLeft} days.`, alertKey: `linkedin:expiring:${expires.toISOString().slice(0, 10)}:${st}` };
  return { ...base, status: "ok", detail: `The LinkedIn token is good until ${expires.toISOString().slice(0, 10)}.` };
}

interface DebugToken {
  data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; type?: string };
  error?: { message?: string };
}

export async function checkMeta(fetchFn: FetchLike = fetch, now = new Date()): Promise<PlatformHealth[]> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const fbConfigured = Boolean(process.env.META_PAGE_ID && token);
  const igConfigured = Boolean(process.env.META_IG_USER_ID && token);
  if (!token) {
    return [
      { platform: "facebook", status: "missing", detail: "META_PAGE_ACCESS_TOKEN is not set", alertKey: "facebook:missing" },
      { platform: "instagram", status: "missing", detail: "META_PAGE_ACCESS_TOKEN is not set", alertKey: "instagram:missing" },
    ];
  }
  let data: DebugToken["data"];
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const res = await fetchWithTimeout(fetchFn, url, { method: "GET" }, 10_000);
    const { json } = await readBody(res);
    data = (json as DebugToken | undefined)?.data;
    if (!res.ok || !data) {
      const msg = (json as DebugToken | undefined)?.error?.message ?? `HTTP ${res.status}`;
      const h = (p: Platform): PlatformHealth => ({ platform: p, status: "invalid", detail: `Meta rejected the token check: ${msg.slice(0, 160)}`, alertKey: `${p}:invalid` });
      return [h("facebook"), h("instagram")];
    }
  } catch {
    const h = (p: Platform): PlatformHealth => ({ platform: p, status: "unknown", detail: "Meta could not be reached for the token check" });
    return [h("facebook"), h("instagram")];
  }

  const scopes = new Set(data.scopes ?? []);
  const exp = data.expires_at ?? 0;
  const results: PlatformHealth[] = [];
  const expiry = (p: Platform): PlatformHealth | null => {
    if (!data!.is_valid) return { platform: p, status: "invalid", detail: "The Meta Page token is no longer valid. Generate a new long-lived Page token.", alertKey: `${p}:invalid` };
    if (exp > 0) {
      const daysLeft = Math.floor((exp * 1000 - now.getTime()) / 86_400_000);
      const date = new Date(exp * 1000).toISOString().slice(0, 10);
      if (daysLeft < 0) return { platform: p, status: "expired", detail: `The Meta token expired on ${date}.`, expiresAt: date, daysLeft, alertKey: `${p}:expired:${date}` };
      const st = warningStage(daysLeft);
      if (st !== null) return { platform: p, status: "expiring", detail: `The Meta token expires on ${date}.`, expiresAt: date, daysLeft, alertKey: `${p}:expiring:${date}:${st}` };
    }
    return null;
  };

  if (!fbConfigured) results.push({ platform: "facebook", status: "missing", detail: "META_PAGE_ID is not set", alertKey: "facebook:missing" });
  else if (!scopes.has("pages_manage_posts")) results.push({ platform: "facebook", status: "invalid", detail: "The Meta token lacks pages_manage_posts", alertKey: "facebook:scope" });
  else results.push(expiry("facebook") ?? { platform: "facebook", status: "ok", detail: exp === 0 ? "The Page token does not expire." : "The Page token is valid." });

  const igMissing = ["instagram_basic", "instagram_content_publish"].filter((s) => !scopes.has(s));
  if (!igConfigured) results.push({ platform: "instagram", status: "missing", detail: "META_IG_USER_ID is not set", alertKey: "instagram:missing" });
  else if (igMissing.length) results.push({ platform: "instagram", status: "invalid", detail: `The Meta token lacks ${igMissing.join(" and ")}, so Instagram posts will fail`, alertKey: `instagram:scope:${igMissing.join(",")}` });
  else results.push(expiry("instagram") ?? { platform: "instagram", status: "ok", detail: "The token can publish to Instagram." });
  return results;
}

export function checkX(): PlatformHealth {
  if (!xEnabled()) return { platform: "x", status: "off", detail: "X is switched off (SOCIAL_X_ENABLED is not true)." };
  const missing = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) return { platform: "x", status: "missing", detail: `X is switched on but ${missing.join(", ")} not set`, alertKey: "x:missing" };
  return { platform: "x", status: "ok", detail: "X keys are set. OAuth 1.0a user tokens do not expire." };
}

/** Statuses the owner should hear about. "missing" counts only when the owner meant to switch it on. */
export function needsAlert(h: PlatformHealth): boolean {
  return h.status === "expiring" || h.status === "expired" || h.status === "invalid" || (h.status === "missing" && h.platform === "x");
}
