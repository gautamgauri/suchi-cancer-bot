# KB Migration Guide: Gold Stack Structure

## Overview

This guide helps you migrate from the current KB structure to the new "Gold Stack" structure with enhanced metadata.

## Step 1: Update Prisma Schema

The schema has been updated with new fields. Run a migration:

```bash
cd apps/api
npx prisma migrate dev --name add_kb_metadata
```

This adds:
- `sourceType` - Source category (01_suchi_oncotalks, etc.)
- `license` - License type
- `lastReviewed` - Last review date
- `reviewFrequency` - How often to review
- `audienceLevel` - Target audience
- `language` - Content language
- `cancerTypes` - Array of relevant cancer types
- `tags` - Array of topic tags
- `url` - Original source URL
- `citation` - Citation format

## Step 2: Update Manifest Structure

### Option A: Gradual Migration (Backward Compatible)

Keep existing manifest entries as-is. They'll work with default values:
- Missing fields will be `null` or defaults
- Old documents remain accessible

### Option B: Full Migration (Recommended)

1. **Organize files into Gold Stack folders:**

```
kb/en/
  01_suchi_oncotalks/     # Move your Onco Talks content here
  02_nci_core/            # NCI content
  03_who_public_health/   # WHO content
  04_iarc_stats/          # IARC/GLOBOCAN
  05_india_ncg/           # NCG India content
  06_pmc_selective/       # PMC articles
  99_local_navigation/    # Local resources
```

2. **Update manifest.json** with new metadata:

```json
{
  "locale": "en",
  "schemaVersion": "2.0",
  "docs": [
    {
      "id": "kb_en_doc_id_v1",
      "title": "Document Title",
      "version": "v1",
      "status": "active",
      "source": "Source Name",
      "sourceType": "01_suchi_oncotalks",
      "path": "en/01_suchi_oncotalks/document.md",
      "license": "sccf_owned",
      "lastReviewed": "2024-01-15",
      "reviewFrequency": "quarterly",
      "audienceLevel": "patient",
      "language": "en",
      "cancerTypes": ["general"],
      "tags": ["tag1", "tag2"],
      "url": "https://...",
      "citation": "Source Citation, 2024"
    }
  ]
}
```

3. **See `manifest.goldstack.example.json` for complete examples**

## Step 3: Re-ingest Knowledge Base

```bash
cd apps/api
npm run kb:dry      # Verify structure
npm run kb:ingest   # Ingest with new metadata
```

## Step 4: Update RAG Service (Optional Enhancement)

You can enhance the RAG service to leverage metadata:

```typescript
// Example: Filter by source type
const chunks = await prisma.kbChunk.findMany({
  where: {
    document: {
      sourceType: "02_nci_core",  // Prefer NCI for treatment questions
      status: "active",
      language: "en"
    },
    // ... content search
  }
});
```

## Field Reference

### sourceType Values
- `01_suchi_oncotalks` - SCCF-owned Onco Talks
- `02_nci_core` - NCI PDQ, Cancer.gov
- `03_who_public_health` - WHO guidance
- `04_iarc_stats` - IARC/GLOBOCAN stats
- `05_india_ncg` - National Cancer Grid India
- `06_pmc_selective` - PMC open access
- `99_local_navigation` - Local resources

### license Values
- `public_domain` - US government works
- `cc_by_nc_sa` - Creative Commons BY-NC-SA
- `cc_by` - Creative Commons BY
- `sccf_owned` - SCCF-owned content
- `open_access` - Open access articles
- `public_info` - Public information

### audienceLevel Values
- `patient` - Patient-friendly language
- `caregiver` - Caregiver-focused
- `general` - General public
- `technical` - Medical/technical audience

### reviewFrequency Values
- `quarterly` - Every 3 months
- `annual` - Once per year
- `monthly` - Once per month
- `as_needed` - When updates available

## Validation Checklist

- [ ] Prisma migration completed
- [ ] Files organized into Gold Stack folders
- [ ] Manifest updated with metadata
- [ ] `kb:dry` runs without errors
- [ ] `kb:ingest` completes successfully
- [ ] Documents visible in database with metadata
- [ ] RAG service can query by metadata (optional)

## Backward Compatibility

The ingestion script is backward compatible:
- Old manifest entries without new fields will work
- Missing fields default to `null` or sensible defaults
- You can migrate gradually, document by document





