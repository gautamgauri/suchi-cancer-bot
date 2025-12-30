# Suchi KB "Gold Stack" Structure

## Overview

The Gold Stack organizes knowledge sources to prevent "citation smoothie" - keeping sources distinct and traceable. Each source has clear licensing, review dates, and appropriate use cases.

## Folder Structure

```
kb/
  manifest.json                    # Central manifest with metadata
  en/                              # English content (add hi/, te/, etc. for other languages)
    01_suchi_oncotalks/           # SCCF-owned Onco Talks transcripts
    02_nci_core/                  # NCI PDQ, Cancer.gov pages, dictionaries, thesaurus
    03_who_public_health/         # WHO public health guidance
    04_iarc_stats/                # IARC/GLOBOCAN statistics and prevention
    05_india_ncg/                 # National Cancer Grid (India context, ND-aware)
    06_pmc_selective/             # PMC open-access articles (selective, high-quality)
    99_local_navigation/          # Local resources (helplines, hospitals, schemes)
```

## Source Priority & Use Cases

### 01_suchi_oncotalks
- **Priority**: Highest (owned content)
- **Use**: Primary source for patient narratives, practical advice
- **License**: SCCF-owned
- **Update Frequency**: After each Onco Talks session

### 02_nci_core
- **Priority**: High (authoritative)
- **Use**: Standard definitions, treatment protocols, evidence-based info
- **License**: Public domain (US government)
- **Update Frequency**: Quarterly review
- **Includes**: PDQ summaries, Cancer.gov pages, NCI dictionaries/thesaurus

### 03_who_public_health
- **Priority**: High (global standards)
- **Use**: Prevention, screening guidelines, global statistics
- **License**: CC BY-NC-SA (check specific pages)
- **Update Frequency**: Annual review

### 04_iarc_stats
- **Priority**: Medium (reference)
- **Use**: Cancer statistics, incidence rates, prevention data
- **License**: IARC usage terms (typically permissive)
- **Update Frequency**: As new GLOBOCAN releases

### 05_india_ncg
- **Priority**: High (local context)
- **Use**: India-specific protocols, ND-aware guidance, regional considerations
- **License**: NCG terms (likely permissive for public health)
- **Update Frequency**: Quarterly review
- **Note**: ND-aware = Non-communicable disease context

### 06_pmc_selective
- **Priority**: Medium (depth when needed)
- **Use**: Deep dives on specific topics, latest research
- **License**: Open access articles only
- **Update Frequency**: Selective addition, review before inclusion
- **Criteria**: Peer-reviewed, open access, high impact, relevance to patient questions

### 99_local_navigation
- **Priority**: High (practical resources)
- **Use**: Helplines, hospital directories, government schemes, support groups
- **License**: Public information / compiled from public sources
- **Update Frequency**: Monthly review

## Metadata Schema

Each document in the manifest should include:

```json
{
  "id": "unique_doc_id",
  "title": "Document Title",
  "version": "v1",
  "status": "active" | "inactive" | "deprecated",
  "source": "Source organization/program name",
  "sourceType": "01_suchi_oncotalks" | "02_nci_core" | "03_who_public_health" | "04_iarc_stats" | "05_india_ncg" | "06_pmc_selective" | "99_local_navigation",
  "path": "en/02_nci_core/cancer-basics.md",
  "license": "public_domain" | "cc_by_nc_sa" | "cc_by" | "sccf_owned" | "open_access" | "public_info",
  "lastReviewed": "2024-01-15",
  "reviewFrequency": "quarterly" | "annual" | "monthly" | "as_needed",
  "audienceLevel": "patient" | "caregiver" | "general" | "technical",
  "language": "en" | "hi" | "te",
  "cancerTypes": ["breast", "lung", "general"],
  "tags": ["diagnosis", "treatment", "side-effects"],
  "url": "https://cancer.gov/...",  // Original source URL if applicable
  "citation": "NCI PDQ, 2024"  // How to cite this source
}
```

## Implementation Benefits

1. **Traceability**: Every chunk knows its source
2. **License Compliance**: Clear licensing per source
3. **Quality Control**: Review dates ensure freshness
4. **Contextual Retrieval**: Can prioritize sources based on query
5. **Citation**: Bot can cite sources appropriately
6. **Localization**: Language and region tags support multi-lingual/multi-region expansion

## Retrieval Strategy

The RAG service can be enhanced to:
- Prioritize sources based on query type (e.g., stats → IARC, treatment → NCI)
- Respect license restrictions in responses
- Include source citations in responses
- Filter by audience level (e.g., patient-friendly vs technical)
- Consider language preferences





