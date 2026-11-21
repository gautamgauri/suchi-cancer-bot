import { PerKeyThrottlerStorage } from "./per-key-throttler-storage";

/**
 * Review N6 of PR #202. In @nestjs/throttler 6.5.0's default storage a
 * blocked key that returns after its block clears every pending expiry timer
 * of the throttler name, so other keys' hits never expire. Each key here
 * keeps its own hit times.
 */
describe("PerKeyThrottlerStorage", () => {
  const TTL = 60_000;
  let now: number;
  let store: PerKeyThrottlerStorage;
  const hit = (key: string, limit = 2, block = TTL) => store.increment(key, TTL, limit, block, "default");

  beforeEach(() => {
    now = 1_000_000;
    store = new PerKeyThrottlerStorage(() => now);
  });

  it("blocks a key past its limit and reports the time left", async () => {
    expect((await hit("a")).isBlocked).toBe(false);
    expect((await hit("a")).isBlocked).toBe(false);
    const third = await hit("a");
    expect(third.isBlocked).toBe(true);
    expect(third.timeToBlockExpire).toBe(60);
  });

  it("one key blocked and returning does not stop another key's hits from expiring", async () => {
    // B is near its limit.
    await hit("b");
    await hit("b");
    now += 10_000;
    // A is blocked.
    await hit("a");
    await hit("a");
    expect((await hit("a")).isBlocked).toBe(true);
    // A's block ends and A returns. In the library this cleared B's timers.
    now += TTL + 1;
    expect((await hit("a")).isBlocked).toBe(false);
    // B's two hits were made more than a window ago, so they have expired.
    const b = await hit("b");
    expect(b.isBlocked).toBe(false);
    expect(b.totalHits).toBe(1);
  });

  it("a hit stops counting one window after it was made (sliding window)", async () => {
    await hit("a");
    now += 30_000;
    await hit("a");
    now += 30_001; // the first hit has left the window, the second has not
    const r = await hit("a");
    expect(r.isBlocked).toBe(false);
    expect(r.totalHits).toBe(2);
  });

  it("a blocked key adds no hits while blocked and starts afresh after", async () => {
    await hit("a");
    await hit("a");
    await hit("a");
    now += 1_000;
    const still = await hit("a");
    expect(still.isBlocked).toBe(true);
    expect(still.totalHits).toBe(3);
    now += TTL;
    const fresh = await hit("a");
    expect(fresh).toMatchObject({ isBlocked: false, totalHits: 1 });
  });

  it("keeps names apart", async () => {
    await store.increment("k", TTL, 1, TTL, "default");
    expect((await store.increment("k", TTL, 1, TTL, "safety-bypass")).isBlocked).toBe(false);
  });

  it("bounds memory: idle keys are swept and the key count is capped", async () => {
    for (let i = 0; i < PerKeyThrottlerStorage.SWEEP_EVERY - 1; i++) await hit(`k${i}`, 100);
    expect(store.size).toBe(PerKeyThrottlerStorage.SWEEP_EVERY - 1);
    now += TTL + 1;
    await hit("late", 100); // this call triggers the sweep
    expect(store.size).toBe(1);
    // A key never holds more than limit + 1 hit times.
    for (let i = 0; i < 50; i++) {
      now += TTL + 1; // each block has ended, so every call is counted afresh
      await hit("busy", 2);
    }
    expect((await hit("busy", 2)).totalHits).toBeLessThanOrEqual(3);
  });
});
