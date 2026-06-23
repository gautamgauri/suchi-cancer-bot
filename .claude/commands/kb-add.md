---
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
argument-hint: "<topic description>"
---

# Add a Knowledge Base Article

Create a new KB article and register it in the manifest. The user's topic is: $ARGUMENTS

## Step 1: Ask for Category and Risk Category

Ask the user to pick a category using AskUserQuestion:

| Category | Directory | Source | License |
|----------|-----------|--------|---------|
| `01_suchi_oncotalks` | SCCF-owned content (highest priority) | `SCCF KB` | `sccf_owned` |
| `02_nci_core` | NCI authoritative definitions | `NCI (Adapted)` | `public_domain` |
| `05_india_ncg` | India-specific oncology guidance | `NCG India (Adapted)` | `open_access` |
| `99_local_navigation` | Local navigation & resources | `SCCF Navigation Guidance` | `sccf_owned` |

Also ask the user to pick a **risk category** (FR-KB-101):

| Category | When to use |
|----------|-------------|
| `A` — Low-Risk Awareness | General awareness, myths, prevention, screening basics, glossary terms |
| `B` — Medium-Risk Treatment Explanation | Chemotherapy, radiation, surgery, side effects, staging, biopsy, palliative care |
| `C` — High-Risk Guidance | Symptoms, emergencies, report interpretation, treatment decisions, side-effect severity, crisis |

Default to `A` if unsure. Category B and C entries require a `reviewerName` before being marked `approved`.

## Step 2: Generate identifiers

From the topic description, generate:
- **slug**: lowercase, underscores, concise (e.g., `breast_cancer_treatment`)
- **file_id**: `kb_en_{slug}_v1`
- **filename**: kebab-case `.md` (e.g., `breast-cancer-treatment.md`)
- **title**: Title-cased version of the topic

Check for conflicts:
- Grep `manifest.json` for the generated `file_id` to ensure uniqueness
- Glob `kb/en/{category}/` to ensure filename doesn't already exist

## Step 3: Determine source metadata

Based on the chosen category:

| Category | `source` | `sourceType` | `license` | `citation` |
|----------|----------|--------------|-----------|------------|
| `01_suchi_oncotalks` | `SCCF KB` | `01_suchi_oncotalks` | `sccf_owned` | `SCCF KB, 2025` |
| `02_nci_core` | `NCI (Adapted)` | `02_nci_core` | `public_domain` | `NCI PDQ, Adapted 2025` |
| `05_india_ncg` | `NCG India (Adapted)` | `05_india_ncg` | `open_access` | `NCG India, Adapted 2025` |
| `99_local_navigation` | `SCCF Navigation Guidance` | `99_local_navigation` | `sccf_owned` | `SCCF KB, 2025` |

## Step 4: Create the markdown file

Write to `kb/en/{category}/{filename}.md`:

```markdown
---
title: "{title}"
version: "v1"
status: "active"
source: "{source}"
reviewStatus: "pending"
riskCategory: "{A|B|C}"
reviewerName: ""
approvedUsageScope: "general"
---

## Overview

<!-- Brief introduction to {topic} -->

## Key points

- <!-- Point 1 -->
- <!-- Point 2 -->
- <!-- Point 3 -->

## Next steps

- Persistent symptoms (2-3+ weeks) merit an in-person evaluation with a healthcare provider
- Severe symptoms (breathing difficulty, heavy bleeding, fainting) require urgent care

## Questions to ask a doctor

- <!-- Question 1 -->
- <!-- Question 2 -->
```

## Step 5: Update manifest.json

Read `kb/manifest.json`, parse the JSON, and append a new entry to the `docs` array with all 15 fields:

```json
{
  "id": "<file_id>",
  "title": "<title>",
  "version": "v1",
  "status": "active",
  "source": "<source>",
  "sourceType": "<category>",
  "path": "en/<category>/<filename>.md",
  "license": "<license>",
  "lastReviewed": "<today YYYY-MM-DD>",
  "reviewFrequency": "quarterly",
  "audienceLevel": "patient",
  "language": "en",
  "cancerTypes": ["<inferred from topic, or 'general'>"],
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "url": null,
  "citation": "<citation>",
  "reviewerName": null,
  "reviewStatus": "pending",
  "riskCategory": "<A|B|C>",
  "approvedUsageScope": "general"
}
```

Use Edit to append the entry just before the closing `]` of the docs array. Ensure valid JSON (proper comma before the new entry).

## Step 6: Ask about ingestion

Ask the user: "Run `npm run kb:ingest` in apps/api/ to ingest the new article into the vector store?"

If yes:
```bash
cd /home/gauta/suchi_repo/apps/api && npm run kb:ingest
```

## Constants

- **KB root:** `/home/gauta/suchi_repo/kb/`
- **Manifest:** `/home/gauta/suchi_repo/kb/manifest.json`
- **Schema version:** `2.0`
