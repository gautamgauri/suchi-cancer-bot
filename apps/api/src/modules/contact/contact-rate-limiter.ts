/**
 * In-memory sliding-window limits for the public contact form. Per Cloud Run
 * instance, so with N instances the effective ceiling is N times these.
 *
 * - per client IP: every attempt counts, so a bot hammering the endpoint is
 *   stopped whatever it sends.
 * - global: counts only messages actually handed to SMTP. It protects the
 *   shared SMTP account's daily quota, which the approval emails also use.
 */
export const CONTACT_RATE_LIMITS = {
  perIp: { limit: 5, windowMs: 15 * 60 * 1000 },
  globalSends: { limit: 30, windowMs: 60 * 60 * 1000 },
} as const;

/** Bound on how many distinct IPs are tracked at once (memory cap). */
const MAX_TRACKED_KEYS = 10_000;

/** Provided by a factory in ContactModule (so `now` is not a DI token). */
export class ContactRateLimiter {
  private readonly perIp = new Map<string, number[]>();
  private globalSends: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Records an attempt for this IP; false when the IP is over its limit. */
  tryAttempt(ip: string): boolean {
    const { limit, windowMs } = CONTACT_RATE_LIMITS.perIp;
    const t = this.now();
    const recent = (this.perIp.get(ip) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= limit) {
      this.perIp.set(ip, recent);
      return false;
    }
    recent.push(t);
    this.perIp.delete(ip); // re-insert so Map order tracks recency
    this.perIp.set(ip, recent);
    if (this.perIp.size > MAX_TRACKED_KEYS) {
      const oldest = this.perIp.keys().next().value;
      if (oldest !== undefined) this.perIp.delete(oldest);
    }
    return true;
  }

  /** Reserves one slot of the global send budget; false when it is used up. */
  tryReserveSend(): boolean {
    const { limit, windowMs } = CONTACT_RATE_LIMITS.globalSends;
    const t = this.now();
    this.globalSends = this.globalSends.filter((at) => t - at < windowMs);
    if (this.globalSends.length >= limit) return false;
    this.globalSends.push(t);
    return true;
  }
}
