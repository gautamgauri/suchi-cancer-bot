---
allowed-tools: Bash, Read, Write, Edit, Agent
argument-hint: "[knob_name|profile_name|all] [api_url]"
---

# Autoresearch Retrieval Config Sweep

Run a full retrieval config experiment: create experiment → generate variants → benchmark all → report → recommend.

**Arguments:** $ARGUMENTS

Parse:
- **First arg**: knob name (e.g. `rrfK`, `tierBoostA`), profile name (e.g. `aggressive_tier_boost`), or `all` for all sweepable knobs. Default: `rrfK`.
- **Second arg**: API base URL. Default: `http://localhost:3001`.

---

## Step 0: Validate

1. Check the funding-api is reachable:
```bash
curl -sf <api_url>/v1/health || curl -sf <api_url>/live
```
If not reachable, tell the user to start the API first and stop.

2. Fetch metadata to confirm autoresearch module is registered:
```bash
curl -sf <api_url>/v1/autoresearch/meta
```
Print the sweepable knobs and available profiles. If the knob/profile the user requested isn't valid, stop and show valid options.

---

## Step 1: Create Experiment

```bash
curl -s -X POST <api_url>/v1/autoresearch/experiments \
  -H 'Content-Type: application/json' \
  -d '{"name":"<knob>-sweep-<date>","hypothesis":"Tuning <knob> to improve retrieval quality"}'
```

Save the experiment ID and baseline variant ID from the response.

---

## Step 2: Generate Variants

If the argument is a knob name:
```bash
curl -s -X POST <api_url>/v1/autoresearch/experiments/<id>/generate-variants \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"single_knob_sweep","knob":"<knob>"}'
```

If the argument is a profile name:
```bash
curl -s -X POST <api_url>/v1/autoresearch/experiments/<id>/generate-variants \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"profile","profileName":"<profile>"}'
```

If the argument is `all`:
- Run `single_knob_sweep` for each sweepable knob from the meta endpoint.

Print a table of generated variants: label, config delta, hash.

---

## Step 3: Benchmark All Variants

For EACH variant (including baseline), run:
```bash
curl -s -X POST <api_url>/v1/autoresearch/benchmark \
  -H 'Content-Type: application/json' \
  -d '{"variantId":"<variant_id>"}'
```

Run them **sequentially** (not in parallel — each benchmark hits the DB). Show progress:
```
Benchmarking: [1/7] baseline ... done (3.2s)
Benchmarking: [2/7] rrfK=20 ... done (2.8s)
...
```

If any benchmark fails, log the error and continue to the next variant. Do NOT stop the whole sweep.

---

## Step 4: Report

```bash
curl -s <api_url>/v1/autoresearch/experiments/<id>/report
```

Parse the JSON response and print a **formatted comparison table**:

```
┌──────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ Variant      │ Utility  │ Recall@K │ AvgScore │ TierA%   │ Δ Utility│
├──────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ baseline     │ 0.342    │ 0.000    │ 0.412    │ 0.380    │ -        │
│ rrfK=45      │ 0.368    │ 0.000    │ 0.445    │ 0.392    │ +2.6%    │
│ rrfK=30 ★    │ 0.385    │ 0.000    │ 0.461    │ 0.401    │ +4.3%    │
│ ...          │          │          │          │          │          │
└──────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

Mark the best variant with ★. Also show per-slice breakdown for the top 3 variants.

---

## Step 5: Recommendation

Based on the report:

- If a variant has `Δ Utility ≥ 3%` with no guardrail regressions, recommend promoting it. Show the exact config delta to apply.
- If multiple variants qualify, recommend the one with highest utility.
- If no variant qualifies, say so and suggest next steps (try different knobs, add more benchmark queries, etc.).

**Do NOT auto-promote.** Just print the recommendation and the command to promote:
```bash
curl -s -X POST <api_url>/v1/autoresearch/experiments/<id>/promote/<variant_id>
```

---

## Summary

At the end, print:
- Experiment ID (for reference)
- Total variants benchmarked
- Best variant and its improvement
- Recommended action (promote / investigate / no improvement)
