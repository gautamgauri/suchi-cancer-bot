#!/usr/bin/env python3
"""
NCI Sitemap Sanity Check Script

Validates what's available in the NCI sitemap vs what was ingested.
Recursively expands all sitemap indexes and provides detailed breakdown.
"""

import sys
import json
import time
import re
import requests
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from urllib.parse import urlparse
from pathlib import Path


ROBOTS_URL = "https://www.cancer.gov/robots.txt"


def get_sitemap_from_robots(robots_url: str) -> str:
    """Extract sitemap URL from robots.txt"""
    try:
        response = requests.get(robots_url, timeout=30)
        response.raise_for_status()
        txt = response.text
        for line in txt.splitlines():
            if line.lower().startswith("sitemap:"):
                return line.split(":", 1)[1].strip()
        raise RuntimeError("No sitemap found in robots.txt")
    except Exception as e:
        print(f"Error fetching robots.txt: {e}")
        # Fallback to known sitemap URL
        return "https://www.cancer.gov/sitemap.xml"


def parse_xml_locs(xml_text: str) -> list[str]:
    """Parse XML and extract all <loc> elements (handles both sitemapindex and urlset)"""
    try:
        root = ET.fromstring(xml_text)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        locs = [e.text.strip() for e in root.findall(".//sm:loc", ns)]
        # Fallback if namespace is omitted
        if not locs:
            locs = [e.text.strip() for e in root.findall(".//loc")]
        return locs
    except Exception as e:
        print(f"Error parsing XML: {e}")
        return []


def fetch_xml(url: str, user_agent: str = "Suchi-RAG-SanityCheck/1.0") -> str:
    """Fetch XML content from URL"""
    try:
        r = requests.get(url, timeout=60, headers={"User-Agent": user_agent})
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return ""


def expand_sitemaps(sitemap_url: str, max_sitemaps: int = 5000, max_depth: int = 5, delay: float = 0.2) -> list[str]:
    """
    Recursively expands sitemap indexes into final URL lists.
    
    Args:
        sitemap_url: Starting sitemap URL
        max_sitemaps: Maximum number of sitemaps to visit
        max_depth: Maximum recursion depth
        delay: Delay between requests (seconds)
    """
    to_visit = [(sitemap_url, 0)]  # (url, depth)
    seen = set()
    final_urls = []
    
    while to_visit and len(seen) < max_sitemaps:
        sm, depth = to_visit.pop(0)
        
        if sm in seen or depth > max_depth:
            continue
        seen.add(sm)
        
        if len(seen) % 50 == 0:
            print(f"  Processed {len(seen)} sitemaps, found {len(final_urls)} URLs...")
        
        xml = fetch_xml(sm)
        if not xml:
            continue
        
        locs = parse_xml_locs(xml)
        if not locs:
            continue
        
        # Heuristic: sitemapindex typically points to other .xml sitemaps
        child_sitemaps = [u for u in locs if u.endswith(".xml") or "sitemap" in u.lower()]
        
        if child_sitemaps and depth < max_depth:
            # Add child sitemaps to visit queue
            for child in child_sitemaps:
                if child not in seen:
                    to_visit.append((child, depth + 1))
        else:
            # urlset: locs are page URLs
            final_urls.extend([u for u in locs if not (u.endswith(".xml") or "sitemap" in u.lower())])
        
        time.sleep(delay)  # Gentle pacing
    
    return sorted(set(final_urls))


def bucket(url: str) -> str:
    """Classify URL into content bucket"""
    path = urlparse(url).path.lower()
    
    if "/publications/pdq" in path:
        return "PDQ"
    if "/publications/dictionaries" in path:
        return "Dictionaries"
    if path.startswith("/types/"):
        return "Cancer types"
    if "/about-cancer/" in path:
        return "About cancer"
    if "/clinicaltrials/" in path or "/clinical-trials/" in path:
        return "Clinical trials"
    if "/coping" in path or "/survivorship" in path:
        return "Coping & Support"
    if "/treatment" in path:
        return "Treatment"
    if "/prevention" in path or "/screening" in path:
        return "Prevention & Screening"
    
    return "Other"


def load_manifest(manifest_path: str) -> dict:
    """Load manifest.json and return dict of URLs by bucket"""
    try:
        manifest_file = Path(manifest_path)
        if not manifest_file.exists():
            return {"docs": [], "urls_by_bucket": defaultdict(list)}
        
        with open(manifest_file, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        
        # Extract NCI URLs and bucket them
        nci_docs = [doc for doc in manifest.get("docs", []) 
                   if doc.get("sourceType") == "02_nci_core" and doc.get("url")]
        
        urls_by_bucket = defaultdict(list)
        for doc in nci_docs:
            url = doc.get("url", "")
            if url:
                b = bucket(url)
                urls_by_bucket[b].append(url)
        
        return {
            "docs": manifest.get("docs", []),
            "nci_docs": nci_docs,
            "urls_by_bucket": dict(urls_by_bucket)
        }
    except Exception as e:
        print(f"Error loading manifest: {e}")
        return {"docs": [], "urls_by_bucket": defaultdict(list)}


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Sanity check NCI sitemap vs ingested content")
    parser.add_argument("--manifest", default="../../kb/manifest.json", 
                       help="Path to manifest.json")
    parser.add_argument("--max-sitemaps", type=int, default=5000,
                       help="Maximum sitemaps to visit")
    parser.add_argument("--max-depth", type=int, default=5,
                       help="Maximum recursion depth")
    parser.add_argument("--delay", type=float, default=0.2,
                       help="Delay between requests (seconds)")
    parser.add_argument("--skip-fetch", action="store_true",
                       help="Skip sitemap fetch (use cached data)")
    parser.add_argument("--cache-file", default="sitemap_sanity_cache.json",
                       help="Cache file for sitemap URLs")
    
    args = parser.parse_args()
    
    print("=" * 70)
    print("NCI Sitemap Sanity Check")
    print("=" * 70)
    print()
    
    # Step 1: Get sitemap URL
    print("Step 1: Getting sitemap URL from robots.txt...")
    sitemap_url = get_sitemap_from_robots(ROBOTS_URL)
    print(f"  Sitemap: {sitemap_url}")
    print()
    
    # Step 2: Expand sitemaps
    urls = []
    if args.skip_fetch:
        print("Step 2: Loading URLs from cache...")
        try:
            with open(args.cache_file, "r") as f:
                cache_data = json.load(f)
                urls = cache_data.get("urls", [])
            print(f"  Loaded {len(urls)} URLs from cache")
        except FileNotFoundError:
            print("  Cache not found. Run without --skip-fetch first.")
            sys.exit(1)
    else:
        print("Step 2: Recursively expanding sitemap indexes...")
        print(f"  Max depth: {args.max_depth}, Max sitemaps: {args.max_sitemaps}")
        print("  This may take several minutes...")
        urls = expand_sitemaps(sitemap_url, args.max_sitemaps, args.max_depth, args.delay)
        
        # Cache results
        with open(args.cache_file, "w") as f:
            json.dump({"urls": urls, "sitemap_url": sitemap_url}, f, indent=2)
        print(f"  Cached {len(urls)} URLs to {args.cache_file}")
    
    print(f"\n  Total unique URLs found via sitemap expansion: {len(urls)}")
    print()
    
    # Step 3: Bucket URLs
    print("Step 3: Classifying URLs by content bucket...")
    counts = Counter(bucket(u) for u in urls)
    
    print("\nBucket counts (from sitemap):")
    print("-" * 70)
    for k, v in counts.most_common():
        print(f"  {k:25s} {v:>6}")
    print()
    
    # Step 4: Load manifest and compare
    print("Step 4: Loading manifest.json and comparing...")
    manifest_data = load_manifest(args.manifest)
    nci_docs = manifest_data.get("nci_docs", [])
    manifest_urls_by_bucket = manifest_data.get("urls_by_bucket", {})
    
    # Get all URLs from sitemap by bucket
    sitemap_urls_by_bucket = defaultdict(list)
    for url in urls:
        b = bucket(url)
        sitemap_urls_by_bucket[b].append(url)
    
    print(f"  NCI documents in manifest: {len(nci_docs)}")
    print()
    
    # Compare buckets
    print("Comparison (Sitemap vs Manifest):")
    print("-" * 70)
    all_buckets = set(counts.keys()) | set(manifest_urls_by_bucket.keys())
    
    for b in sorted(all_buckets):
        sitemap_count = counts.get(b, 0)
        manifest_count = len(manifest_urls_by_bucket.get(b, []))
        diff = sitemap_count - manifest_count
        pct = (manifest_count / sitemap_count * 100) if sitemap_count > 0 else 0
        
        status = "✓" if diff < 10 else "⚠" if diff < sitemap_count * 0.5 else "✗"
        print(f"  {status} {b:25s} Sitemap: {sitemap_count:>6}  Manifest: {manifest_count:>6}  "
              f"Missing: {diff:>6}  ({pct:>5.1f}% ingested)")
    
    print()
    
    # Step 5: Show examples
    print("Step 5: Example URLs by bucket (from sitemap):")
    print("-" * 70)
    
    examples = defaultdict(list)
    for u in urls:
        b = bucket(u)
        if len(examples[b]) < 5:
            examples[b].append(u)
    
    for b in sorted(examples.keys()):
        if examples[b]:
            print(f"\n[{b}]")
            for u in examples[b]:
                print(f"  - {u}")
    
    print()
    
    # Step 6: Identify missing PDQ URLs
    if "PDQ" in sitemap_urls_by_bucket:
        print("Step 6: PDQ URL analysis...")
        sitemap_pdq = set(sitemap_urls_by_bucket["PDQ"])
        manifest_pdq = set(manifest_urls_by_bucket.get("PDQ", []))
        missing_pdq = sitemap_pdq - manifest_pdq
        
        print(f"  PDQ URLs in sitemap: {len(sitemap_pdq)}")
        print(f"  PDQ URLs in manifest: {len(manifest_pdq)}")
        print(f"  Missing PDQ URLs: {len(missing_pdq)}")
        
        if missing_pdq:
            print("\n  Sample missing PDQ URLs:")
            for url in sorted(missing_pdq)[:10]:
                print(f"    - {url}")
            if len(missing_pdq) > 10:
                print(f"    ... and {len(missing_pdq) - 10} more")
    
    print()
    print("=" * 70)
    print("Sanity Check Complete!")
    print("=" * 70)
    
    # Summary recommendations
    total_missing = len(urls) - len(nci_docs)
    if total_missing > 100:
        print(f"\n⚠ WARNING: {total_missing} URLs are missing from manifest!")
        print("  Consider running full ingestion: python update_nci.py")
    else:
        print("\n✓ Ingestion appears complete.")


if __name__ == "__main__":
    main()









