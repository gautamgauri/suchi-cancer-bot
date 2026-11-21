import { ExecutionContext, Injectable, Logger, SetMetadata } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerLimitDetail } from "@nestjs/throttler";
import { BlockList, isIP } from "node:net";
import { isUrgentSafetyText } from "../../modules/chat/deterministic-safety";

/**
 * Number of reverse-proxy hops in front of the container that we trust to
 * append to X-Forwarded-For. On Cloud Run (browser -> *.run.app) that is the
 * Google Front End only: it appends the address it saw the connection from, so
 * the RIGHTMOST X-Forwarded-For entry is the real client and anything to its
 * left is client-supplied (spoofable). Put an external HTTPS load balancer in
 * front of the service and this becomes 2.
 *
 * main.ts applies the same value to Express (`trust proxy`), so `req.ip` and
 * the throttler tracker below agree.
 *
 * UNVERIFIED ASSUMPTION: that Cloud Run appends exactly one entry. If Google
 * appends its own address after the client's, every user shares one bucket.
 * The safety routes fail open in that case (see isUntrustedClientAddress), and
 * the debug line in ClientIpThrottlerGuard.getTracker lets the assumption be
 * checked on a tagged revision before promotion (PR #202).
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * Where the client address came from: how many X-Forwarded-For entries the
 * request carried and which one (0-based, from the left) was used. `position`
 * is -1 when there was no header and the socket address was used.
 */
export interface ClientAddressResolution {
  ip: string;
  entries: number;
  position: number;
}

/**
 * Resolve the client address for rate limiting.
 *
 * This is NOT the leftmost X-Forwarded-For entry: that value is whatever
 * the caller sent, so a client could rotate it per request and never be
 * throttled. We walk TRUSTED_PROXY_HOPS entries in from the right instead,
 * which is exactly what Express computes for `req.ip` under `trust proxy = N`.
 * Falls back to `req.ip` / the socket address when there is no header (local
 * dev, tests, health probes that reach the container directly).
 */
export function resolveClientAddress(req: any, hops: number = TRUSTED_PROXY_HOPS): ClientAddressResolution {
  const raw = req?.headers?.["x-forwarded-for"];
  const header = Array.isArray(raw) ? raw.join(",") : raw;
  if (typeof header === "string" && header.trim() !== "") {
    const entries = header.split(",").map((s) => s.trim()).filter(Boolean);
    if (entries.length > 0) {
      const position = Math.max(0, entries.length - hops);
      return { ip: entries[position], entries: entries.length, position };
    }
  }
  return { ip: req?.ip ?? req?.socket?.remoteAddress ?? "unknown", entries: 0, position: -1 };
}

export function resolveClientIp(req: any, hops: number = TRUSTED_PROXY_HOPS): string {
  return resolveClientAddress(req, hops).ip;
}

/**
 * Addresses that cannot be a patient's own public address as Cloud Run sees
 * it: private, loopback, link-local and shared (CGNAT) ranges, and the
 * Google front-end and health-check source ranges (35.191.0.0/16,
 * 130.211.0.0/22). Seeing one of these means the address resolution is wrong
 * for this request, and bucketing by it could put every user in one bucket.
 */
const UNTRUSTED_RANGES = (() => {
  const list = new BlockList();
  for (const [net, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
    ["35.191.0.0", 16],
    ["130.211.0.0", 22],
  ] as const) {
    list.addSubnet(net, prefix, "ipv4");
  }
  list.addAddress("::", "ipv6");
  list.addAddress("::1", "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  return list;
})();

export type ClientAddressClass = "public" | "empty" | "invalid" | "private-or-google";

export function classifyClientAddress(ip: string | undefined): ClientAddressClass {
  if (!ip || ip === "unknown") return "empty";
  const v4 = ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  const family = isIP(v4);
  if (family === 0) return "invalid";
  return UNTRUSTED_RANGES.check(v4, family === 4 ? "ipv4" : "ipv6") ? "private-or-google" : "public";
}

/** True when the resolved address should not be used as a rate-limit bucket. */
export function isUntrustedClientAddress(ip: string | undefined): boolean {
  return classifyClientAddress(ip) !== "public";
}

/**
 * Marks a route a patient may need in an emergency (chat, session creation,
 * voice). On these the limiter fails open when the client address cannot be
 * trusted, and lets through a chat message that trips a deterministic
 * emergency, self-harm or crisis check, up to SAFETY_BYPASS_LIMIT such
 * messages per address a minute.
 */
export const SAFETY_ROUTE_KEY = "suchi:safety-route";
export const SafetyRoute = () => SetMetadata(SAFETY_ROUTE_KEY, true);

/** At most one resolution log line per instance in this window. */
export const RESOLUTION_LOG_INTERVAL_MS = 5 * 60_000;

/** Window for the safety-message cap. */
export const SAFETY_BYPASS_TTL_MS = 60_000;
/** Safety messages per address per window that may pass a route's spent limit. */
export const SAFETY_BYPASS_LIMIT = 300;

/**
 * Global rate-limit guard (bound as APP_GUARD in app.module.ts).
 *
 * - Tracks by real client IP (see resolveClientIp), so users behind Google's
 *   front end do not all share the load balancer's bucket.
 * - Only applies to HTTP. The voice WebSocket gateway would otherwise hit
 *   ThrottlerGuard's HTTP-only request/response handling.
 * - On a @SafetyRoute it fails open on an untrusted address, and lets an
 *   emergency, self-harm or crisis message through a spent limit (see below).
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  /** SAFETY_BYPASS_LIMIT. Static so a spec can lower it. */
  static safetyBypassLimit = SAFETY_BYPASS_LIMIT;
  private static readonly logger = new Logger("ClientIpThrottlerGuard");
  private static lastResolutionLogAt = 0;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const resolved = resolveClientAddress(req);
    ClientIpThrottlerGuard.logResolution(resolved);
    return resolved.ip;
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    if (await super.shouldSkip(context)) return true;
    if (!this.isSafetyRoute(context)) return false;
    // Fail open: a bucket keyed on a private or Google address would be
    // shared by every user, and a patient must not be refused for that.
    return isUntrustedClientAddress(resolveClientAddress(context.switchToHttp().getRequest()).ip);
  }

  /**
   * Called only when the route's limit is spent and the request would be
   * refused. A message that would get the emergency, self-harm or crisis
   * template is let through instead, up to SAFETY_BYPASS_LIMIT such messages
   * per address a minute. These turns use no retrieval or LLM.
   *
   * The safety screen runs here only for a request that would otherwise be
   * refused, so a request within its limit pays for one screen, in the
   * pipeline, as on main (review N2). Past the safety cap the 429 stands, with
   * its Retry-After header.
   */
  protected async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    if (await this.letSafetyMessageThrough(context)) {
      // The request goes ahead, so it must not carry the refusal's header.
      context.switchToHttp().getResponse()?.removeHeader?.("Retry-After");
      return;
    }
    return super.throwThrottlingException(context, detail);
  }

  private isSafetyRoute(context: ExecutionContext): boolean {
    return !!this.reflector.getAllAndOverride<boolean>(SAFETY_ROUTE_KEY, [context.getHandler(), context.getClass()]);
  }

  private async letSafetyMessageThrough(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http" || !this.isSafetyRoute(context)) return false;
    const req = context.switchToHttp().getRequest();
    const body = req?.body;
    if (!isUrgentSafetyText(body?.userText, body?.channel, body?.inputMode)) return false;
    // Blocked for the rest of the window once the cap is passed.
    const { isBlocked } = await this.storageService.increment(
      `safety-bypass:${resolveClientAddress(req).ip}`,
      SAFETY_BYPASS_TTL_MS,
      ClientIpThrottlerGuard.safetyBypassLimit,
      SAFETY_BYPASS_TTL_MS,
      "safety-bypass",
    );
    return !isBlocked;
  }

  /**
   * Debug line for checking the X-Forwarded-For assumption on a tagged,
   * no-traffic revision. At most one per instance per RESOLUTION_LOG_INTERVAL_MS.
   * It records how many entries the header had, which position was used and
   * the class of the address. It never records an address.
   */
  static logResolution(resolved: ClientAddressResolution, now: number = Date.now()): boolean {
    if (now - ClientIpThrottlerGuard.lastResolutionLogAt < RESOLUTION_LOG_INTERVAL_MS) return false;
    ClientIpThrottlerGuard.lastResolutionLogAt = now;
    const where =
      resolved.position < 0
        ? "no x-forwarded-for header, socket address used"
        : `x-forwarded-for entries=${resolved.entries}, used position=${resolved.position} (0-based from the left, trusted hops=${TRUSTED_PROXY_HOPS})`;
    ClientIpThrottlerGuard.logger.debug(
      `[throttle-ip] ${where}, address class=${classifyClientAddress(resolved.ip)}`,
    );
    return true;
  }

  /** Test hook: allow the next resolution to be logged. */
  static resetResolutionLog(): void {
    ClientIpThrottlerGuard.lastResolutionLogAt = 0;
  }
}
