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
├── manifest.oncotalks-pending.json  # STAGED video transcripts — not ingested
├── manifest.goldstack.example.json  # Example with full metadata
│
├── hi/
│   └── 01_suchi_oncotalks/         # Hindi OncoTalks transcripts (tracked in git)
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

## Video transcripts (OncoTalks) — review gate

SCCF's own YouTube channel is transcribed into `kb/hi/01_suchi_oncotalks/`
(and `kb/en/01_suchi_oncotalks/` for the one English-original video). These
files are **not** like the rest of the KB and are handled differently.

**What they are.** Uncorrected machine transcripts. Every caption on the
channel is produced by automatic speech recognition; there are no human-checked
caption tracks. ASR is wrong on exactly the words that matter here — it renders
"Onco Talks by Suchitra Cancer Care" as "Enko Talks by Soetra Cancer Care", and
it does the same to clinician names, drug names, dosages and trial names. Treat
every line as *what the transcript says*, not as verified medical fact.

**They are inactive until SCCF review.** Each document carries
`status: inactive` and `reviewStatus: pending`. Retrieval filters on
`d.status = 'active'` (`apps/api/src/modules/rag/rag.service.ts`), so an
unreviewed transcript cannot appear in an answer.

**They are not in `manifest.json`.** Their manifest entries are staged in
`kb/manifest.oncotalks-pending.json`. `apps/api/src/scripts/ingest-kb.ts` reads
`<kbRoot>/manifest.json` and nothing else, so `npm run kb:ingest` cannot pick
them up — not by accident, and not as a side effect of a routine re-ingest.

**How they get reviewed.** Through a pull request, like code. `kb/hi/` is
tracked by git (only `kb/en/` is in `.gitignore`, because it holds the imported
NCI corpus), so a Hindi transcript is reviewable as a normal diff. A reviewer
reads the draft against the recording — every section heading carries a `?t=`
deep link to the exact moment — and corrects the text in the PR.

**Promotion is deliberate and manual.** After SCCF sign-off: move the entry
from `kb/manifest.oncotalks-pending.json` into `kb/manifest.json`, set
`status` to `active`, record the reviewer, and only then run `npm run kb:ingest`.
Nothing automates this step.

### `transcriptQuality`

A staged manifest entry carries two extra fields beyond the normal metadata:

- **`captionTrack`** — the YouTube caption track the text came from, e.g.
  `hi-orig` (ASR of the Hindi actually spoken) or `en-orig`. A bare `hi` or `en`
  would be a machine *translation* of a machine transcription; the tooling
  refuses those outright, because that is two lossy machine steps stacked on
  medical content.
- **`transcriptQuality`** — the reviewer's standing verdict on how much this
  text can be trusted:
  - `machine-generated, uncorrected` — straight ASR output, nobody has checked
    it. This is the default and the state every draft starts in. Not eligible
    for `status: active`.
  - `PLACEHOLDER` — the draft was generated before any reviewer looked at it;
    the field is waiting for a real value.
  - A reviewer's own note (e.g. *"corrected against audio 2026-09-12, drug names
    verified"*) — written by the person who did the correction, naming what they
    checked. Only a transcript with a note of this kind should ever be promoted.

The open questions about whether this material belongs in a patient-facing bot
at all — and at what trust tier — are decisions D1–D5 in issue #91 and are for
SCCF medical review, not for the pipeline.

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





















