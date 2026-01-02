# NCI Data Ingestion Guide

## Overview

This guide explains how to set up and run the NCI (National Cancer Institute) data ingestion pipeline for the Suchi KB.

## Quick Start

1. **Setup Python environment**:
   ```bash
   cd scripts/nci-ingestion
   pip install -r requirements.txt
   ```

2. **Run full pipeline**:
   ```bash
   python update_nci.py
   ```

3. **Ingest into KB**:
   ```bash
   cd ../../apps/api
   npm run kb:ingest
   ```

## Components

### 1. Sitemap Crawler
- Discovers URLs from cancer.gov sitemap
- Filters by target sections (PDQ, cancer types, dictionaries)
- Respects rate limits and robots.txt

### 2. Content Extractor
- Downloads HTML pages
- Extracts main content (removes nav, headers, footers)
- Extracts metadata (title, dates, cancer types, tags)

### 3. Content Processor
- Converts HTML to clean Markdown
- Adds frontmatter with KB metadata
- Organizes files into subfolders (pdq/, cancer-types/, etc.)

### 4. NCIt Processor
- Downloads NCIt thesaurus OWL file
- Parses concepts, synonyms, definitions
- Generates synonym mapping JSON

### 5. Synonym Service
- Loads NCIt synonyms into RAG service
- Expands user queries with medical synonyms
- Improves search relevance

## Configuration

Edit `scripts/nci-ingestion/config.yaml`:

```yaml
target_sections:
  - "/publications/pdq"        # PDQ summaries
  - "/types/"                  # Cancer types
  - "/publications/dictionaries" # Dictionaries

rate_limit_delay: 1.5  # seconds between requests
```

## Monthly Updates

### Automated Script
```bash
bash scripts/nci-ingestion/update_nci.sh
```

### Manual Steps
1. Crawl sitemap: `python crawl_sitemap.py`
2. Extract content: `python extract_content.py`
3. Process to Markdown: `python process_content.py`
4. Update manifest: Automatic in `update_nci.py`
5. Ingest KB: `cd apps/api && npm run kb:ingest`

## NCIt Thesaurus

### Initial Setup
```bash
python process_ncit.py --force-download
```

This downloads and processes the NCIt OWL file (~100MB, takes a few minutes).

### Updates
NCIt is updated quarterly. Run with `--force-download` when needed.

### Synonym Usage
Once processed, the synonym mapping is automatically loaded by the RAG service:
- Queries like "bowel cancer" expand to include "colorectal cancer"
- Improves retrieval of relevant content
- Works with both vector and keyword search

## Output Structure

After ingestion, you'll have:

```
kb/en/02_nci_core/
├── pdq/
│   ├── breast-cancer-treatment-pdq.md
│   └── ...
├── cancer-types/
│   ├── breast-cancer-overview.md
│   └── ...
├── dictionaries/
│   └── ...
└── ncit/
    ├── ncit-synonyms.json
    └── concepts/
        └── ...
```

All files have proper frontmatter with:
- Source attribution
- License information
- Review dates
- Cancer type tags
- Original URLs

## Troubleshooting

### Rate Limiting
If you get blocked or rate-limited:
- Increase `rate_limit_delay` in config.yaml
- Process in smaller batches
- Use `--skip-sitemap` to reuse cached URLs

### Content Extraction Errors
- Some pages may have unusual HTML structure
- Check `extracted_content.json` for errors
- Review failed URLs manually

### NCIt Download Fails
- Check internet connection
- Verify URL is accessible: https://evs.nci.nih.gov/ftp1/rdf/Thesaurus.owl
- File is ~100MB, may take time

### Synonym Service Not Loading
- Verify `ncit-synonyms.json` exists
- Check file path in logs
- Restart API server after generating synonyms

## Integration with RAG

The synonym service automatically:
1. Loads `ncit-synonyms.json` on startup
2. Expands queries with medical synonyms
3. Improves search recall and relevance

Example:
- User query: "bowel cancer symptoms"
- Expanded: ["bowel cancer", "colorectal cancer", "colon cancer", ...] + "symptoms"
- Better matches content about colorectal cancer

## License Compliance

All NCI content includes:
- Proper attribution in frontmatter
- Source URLs preserved
- License: Public domain (US government)
- NCIt: CC BY 4.0

## Next Steps

- Set up monthly cron job for automated updates
- Monitor content freshness (check reviewed dates)
- Test query expansion with synonym service
- Consider incremental updates (only changed pages)











