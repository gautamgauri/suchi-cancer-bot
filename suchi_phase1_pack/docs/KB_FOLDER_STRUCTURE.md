# KB Folder Structure - Gold Stack

## Complete Directory Tree

```
kb/
├── manifest.json                    # Central manifest (all documents with metadata)
├── manifest.goldstack.example.json  # Example manifest with full metadata
│
└── en/                              # English content (add hi/, te/, etc. for other languages)
    ├── 01_suchi_oncotalks/         # SCCF-owned Onco Talks transcripts
    │   ├── chemo-experiences.md
    │   ├── patient-stories.md
    │   └── ...
    │
    ├── 02_nci_core/                # NCI PDQ, Cancer.gov pages, dictionaries, thesaurus
    │   ├── breast-cancer-treatment-pdq.md
    │   ├── cancer-basics.md
    │   ├── glossary.md
    │   └── ...
    │
    ├── 03_who_public_health/       # WHO public health guidance
    │   ├── cancer-prevention.md
    │   ├── screening-guidelines.md
    │   └── ...
    │
    ├── 04_iarc_stats/              # IARC/GLOBOCAN statistics and prevention
    │   ├── india-breast-cancer-incidence.md
    │   ├── global-cancer-statistics.md
    │   └── ...
    │
    ├── 05_india_ncg/               # National Cancer Grid (India context, ND-aware)
    │   ├── treatment-guidelines.md
    │   ├── india-specific-protocols.md
    │   └── ...
    │
    ├── 06_pmc_selective/           # PMC open-access articles (selective, high-quality)
    │   ├── immunotherapy-recent-advances.md
    │   └── ...
    │
    └── 99_local_navigation/        # Local resources (helplines, hospitals, schemes)
        ├── india-helplines.md
        ├── hospital-directory.md
        └── government-schemes.md
```

## Naming Conventions

### Folder Names
- Use numbered prefixes (01_, 02_, etc.) for consistent ordering
- Use descriptive names: `01_suchi_oncotalks`, not `01_stuff`
- Use lowercase with underscores

### File Names
- Use kebab-case: `breast-cancer-treatment.md`
- Be descriptive: `chemo-experiences.md`, not `doc1.md`
- Include topic/cancer type when relevant

### Document IDs in Manifest
- Format: `kb_{locale}_{source}_{topic}_{version}`
- Example: `kb_en_nci_pdq_breast_cancer_treatment_v1`
- Keep IDs consistent across versions

## Current vs. Proposed Structure

### Current Structure (Phase 1)
```
kb/en/
  01_basics/
  02_symptoms-next-steps/
  06_caregiver/
```

### Gold Stack Structure (Proposed)
```
kb/en/
  01_suchi_oncotalks/      # NEW: SCCF-owned content
  02_nci_core/             # NEW: NCI authoritative content
  03_who_public_health/    # NEW: WHO guidance
  04_iarc_stats/           # NEW: Statistics
  05_india_ncg/            # NEW: India context
  06_pmc_selective/        # NEW: Research articles
  99_local_navigation/     # NEW: Local resources
```

## Migration Path

1. **Phase 1 files can stay where they are** (backward compatible)
2. **New content goes into Gold Stack folders**
3. **Gradually migrate old content** when updating it
4. **Update manifest entries** as you migrate

## Multi-Language Support

When adding languages, mirror the structure:

```
kb/
├── en/
│   └── 01_suchi_oncotalks/
├── hi/                    # Hindi
│   └── 01_suchi_oncotalks/
└── te/                    # Telugu
    └── 01_suchi_oncotalks/
```

Keep manifest per-language or unified (with language field in metadata).





















