/**
 * Unit tests for the #63 `tier1_eval_status` collector.
 *
 * Contract:
 *  - reads the latest NIGHTLY run of `eval-tier1.yml` on `main` from the GitHub
 *    Actions REST API — the workflow also runs on pull requests, and a PR run
 *    is not the production retrieval-quality canary
 *  - reports the run's `conclusion`, or its `status` when a run is still in
 *    flight — it never guesses a conclusion
 *  - EVERY failure path resolves to `available: false` with the reason in
 *    `source`, never to a value: the Ops Center rule is "unavailable", never a
 *    zero and never a green
 *  - it never throws, so a GitHub outage cannot take down /v1/admin/ops-metrics
 *  - it sends no credentials
 *
 * `fetch` is injected — no live network.
 */

import {
  fetchTier1EvalStatus,
  tier1EvalRunsUrl,
  TIER1_CANARY_BRANCH,
  TIER1_CANARY_EVENT,
  TIER1_EVAL_WORKFLOW,
  TIER1_GH_REPO,
} from "./tier1-eval-status";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const RUN = {
  conclusion: "success",
  status: "completed",
  created_at: "2026-09-08T02:00:11Z",
  updated_at: "2026-09-08T02:14:52Z",
  run_number: 268,
  display_title: "Eval Tier1 - Retrieval Quality",
  html_url: "https://github.com/gautamgauri/suchi-cancer-bot/actions/runs/34323136646",
};

function fetchReturning(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue(response(body, status)) as unknown as typeof fetch;
}

describe("fetchTier1EvalStatus", () => {
  it("reports the latest run's conclusion in the manual-stopgap shape", async () => {
    const status = await fetchTier1EvalStatus({ fetchImpl: fetchReturning({ workflow_runs: [RUN] }) });

    expect(status.available).toBe(true);
    expect(status.value).toBe("success");
    // as_of is the run's own timestamp, not "now" — the figure dates itself.
    expect(status.as_of).toBe("2026-09-08T02:14:52Z");
    expect(status.runUrl).toBe(RUN.html_url);
    expect(status.source).toContain(TIER1_EVAL_WORKFLOW);
    expect(status.source).toContain("#268");
    expect(status.source).toContain(RUN.html_url);
    // The scorecard reads value/as_of/source; all three must be populated.
    expect(Object.keys(status).sort()).toEqual(["as_of", "available", "runUrl", "source", "value"]);
  });

  it("reports a red run as red rather than smoothing it", async () => {
    const status = await fetchTier1EvalStatus({
      fetchImpl: fetchReturning({ workflow_runs: [{ ...RUN, conclusion: "failure" }] }),
    });

    expect(status.available).toBe(true);
    expect(status.value).toBe("failure");
  });

  it("asks the documented endpoint for exactly one run", async () => {
    const fetchImpl = fetchReturning({ workflow_runs: [RUN] });
    await fetchTier1EvalStatus({ fetchImpl });

    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(
      `https://api.github.com/repos/${TIER1_GH_REPO}/actions/workflows/${TIER1_EVAL_WORKFLOW}/runs` +
        `?branch=${TIER1_CANARY_BRANCH}&event=${TIER1_CANARY_EVENT}&per_page=1`,
    );
    expect(url).toBe(tier1EvalRunsUrl());
    expect(init.method).toBe("GET");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
    // GitHub 403s an unauthenticated call with no User-Agent.
    expect(init.headers["User-Agent"]).toBeTruthy();
  });

  it("filters the query to the nightly canary, not the newest run of any kind", async () => {
    const fetchImpl = fetchReturning({ workflow_runs: [RUN] });
    await fetchTier1EvalStatus({ fetchImpl });

    const [url] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    // eval-tier1.yml also runs on pull_request; without both filters the
    // endpoint answers with whichever run finished last.
    expect(url).toContain(`event=${TIER1_CANARY_EVENT}`);
    expect(url).toContain(`branch=${TIER1_CANARY_BRANCH}`);
    expect(TIER1_CANARY_EVENT).toBe("schedule");
    expect(TIER1_CANARY_BRANCH).toBe("main");
  });

  it("does not report a newer pull_request run as the canary", async () => {
    // A PR run that is NEWER and RED, alongside the older green nightly. This
    // fake filters like the real endpoint does, so it answers the unfiltered
    // query with the PR run and the filtered query with the nightly.
    const prRun = {
      ...RUN,
      conclusion: "failure",
      status: "completed",
      created_at: "2026-09-08T11:03:00Z",
      updated_at: "2026-09-08T11:31:07Z",
      run_number: 269,
      event: "pull_request",
      head_branch: "feat/some-rag-change",
      html_url: "https://github.com/gautamgauri/suchi-cancer-bot/actions/runs/34399999999",
    };
    const nightly = { ...RUN, event: "schedule", head_branch: "main" };
    const all = [prRun, nightly]; // newest first, as GitHub returns them

    const fetchImpl = jest.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      const matching = all.filter(
        (r) =>
          (!query.get("event") || r.event === query.get("event")) &&
          (!query.get("branch") || r.head_branch === query.get("branch")),
      );
      return response({ workflow_runs: matching.slice(0, Number(query.get("per_page") ?? 1)) });
    }) as unknown as typeof fetch;

    const status = await fetchTier1EvalStatus({ fetchImpl });

    expect(status.available).toBe(true);
    // The PR's red must not be published as the production retrieval signal...
    expect(status.value).toBe("success");
    // ...and the reading must date itself by the nightly, not by the PR run.
    expect(status.as_of).toBe(RUN.updated_at);
    expect(status.runUrl).toBe(RUN.html_url);
    expect(status.source).toContain("#268");
  });

  it("is unavailable when only non-canary runs exist", async () => {
    // What the filtered endpoint returns once GitHub disables a dormant
    // schedule: an empty list. Rule 2 — unavailable, never a stand-in value.
    const status = await fetchTier1EvalStatus({ fetchImpl: fetchReturning({ workflow_runs: [] }) });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
    expect(status.source).toContain(TIER1_CANARY_EVENT);
    expect(status.source).toContain(TIER1_CANARY_BRANCH);
  });

  it("sends no credentials — the repo is public and the collector needs none", async () => {
    const fetchImpl = fetchReturning({ workflow_runs: [RUN] });
    await fetchTier1EvalStatus({ fetchImpl });

    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    const headerNames = Object.keys(init.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain("authorization");
    expect(JSON.stringify(init)).not.toMatch(/token|bearer|secret/i);
  });

  it("reports an in-flight run's status instead of guessing a conclusion", async () => {
    const status = await fetchTier1EvalStatus({
      fetchImpl: fetchReturning({
        workflow_runs: [{ ...RUN, conclusion: null, status: "in_progress" }],
      }),
    });

    expect(status.available).toBe(true);
    expect(status.value).toBe("in_progress");
    expect(status.value).not.toBe("success");
  });

  it("is unavailable — not green — when GitHub returns a non-2xx", async () => {
    const status = await fetchTier1EvalStatus({ fetchImpl: fetchReturning({}, 500) });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
    expect(status.as_of).toBeNull();
    expect(status.source).toContain("500");
  });

  it("names the rate limit on 403/429 so it is not read as an eval failure", async () => {
    for (const code of [403, 429]) {
      const status = await fetchTier1EvalStatus({ fetchImpl: fetchReturning({}, code) });
      expect(status.available).toBe(false);
      expect(status.source).toMatch(/rate limit/i);
      expect(status.value).toBeNull();
    }
  });

  it("is unavailable when the workflow has no runs", async () => {
    const status = await fetchTier1EvalStatus({ fetchImpl: fetchReturning({ workflow_runs: [] }) });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
    expect(status.source).toContain(TIER1_EVAL_WORKFLOW);
  });

  it("is unavailable when the payload is malformed", async () => {
    const status = await fetchTier1EvalStatus({ fetchImpl: fetchReturning(null) });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
  });

  it("is unavailable when the run reports neither conclusion nor status", async () => {
    const status = await fetchTier1EvalStatus({
      fetchImpl: fetchReturning({ workflow_runs: [{ ...RUN, conclusion: null, status: null }] }),
    });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
  });

  it("never throws when the network fails or times out", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      })) as unknown as typeof fetch;

    const status = await fetchTier1EvalStatus({ fetchImpl });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
    expect(status.source).toMatch(/could not reach the GitHub Actions API/);
    expect(status.source).toContain("timeout");
  });

  it("is unavailable rather than crashing when the runtime has no fetch", async () => {
    // `undefined` would fall through to the globalThis.fetch default (and hit the
    // network), so the no-fetch branch is forced with an explicit null.
    const status = await fetchTier1EvalStatus({ fetchImpl: null as unknown as typeof fetch });

    expect(status.available).toBe(false);
    expect(status.value).toBeNull();
    expect(status.source).toMatch(/no fetch implementation/);
  });

  it("aborts rather than hanging on a slow GitHub", async () => {
    const fetchImpl = fetchReturning({ workflow_runs: [RUN] });
    await fetchTier1EvalStatus({ fetchImpl, timeoutMs: 1234 });

    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
