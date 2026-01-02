# Suchi Knowledge Base - Gold Stack

## Overview

The Knowledge Base uses a "Gold Stack" organization to prevent "citation smoothie" - keeping sources distinct and traceable. Each source has clear licensing, review dates, and appropriate use cases.

## Quick Start

1. **Review the structure**: See [`docs/KB_GOLD_STACK.md`](../docs/KB_GOLD_STACK.md)
2. **Check examples**: See [`manifest.goldstack.example.json`](./manifest.goldstack.example.json)
3. **Migrate**: Follow [`docs/KB_MIGRATION_GUIDE.md`](../docs/KB_MIGRATION_GUIDE.md)

## Folder Structure

```
kb/
├── manifest.json                    # Main manifest (update this when adding docs)
├── manifest.goldstack.example.json  # Example with full metadata
│
└── en/
    ├── 01_suchi_oncotalks/         # SCCF-owned content (highest priority)
    ├── 02_nci_core/                # NCI authoritative content
    ├── 03_who_public_health/       # WHO guidance
    ├── 04_iarc_stats/              # Statistics
    ├── 05_india_ncg/               # India context
    ├── 06_pmc_selective/           # Research articles
    └── 99_local_navigation/        # Local resources
```

## Source Priority

1. **01_suchi_oncotalks** - Your owned content (primary source)
2. **02_nci_core** - Authoritative definitions and protocols
3. **03_who_public_health** - Global prevention guidelines
4. **05_india_ncg** - India-specific context
5. **04_iarc_stats** - Statistical reference
6. **06_pmc_selective** - Deep research (use selectively)
7. **99_local_navigation** - Practical local resources

## Adding a New Document

1. Place file in appropriate folder: `en/02_nci_core/my-document.md`
2. Add entry to `manifest.json` with required metadata
3. Run ingestion: `cd apps/api && npm run kb:ingest`

## Metadata Fields

Each document in manifest should include:

- **Required**: `id`, `title`, `version`, `status`, `path`
- **Recommended**: `source`, `sourceType`, `license`, `audienceLevel`
- **Optional**: `lastReviewed`, `reviewFrequency`, `url`, `citation`, `tags`, `cancerTypes`

See [`manifest.goldstack.example.json`](./manifest.goldstack.example.json) for complete examples.

## License Compliance

Make sure to track license for each source:
- `public_domain` - US government works (NCI)
- `sccf_owned` - Your content
- `cc_by_nc_sa` - Creative Commons (WHO, typically)
- `open_access` - Open access articles
- `public_info` - Public information

## Review Schedule

- **Quarterly**: NCI, NCG, Onco Talks
- **Annual**: WHO, IARC
- **Monthly**: Local navigation
- **As needed**: PMC articles

## Questions?

- Structure: See [`docs/KB_GOLD_STACK.md`](../docs/KB_GOLD_STACK.md)
- Migration: See [`docs/KB_MIGRATION_GUIDE.md`](../docs/KB_MIGRATION_GUIDE.md)
- Folder details: See [`docs/KB_FOLDER_STRUCTURE.md`](../docs/KB_FOLDER_STRUCTURE.md)










