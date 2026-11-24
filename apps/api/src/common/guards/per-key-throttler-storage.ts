import { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";

interface Entry {
  /** Time of each counted hit in the current window, oldest first. */
  hits: number[];
  /** When a block ends, or 0 when the key is not blocked. */
  blockExpiresAt: number;
}

/**
 * In-memory rate-limit storage whose expiry is tracked per key (PR #202,
 * review N6).
 *
 * The default storage in @nestjs/throttler 6.5.0 keeps one list of expiry
 * timers per throttler name. When any blocked key returns after its block,
 * it clears every pending timer of that name, so hits by OTHER addresses
 * never expire. Ordinary users at a busy shared address then got 60 second
 * 429s with no cause of their own. No patch release fixes it: the next
 * releases are minor versions.
 *
 * Here each key keeps its own hit times and is pruned lazily on access, so
 * no key can affect another. The window slides, as in the library: a hit
 * stops counting `ttl` after it was made. Semantics otherwise follow the
 * library: a blocked key adds no hits while blocked, and starts afresh when
 * the block ends. Memory is bounded: a key keeps at most `limit + 1` hit
 * times, idle keys are swept every SWEEP_EVERY calls, and past MAX_KEYS the
 * least recently used keys are dropped.
 */
export class PerKeyThrottlerStorage implements ThrottlerStorage {
  static readonly MAX_KEYS = 100_000;
  static readonly SWEEP_EVERY = 1_000;

  private readonly entries = new Map<string, Entry>();
  /** Longest ttl or block seen, so a sweep never drops a key still in use. */
  private longestWindowMs = 0;
  private calls = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Number of keys held. For tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const now = this.now();
    this.longestWindowMs = Math.max(this.longestWindowMs, ttl, blockDuration);
    if (++this.calls % PerKeyThrottlerStorage.SWEEP_EVERY === 0) this.sweep(now);

    const id = `${throttlerName}\u0000${key}`;
    let entry = this.entries.get(id);
    if (entry) {
      // Move it to the newest end, so eviction drops the least recently used key.
      this.entries.delete(id);
      this.entries.set(id, entry);
    } else {
      entry = { hits: [], blockExpiresAt: 0 };
      this.entries.set(id, entry);
      this.enforceMaxKeys();
    }

    // A block that has ended starts the key afresh.
    if (entry.blockExpiresAt !== 0 && entry.blockExpiresAt <= now) {
      entry.hits = [];
      entry.blockExpiresAt = 0;
    }
    // Drop this key's hits that have left the window.
    while (entry.hits.length > 0 && entry.hits[0] + ttl <= now) entry.hits.shift();

    if (entry.blockExpiresAt === 0) {
      entry.hits.push(now);
      if (entry.hits.length > limit + 1) entry.hits.shift();
      if (entry.hits.length > limit) entry.blockExpiresAt = now + blockDuration;
    }

    const isBlocked = entry.blockExpiresAt > now;
    const oldest = entry.hits.length > 0 ? entry.hits[0] : now;
    return {
      totalHits: entry.hits.length,
      timeToExpire: Math.max(0, Math.ceil((oldest + ttl - now) / 1000)),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil((entry.blockExpiresAt - now) / 1000) : 0,
    };
  }

  /** Remove keys with no hit in the window and no live block. */
  private sweep(now: number): void {
    for (const [id, entry] of this.entries) {
      const lastHit = entry.hits.length > 0 ? entry.hits[entry.hits.length - 1] : 0;
      if (entry.blockExpiresAt <= now && lastHit + this.longestWindowMs <= now) this.entries.delete(id);
    }
  }

  /** Past MAX_KEYS, drop the least recently used keys (the Map is kept in use order). */
  private enforceMaxKeys(): void {
    while (this.entries.size > PerKeyThrottlerStorage.MAX_KEYS) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
