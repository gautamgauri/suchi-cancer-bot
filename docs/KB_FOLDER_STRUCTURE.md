# KB Folder Structure - Gold Stack

## Complete Directory Tree

```
kb/
├── manifest.json                    # Central manifest (all documents with metadata)
├── manifest.goldstack.example.json  # Example manifest with full metadata
│
└── en/                              # English content (add hi/, te/, etc. for other languages)
    ├── 01_basics/                  # General cancer awareness (Phase 1 legacy)
    ├── 01_suchi_oncotalks/         # SCCF-owned Onco Talks transcripts
    │   ├── chemo-experiences.md
    │   ├── patient-stories.md
    │   └── ...
    │
    ├── 02_nci_core/                # NCI PDQ, Cancer.gov pages, dictionaries, thesaurus
    │   ├── coping/
    │   ├── treatment/
    │   ├── cancer-types/
    │   ├── pdq/
    │   └── ...
    │
    ├── 02_symptoms-next-steps/     # Symptoms and next steps (Phase 1 legacy)
    │
    ├── 03_who_public_health/       # [PLANNED, NEVER CREATED] WHO public health guidance
    │
    ├── 04_iarc_stats/              # [PLANNED, NEVER CREATED] IARC/GLOBOCAN statistics and prevention
    │
    ├── 05_india_ncg/               # National Cancer Grid (India context, ND-aware)
    │   ├── treatment-guidelines.md
    │   ├── india-specific-protocols.md
    │   └── ...
    │
    ├── 06_caregiver/               # Caregiver support (Phase 1 legacy)
    │
    ├── 06_pmc_selective/           # [PLANNED, NEVER CREATED] PMC open-access articles (selective, high-quality)
    │
    ├── 99_local_navigation/        # Local resources (helplines, hospitals, schemes, pricing)
    │   ├── india-helplines.md
    │   ├── hospital-directory.md
    │   ├── government-schemes.md
    │   └── cancer-treatment-costs-india.md
    │
    └── website/                    # Exported website article drafts
```

## Naming Conventions

### Folder Names
- Use numbered prefixes (01_, 02_, etc.) for consistent ordering
- Use lowercase with underscores
- Special legacy folders (e.g. `website`, `02_symptoms-next-steps`) are retained for compatibility

### File Names
- Use kebab-case: `breast-cancer-treatment.md`
- Be descriptive: `chemo-experiences.md`, not `doc1.md`
- Include topic/cancer type when relevant

### Document IDs in Manifest
- Format: `kb_{locale}_{source}_{topic}_{version}`
- Example: `kb_en_nci_pdq_breast_cancer_treatment_v1`
- Keep IDs consistent across versions

## Folder Reference

### Existing Folders
- `01_basics`: General cancer definitions and concepts.
- `01_suchi_oncotalks`: transcripts of SCCF-owned talks.
- `02_nci_core`: NCI content structured into `coping/`, `treatment/`, `cancer-types/`, and `pdq/`.
- `02_symptoms-next-steps`: Symptoms and clinical guidelines.
- `05_india_ncg`: National Cancer Grid guidelines adapted for Indian oncology.
- `06_caregiver`: Educational material for cancer patient caregivers.
- `99_local_navigation`: India-specific helpline contacts, hospital lists, and schemes.
- `website`: Exported website article drafts.

### Planned Folders (Never Created)
- `03_who_public_health`
- `04_iarc_stats`
- `06_pmc_selective`

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





















