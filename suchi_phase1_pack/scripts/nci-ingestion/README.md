# NCI Data Ingestion for Suchi KB

Automated pipeline to ingest content from the National Cancer Institute (NCI) including PDQ summaries, cancer.gov pages, dictionaries, and the NCI Thesaurus (NCIt).

## Quick Start

See [`QUICK_START.md`](QUICK_START.md) for fastest local testing.

See [`SETUP_LOCAL.md`](SETUP_LOCAL.md) for detailed local setup instructions.

## Overview

This pipeline:
1. **Crawls** cancer.gov sitemap to discover content URLs
2. **Extracts** HTML content and metadata from pages
3. **Processes** content to clean Markdown format
4. **Downloads** and parses NCIt thesaurus for synonym mapping
5. **Updates** KB manifest.json automatically
6. **Integrates** with existing KB ingestion pipeline

## Setup

1. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure** (optional):
   - Edit `config.yaml` to customize target sections, rate limits, etc.

## Usage

### Full Pipeline (Recommended)

Run the complete ingestion pipeline:
```bash
python update_nci.py
```

This will:
- Crawl sitemap
- Extract content from URLs
- Convert to Markdown
- Update manifest.json
- Process NCIt thesaurus

### Individual Steps

#### 1. Crawl Sitemap Only
```bash
python crawl_sitemap.py --output nci_urls.json
```

#### 2. Extract Content Only
```bash
python extract_content.py --urls nci_urls.json --output extracted_content.json
```

#### 3. Process Content Only
```bash
python process_content.py --input extracted_content.json --output processed_files.json
```

#### 4. Process NCIt Only
```bash
python process_ncit.py
```

### Monthly Updates

Run the automated update script:
```bash
bash update_nci.sh
```

Or manually:
```bash
python update_nci.py --skip-ncit  # NCIt is updated quarterly separately
cd ../../apps/api
npm run kb:ingest
```

## Configuration

Edit `config.yaml` to customize:

- **Target sections**: Which parts of cancer.gov to crawl
- **Rate limiting**: Delay between requests (default: 1.5s)
- **Output directory**: Where to save Markdown files
- **Exclude patterns**: URLs to skip

## Output Structure

```
kb/en/02_nci_core/
├── pdq/                    # PDQ summaries
├── cancer-types/           # Cancer type overviews
├── dictionaries/           # Medical dictionaries
├── treatment/              # Treatment information
├── coping/                 # Support resources
└── ncit/                   # NCIt thesaurus
    ├── ncit-synonyms.json  # Synonym mapping
    └── concepts/           # Individual concept files
```

## NCIt Thesaurus

The NCIt processor extracts:
- Concept IDs (C-codes)
- Preferred terms
- Synonyms
- Definitions
- Hierarchical relationships

The synonym mapping can be used to:
- Expand user queries in RAG retrieval
- Map terms like "bowel cancer" → "colorectal cancer"
- Improve search relevance

**Update Schedule**: NCIt is updated quarterly (run `process_ncit.py --force-download`)

## License & Attribution

- **NCI Content**: Public domain (US government works)
- **NCIt**: CC BY 4.0

All content includes proper attribution in frontmatter and citations.

## Troubleshooting

### Rate Limiting
If you encounter rate limits, increase `rate_limit_delay` in `config.yaml`.

### Large Downloads
NCIt OWL file is ~100MB. First download may take several minutes.

### Content Extraction Errors
Some pages may have unusual HTML structure. Check `extracted_content.json` for errors.

### Memory Issues
For large crawls, process in batches by filtering URLs first.

## Integration

After running the ingestion:

1. **Review** generated Markdown files in `kb/en/02_nci_core/`
2. **Verify** manifest.json has been updated
3. **Ingest** into database:
   ```bash
   cd ../../apps/api
   npm run kb:ingest
   ```
4. **Test** queries to verify content is searchable

## Next Steps

- Set up monthly cron job for automated updates
- Enhance RAG service to use NCIt synonyms for query expansion
- Add incremental update detection (only download changed pages)

