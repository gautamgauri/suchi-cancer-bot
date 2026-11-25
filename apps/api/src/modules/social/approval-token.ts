/**
 * Approval links for social posts. Signed, expiring, bound to the exact
 * content shown, and single use.
 *
 * The token carries the post id, a hash of the offered text and images, an
 * expiry time and a random nonce, signed with HMAC-SHA256. It never changes
 * anything by itself. Opening the link (GET) shows a review page. Only the
 * POST from that page's button can approve, and the post record marks the
 * approval used in the same compare-and-swap write, so a second POST, a
 * resent email or a mail scanner opening the link cannot publish anything.
 *
 * There is no fallback secret. Without SOCIAL_APPROVAL_SECRET (or the
 * existing CONTENT_APPROVAL_SECRET) no approval email is sent and posts are
 * held for the owner.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Platform, PLATFORMS, SocialPost } from "./social.types";

export const APPROVAL_TTL_HOURS = 72;
const DOMAIN = "suchi-social-approval:v1";

export class ApprovalSecretMissingError extends Error {
  constructor() {
    super("No SOCIAL_APPROVAL_SECRET or CONTENT_APPROVAL_SECRET is set, so approval links cannot be signed");
  }
}

// Not a discriminated union: the API compiles with strict off, where TypeScript
// does not narrow on a boolean discriminant.
export interface TokenCheck {
  ok: boolean;
  expiresAt?: Date;
  reason?: "malformed" | "bad_signature" | "expired" | "wrong_post" | "content_changed" | "no_secret";
}

function secret(): string {
  const s = process.env.SOCIAL_APPROVAL_SECRET || process.env.CONTENT_APPROVAL_SECRET;
  if (!s || s.length < 16) throw new ApprovalSecretMissingError();
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

/** Hash of exactly what the owner is shown, per offered platform. */
export function contentHashOf(post: Pick<SocialPost, "id" | "platforms">): string {
  const h = createHash("sha256");
  h.update(post.id);
  for (const p of PLATFORMS) {
    const r = post.platforms[p];
    if (!r || r.state !== "offered") continue;
    h.update(`\n--${p}--\n${r.text}\n${r.cardText ?? ""}\n${r.imageUrl ?? ""}`);
  }
  return h.digest("hex");
}

export function signApprovalToken(postId: string, contentHash: string, now = new Date(), ttlHours = APPROVAL_TTL_HOURS): { token: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + ttlHours * 3600_000);
  const payload = b64url(JSON.stringify({ p: postId, h: contentHash, e: Math.floor(expiresAt.getTime() / 1000), n: randomBytes(12).toString("hex") }));
  const sig = createHmac("sha256", secret()).update(`${DOMAIN}.${payload}`).digest();
  return { token: `${payload}.${b64url(sig)}`, expiresAt };
}

export function verifyApprovalToken(token: string | undefined, post: Pick<SocialPost, "id" | "contentHash">, now = new Date()): TokenCheck {
  let key: string;
  try {
    key = secret();
  } catch {
    return { ok: false, reason: "no_secret" };
  }
  if (typeof token !== "string" || token.length > 1024) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [payload, sig] = parts;
  const expected = createHmac("sha256", key).update(`${DOMAIN}.${payload}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  let body: { p?: unknown; h?: unknown; e?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof body.p !== "string" || typeof body.h !== "string" || typeof body.e !== "number") return { ok: false, reason: "malformed" };
  if (body.p !== post.id) return { ok: false, reason: "wrong_post" };
  if (body.e * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  if (body.h !== post.contentHash) return { ok: false, reason: "content_changed" };
  return { ok: true, expiresAt: new Date(body.e * 1000) };
}

export function parsePlatformSelection(raw: unknown): Platform[] {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const out: Platform[] = [];
  for (const v of values) {
    const p = String(v).trim().toLowerCase();
    if ((PLATFORMS as readonly string[]).includes(p) && !out.includes(p as Platform)) out.push(p as Platform);
  }
  return out;
}
