import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

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
 */
export const TRUSTED_PROXY_HOPS = 1;

/**
 * Resolve the client address for rate limiting.
 *
 * Deliberately NOT the leftmost X-Forwarded-For entry: that value is whatever
 * the caller sent, so a client could rotate it per request and never be
 * throttled. We walk TRUSTED_PROXY_HOPS entries in from the right instead,
 * which is exactly what Express computes for `req.ip` under `trust proxy = N`.
 * Falls back to `req.ip` / the socket address when there is no header (local
 * dev, tests, health probes that reach the container directly).
 */
export function resolveClientIp(req: any, hops: number = TRUSTED_PROXY_HOPS): string {
  const raw = req?.headers?.["x-forwarded-for"];
  const header = Array.isArray(raw) ? raw.join(",") : raw;
  if (typeof header === "string" && header.trim() !== "") {
    const entries = header.split(",").map((s) => s.trim()).filter(Boolean);
    if (entries.length > 0) {
      const idx = Math.max(0, entries.length - hops);
      return entries[idx];
    }
  }
  return req?.ip ?? req?.socket?.remoteAddress ?? "unknown";
}

/**
 * Global rate-limit guard (bound as APP_GUARD in app.module.ts).
 *
 * - Tracks by real client IP (see resolveClientIp), so users behind Google's
 *   front end do not all share the load balancer's bucket.
 * - Only applies to HTTP. The voice WebSocket gateway would otherwise hit
 *   ThrottlerGuard's HTTP-only request/response handling.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return resolveClientIp(req);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    return super.shouldSkip(context);
  }
}
