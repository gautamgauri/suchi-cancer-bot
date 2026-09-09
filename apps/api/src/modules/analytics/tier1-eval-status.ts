/**
 * #63 `tier1_eval_status` — the latest GitHub Actions "Eval Tier1 - Retrieval
 * Quality" run conclusion.
 *
 * The Ops Center rendered this as *unavailable* because nothing collected it.
 * `scripts/ops-metrics.ts` had a hand-run stopgap that shelled out to `gh run
 * list`, which is why the capability ledger rated it 🟡 Partial: a shell-out
 * cannot be unit-tested and is not reachable from the API. This module is the
 * collector both paths now share, so they cannot drift.
 *
 * No new environment variable. `gautamgauri/suchi-cancer-bot` is a public repo,
 * so the unauthenticated Actions REST API answers this query (verified: HTTP
 * 200, `total_count: 268`). Unauthenticated GitHub allows 60 requests/hour per
 * IP; the caller is expected to cache (OpsMetricsService does). If the budget is
 * ever exhausted the collector reports *unavailable* with the HTTP status in
 * `source` — it fails loud, and never degrades into a fake "success".
 *
 * Ops Center rule 2: a metric with no measurement reads "unavailable", never 0
 * and never a green. Every failure path here sets `available: false`.
 *
 * READ-ONLY: one GET, no writes, no credentials.
 */

/** The repo that owns the workflow. Mirrors `GH_REPO` in scripts/ops-metrics.ts. */
export const TIER1_GH_REPO = "gautamgauri/suchi-cancer-bot";
/** Workflow *file name*, which is a valid `workflow_id` for the runs endpoint. */
export const TIER1_EVAL_WORKFLOW = "eval-tier1.yml";

const GITHUB_API_ROOT = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Shaped to match the manual stopgap entry in `~/bodh-ai-ops/manual/suchi.json`
 * (`value` / `as_of` / `source`) so the scorecard reads the collector and the
 * stopgap identically — snake_case `as_of` is deliberate for that reason, even
 * though the rest of OpsMetrics is camelCase.
 */
export interface Tier1EvalStatus {
  /**
   * The run's `conclusion` ("success" | "failure" | "cancelled" | ...). An
   * in-flight run has no conclusion yet, so its `status` ("in_progress",
   * "queued") is reported instead — never guessed at. Null when unavailable.
   */
  value: string | null;
  /** ISO-8601 timestamp of the run this reflects. Null when unavailable. */
  as_of: string | null;
  /** Provenance, always present. Carries the reason when `available` is false. */
  source: string;
  /** False = the Ops Center must render "unavailable" rather than any value. */
  available: boolean;
  /** Link to the run, for a human following up on a red. Null when unavailable. */
  runUrl: string | null;
}

/** The subset of the Actions run payload this collector reads. */
interface WorkflowRunPayload {
  conclusion?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  run_number?: number | null;
  display_title?: string | null;
  html_url?: string | null;
}

export interface FetchTier1EvalStatusOptions {
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  repo?: string;
  workflow?: string;
  timeoutMs?: number;
}

function unavailable(reason: string): Tier1EvalStatus {
  return { value: null, as_of: null, source: `unavailable: ${reason}`, available: false, runUrl: null };
}

/** Errors from fetch/JSON lead with varied shapes; surface one useful line. */
function firstLine(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  return msg.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "unknown error";
}

export function tier1EvalRunsUrl(repo = TIER1_GH_REPO, workflow = TIER1_EVAL_WORKFLOW): string {
  return `${GITHUB_API_ROOT}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`;
}

/**
 * Reads the latest run of the Tier-1 eval workflow. Never throws and never
 * rejects: every failure resolves to an `available: false` reading, so a
 * GitHub outage degrades one tile instead of the whole ops-metrics response.
 */
export async function fetchTier1EvalStatus(
  options: FetchTier1EvalStatusOptions = {},
): Promise<Tier1EvalStatus> {
  const {
    fetchImpl = globalThis.fetch,
    repo = TIER1_GH_REPO,
    workflow = TIER1_EVAL_WORKFLOW,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  if (typeof fetchImpl !== "function") {
    return unavailable("no fetch implementation available in this runtime");
  }

  try {
    const response = await fetchImpl(tier1EvalRunsUrl(repo, workflow), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // GitHub rejects unauthenticated API calls without a User-Agent.
        "User-Agent": "suchi-ops-metrics",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // 403/429 is almost always the 60/hour unauthenticated budget. Say so
      // rather than letting a rate limit read as an eval problem.
      const hint =
        response.status === 403 || response.status === 429
          ? " (unauthenticated GitHub rate limit, most likely)"
          : "";
      return unavailable(`GitHub API returned ${response.status}${hint}`);
    }

    const body = (await response.json()) as { workflow_runs?: WorkflowRunPayload[] } | null;
    const run = body?.workflow_runs?.[0];
    if (!run) {
      return unavailable(`no runs recorded for ${workflow} in ${repo}`);
    }

    const value = run.conclusion || run.status || null;
    if (!value) {
      return unavailable(`latest ${workflow} run reports neither a conclusion nor a status`);
    }

    const asOf = run.updated_at || run.created_at || null;
    const runUrl = run.html_url || null;
    const parts = [
      `GitHub Actions ${workflow} latest run`,
      run.run_number ? `#${run.run_number}` : null,
      run.display_title || null,
      asOf,
      runUrl,
    ].filter(Boolean);

    return { value, as_of: asOf, source: parts.join(" — "), available: true, runUrl };
  } catch (e) {
    return unavailable(`could not reach the GitHub Actions API: ${firstLine(e)}`);
  }
}
