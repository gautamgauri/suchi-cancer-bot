/**
 * Unit tests for the `tier1_eval_status` entry the ops-metrics script emits
 * (issue #63, PR #105 review).
 *
 * Contract:
 *  - an available reading dates itself by the RUN it reports, never by when the
 *    script was executed: the Ops Center flags entries older than
 *    `manual_stale_days`, so a collection-time stamp would make a workflow that
 *    stopped running look perpetually fresh
 *  - collection time is a fallback only, for a reading with no run timestamp
 *  - an unavailable reading emits NO entry (Ops Center rule 2: a missing key
 *    reads "unavailable", never a zero and never a stale green)
 *
 * Importing this script must not run it — `main()` is guarded by
 * `require.main === module`, so no Prisma client and no GitHub call here.
 */

import { buildTier1Entry } from "./ops-metrics";
import { Tier1EvalStatus } from "../modules/analytics/tier1-eval-status";

/** Collection date: today in the script's `isoDate` shape. */
const COLLECTED_ON = "2026-09-20";

const READING: Tier1EvalStatus = {
  value: "success",
  as_of: "2026-09-08T02:14:52Z",
  source: "GitHub Actions eval-tier1.yml latest schedule run on main — #268 — 2026-09-08T02:14:52Z",
  available: true,
  runUrl: "https://github.com/gautamgauri/suchi-cancer-bot/actions/runs/34323136646",
};

describe("buildTier1Entry", () => {
  it("dates the entry by the workflow run, not by the collection time", () => {
    const entry = buildTier1Entry(READING, COLLECTED_ON, "ops");

    expect(entry).not.toBeNull();
    expect(entry!.value).toBe("success");
    // The run is from the 8th. Re-collecting on the 20th must not re-date it.
    expect(entry!.as_of).toBe("2026-09-08");
    expect(entry!.as_of).not.toBe(COLLECTED_ON);
    expect(entry!.by).toBe("ops");
  });

  it("keeps an old run visibly old however often it is re-collected", () => {
    const first = buildTier1Entry(READING, "2026-09-09", "ops");
    const muchLater = buildTier1Entry(READING, "2026-12-25", "ops");

    // Same run, same date — that is what lets the staleness check fire.
    expect(muchLater!.as_of).toBe(first!.as_of);
    expect(muchLater!.as_of).toBe("2026-09-08");
  });

  it("keeps the full run timestamp in source, so no precision is lost", () => {
    const entry = buildTier1Entry(READING, COLLECTED_ON, "ops");

    expect(entry!.source).toBe(READING.source);
    expect(entry!.source).toContain("2026-09-08T02:14:52Z");
  });

  it("emits the same YYYY-MM-DD shape the other entries and _how_to use", () => {
    const entry = buildTier1Entry(READING, COLLECTED_ON, "ops");

    expect(entry!.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to the collection date when the run carries no timestamp", () => {
    const entry = buildTier1Entry({ ...READING, as_of: null }, COLLECTED_ON, "ops");

    expect(entry!.as_of).toBe(COLLECTED_ON);
  });

  it("falls back to the collection date when the run timestamp is unparseable", () => {
    const entry = buildTier1Entry({ ...READING, as_of: "not-a-date" }, COLLECTED_ON, "ops");

    expect(entry!.as_of).toBe(COLLECTED_ON);
  });

  it("emits no entry for an unavailable reading, rather than a zero or a green", () => {
    const unavailable: Tier1EvalStatus = {
      value: null,
      as_of: null,
      source: "unavailable: GitHub API returned 403 (unauthenticated GitHub rate limit, most likely)",
      available: false,
      runUrl: null,
    };

    expect(buildTier1Entry(unavailable, COLLECTED_ON, "ops")).toBeNull();
    // An available flag with no value is equally unreportable.
    expect(buildTier1Entry({ ...READING, value: null }, COLLECTED_ON, "ops")).toBeNull();
  });
});
