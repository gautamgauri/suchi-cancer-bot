#!/usr/bin/env python3
"""
NCI Ingestion Orchestration Script

Main script that coordinates sitemap crawling, content extraction, processing,
and manifest updates for NCI data ingestion.
"""

import sys
import json
import time
from pathlib import Path
from typing import List, Dict
import yaml

from crawl_sitemap import NCISitemapCrawler
from extract_content import NCIContentExtractor
from process_content import NCIContentProcessor


def update_manifest(processed_files: List[Dict], manifest_path: str, config: Dict):
    """Update manifest.json with new NCI entries"""
    manifest_file = Path(manifest_path)
    
    if manifest_file.exists():
        with open(manifest_file, "r", encoding="utf-8") as f:
            manifest = json.load(f)
    else:
        manifest = {
            "locale": "en",
            "schemaVersion": "2.0",
            "docs": []
        }
    
    # Get existing doc IDs
    existing_ids = {doc["id"] for doc in manifest.get("docs", [])}
    
    added_count = 0
    skipped_count = 0
    
    for item in processed_files:
        if item.get("status") != "success":
            continue
        
        frontmatter = item.get("frontmatter", {})
        url = item.get("url", "")
        title = item.get("title", "Untitled")
        
        # Generate doc ID
        # Extract identifier from URL or title
        doc_id_base = url.replace("https://www.cancer.gov", "").strip("/").replace("/", "_")
        doc_id = f"kb_en_nci_{doc_id_base}_v1"
        # Clean up ID
        doc_id = "".join(c if c.isalnum() or c == "_" else "_" for c in doc_id)
        doc_id = "_".join(filter(None, doc_id.split("_")))
        doc_id = doc_id[:100]  # Limit length
        
        # Check if already exists
        if doc_id in existing_ids:
            skipped_count += 1
            continue
        
        # Create doc entry
        doc_entry = {
            "id": doc_id,
            "title": title,
            "version": frontmatter.get("version", "v1"),
            "status": frontmatter.get("status", "active"),
            "source": frontmatter.get("source", "NCI"),
            "sourceType": frontmatter.get("sourceType", "02_nci_core"),
            "path": item["path"],
            "license": frontmatter.get("license", "public_domain"),
            "lastReviewed": frontmatter.get("lastReviewed"),
            "reviewFrequency": frontmatter.get("reviewFrequency", "quarterly"),
            "audienceLevel": frontmatter.get("audienceLevel", "patient"),
            "language": frontmatter.get("language", "en"),
            "cancerTypes": frontmatter.get("cancerTypes", ["general"]),
            "tags": frontmatter.get("tags", []),
            "url": url,
            "citation": frontmatter.get("citation", f"NCI, {time.strftime('%Y')}")
        }
        
        manifest["docs"].append(doc_entry)
        existing_ids.add(doc_id)
        added_count += 1
    
    # Save updated manifest
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"\n[OK] Manifest updated: {added_count} added, {skipped_count} skipped")
    return added_count


def main():
    import argparse
    from datetime import datetime
    
    parser = argparse.ArgumentParser(description="NCI Content Ingestion Pipeline")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    parser.add_argument("--manifest", default="../../kb/manifest.json", help="Manifest file path")
    parser.add_argument("--skip-sitemap", action="store_true", help="Skip sitemap crawl (use existing URLs)")
    parser.add_argument("--skip-ncit", action="store_true", help="Skip NCIt processing")
    parser.add_argument("--urls-cache", default="nci_urls.json", help="Cache file for URLs")
    parser.add_argument("--extracted-cache", default="extracted_content.json", help="Cache file for extracted content")
    parser.add_argument("--processed-cache", default="processed_files.json", help="Cache file for processed files")
    parser.add_argument("--limit", type=int, help="Limit number of URLs to process (for testing)")
    
    args = parser.parse_args()
    
    # Load config
    try:
        with open(args.config, "r") as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"Error: Config file {args.config} not found")
        sys.exit(1)
    
    print("=" * 60)
    print("NCI Content Ingestion Pipeline")
    print("=" * 60)
    print()
    
    # Step 1: Crawl sitemap
    urls = []
    if not args.skip_sitemap:
        print("Step 1: Crawling NCI sitemap...")
        crawler = NCISitemapCrawler(config)
        urls = crawler.crawl()
        
        # Save URLs cache
        with open(args.urls_cache, "w") as f:
            json.dump(urls, f, indent=2)
        print(f"[OK] Saved {len(urls)} URLs to {args.urls_cache}")
    else:
        # Load from cache
        try:
            with open(args.urls_cache, "r") as f:
                urls = json.load(f)
            print(f"[OK] Loaded {len(urls)} URLs from cache")
        except FileNotFoundError:
            print("Error: URL cache not found. Run without --skip-sitemap first.")
            sys.exit(1)
    
    if not urls:
        print("No URLs to process. Exiting.")
        sys.exit(0)
    
    # Step 2: Extract content
    print("\nStep 2: Extracting content from URLs...")
    extractor = NCIContentExtractor(config)
    extracted_content = []
    
    # Apply limit if specified (for testing only)
    if args.limit:
        urls_to_process = urls[:args.limit]
        print(f"⚠ Processing limited to {args.limit} URLs (of {len(urls)} total) for testing")
    else:
        urls_to_process = urls
        print(f"Processing all {len(urls_to_process)} discovered URLs...")
    
    for i, item in enumerate(urls_to_process, 1):
        url = item.get("url", item) if isinstance(item, dict) else item
        result = extractor.extract(url)
        if result:
            extracted_content.append(result)
        if i % 10 == 0:
            print(f"  Progress: {i}/{len(urls_to_process)}")
    
    # Save extracted content cache
    with open(args.extracted_cache, "w", encoding="utf-8") as f:
        json.dump(extracted_content, f, indent=2, ensure_ascii=False)
    print(f"[OK] Extracted {len(extracted_content)} pages")
    
    # Step 3: Process to Markdown
    print("\nStep 3: Processing content to Markdown...")
    processor = NCIContentProcessor(config)
    processed_files = []
    
    for item in extracted_content:
        try:
            result = processor.process(item)
            result["url"] = item.get("metadata", {}).get("url", "")
            result["title"] = item.get("metadata", {}).get("title", "")
            processed_files.append(result)
        except Exception as e:
            print(f"  [ERROR] Error: {e}")
    
    # Save processed files cache
    with open(args.processed_cache, "w", encoding="utf-8") as f:
        json.dump(processed_files, f, indent=2, ensure_ascii=False)
    print(f"[OK] Processed {len(processed_files)} files")
    
    # Step 4: Update manifest
    print("\nStep 4: Updating manifest.json...")
    added = update_manifest(processed_files, args.manifest, config)
    
    # Step 5: Process NCIt (optional)
    if not args.skip_ncit:
        print("\nStep 5: Processing NCIt Thesaurus...")
        from process_ncit import NCItProcessor
        ncit_processor = NCItProcessor(config)
        ncit_processor.process(force_download=False)
    
    print("\n" + "=" * 60)
    print("[OK] NCI Ingestion Complete!")
    print("=" * 60)
    print(f"  - URLs discovered: {len(urls)}")
    print(f"  - Content extracted: {len(extracted_content)}")
    print(f"  - Files processed: {len(processed_files)}")
    print(f"  - Manifest entries added: {added}")
    print()
    print("Next steps:")
    print("  1. Review generated Markdown files in kb/en/02_nci_core/")
    print("  2. Run KB ingestion: cd ../../apps/api && npm run kb:ingest")


if __name__ == "__main__":
    main()


