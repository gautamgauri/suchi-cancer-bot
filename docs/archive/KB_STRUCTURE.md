# Suchi KB Structure

## Phase 1 Structure (Current)

```
kb/
  manifest.json
  en/
    01_basics/
    02_symptoms-next-steps/
    06_caregiver/
```

## Gold Stack Structure (Recommended)

See [`KB_GOLD_STACK.md`](./KB_GOLD_STACK.md) for the complete Gold Stack organization with source-based folders and enhanced metadata.

Quick overview:
```
kb/
  manifest.json
  en/
    01_suchi_oncotalks/      # SCCF-owned Onco Talks
    02_nci_core/             # NCI PDQ, Cancer.gov
    03_who_public_health/    # WHO guidance
    04_iarc_stats/           # IARC/GLOBOCAN statistics
    05_india_ncg/            # National Cancer Grid (India)
    06_pmc_selective/        # PMC open access articles
    99_local_navigation/     # Local resources
```

## Manifest

`manifest.json` is the source of truth for:
- Document IDs, titles, versions, status
- File paths
- **New in Gold Stack**: Source type, license, review dates, audience level, tags, citations

See [`KB_MIGRATION_GUIDE.md`](./KB_MIGRATION_GUIDE.md) for migration instructions.
