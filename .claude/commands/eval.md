---
allowed-tools: Bash, Read
argument-hint: "[API URL or \"local\"]"
---

# Run Tier1 Eval Suite

Run the tier1 evaluation suite against the Suchi Cancer Bot API.

The user's argument is: $ARGUMENTS

## Determine Target URL

- If no argument (or empty): use production `https://suchi-api-lxiveognla-uc.a.run.app/v1`
- If argument is `local`: use `http://localhost:3001/v1`
- Otherwise: treat the argument as a custom API base URL (ensure it ends with `/v1` — append if missing)

## Steps

### 1. Fetch DEEPSEEK_API_KEY from Secret Manager

```bash
gcloud secrets versions access latest --secret=deepseek-api-key --project=gen-lang-client-0202543132
```

Store the value — it will be set as an environment variable for the eval run.

### 2. Install dependencies (if needed)

```bash
cd /home/gauta/suchi_repo/eval && npm install
```

### 3. Create reports directory

```bash
mkdir -p /home/gauta/suchi_repo/eval/reports
```

### 4. Run tier1 eval

```bash
cd /home/gauta/suchi_repo/eval && \
  EVAL_API_BASE_URL="<target_url>" \
  DEEPSEEK_API_KEY="<key_from_step_1>" \
  npm run eval:tier1
```

This runs `ts-node cli.ts run --cases cases/tier1/retrieval_quality.yaml --output reports/tier1-report.json --summary`.

The eval may take several minutes due to LLM calls. Let it run (use a 10-minute timeout).

### 5. Parse and display results

Read `eval/reports/tier1-report.json` and display:

```
## Tier1 Eval Results

| Metric                          | Value       |
|---------------------------------|-------------|
| Target                          | <url>       |
| Total Cases                     | N           |
| Passed                          | N (XX.X%)   |
| Failed                          | N (XX.X%)   |
| Average Score                   | XX.X%       |
| Top-3 Trusted Presence Rate     | XX.X%       |
| Citation Coverage Rate          | XX.X%       |
| Abstention Rate                 | XX.X%       |

### Failed Cases
| Case ID | Score | Issue |
|---------|-------|-------|
| ...     | ...   | ...   |

### LLM Cost (if available in report)
...
```

If the report contains `summary.retrievalQuality`, extract:
- `top3TrustedPresenceRate`
- `citationCoverageRate`
- `abstentionRate`

Also list any cases where `passed === false`, showing their `id` and failure reason.

## Constants

- **Eval dir:** `/home/gauta/suchi_repo/eval/`
- **Report path:** `eval/reports/tier1-report.json`
- **GCP Project:** `gen-lang-client-0202543132`
- **NCI Dominance Threshold:** 90% (informational — the command reports but does not gate)
