# Regression fixtures — confirmed P0 incidents

Every confirmed P0 incident becomes a **minimal permanent fixture** in this
directory. Fixtures are ordinary eval case files (same YAML schema as
`cases/tier1/`) and run with the standard runner:

```bash
cd eval
npx ts-node cli.ts run --cases cases/regression/<fixture>.yaml --output reports/regression-report.json --summary
```

## Convention

- **File name**: `p0_<YYYY_MM_DD>_<slug>.yaml` — the date is the date the
  incident was confirmed (report/CI run date), the slug names the failure mode.
- **Case IDs**: `REG-P0-<YYYYMMDD>-<SLUG>-NN` so cluster reports and manifest
  checks make the regression lineage obvious.
- **Header comment** (mandatory): incident date, source (report file / CI run
  ID), observed failure signature, and the pass criteria that prove the fix.
- **Minimal**: one to four cases reproducing the exact failing query/intent —
  no broad suites here.
- **Permanent**: fixtures are never deleted. Removing or renaming a case
  requires a tombstone entry in `cases/case-manifest.json`
  (`npx ts-node scripts/case-manifest.ts update --tombstone <id> --reason "..."`),
  which is deliberately loud.
- **No patient data**: queries must be synthetic. Never paste raw user chats,
  session IDs, or secrets into a fixture.

## Existing incident fixtures

| Fixture | Incident | Signature |
|---------|----------|-----------|
| `p0_2026_03_26_zero_citation_stomach.yaml` | tier1-report-v4 (2026-03-26), RQ-STOMACH-01 | 6 chunks retrieved, 0 citations, `citation_validation_failed` abstention, confidence RED |
| `p0_2026_07_05_lung_retrieval_miss.yaml` | Nightly CI run 28731647092 (2026-07-05), RQ-LUNG-02 | 0 chunks retrieved, 0 citations for a symptomatic lung query — total retrieval miss |
| `../tier1/zero_citation_regression.yaml` (pre-dates this convention) | Citation contract breach (4 cases, colorectal/cervical) | retrieved > 0 but 0 citations |
