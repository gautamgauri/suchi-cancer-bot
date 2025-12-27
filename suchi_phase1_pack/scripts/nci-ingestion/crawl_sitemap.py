#!/usr/bin/env python3
"""
NCI Sitemap Crawler

Discovers and filters URLs from cancer.gov sitemap for content extraction.
"""

import sys
import time
import requests
import xml.etree.ElementTree as ET
from typing import List, Dict, Set
from urllib.parse import urlparse
import yaml

class NCISitemapCrawler:
    def __init__(self, config: Dict):
        self.sitemap_url = config.get("sitemap_url", "https://www.cancer.gov/sitemap.xml")
        self.target_sections = config.get("target_sections", [])
        self.exclude_patterns = config.get("exclude_patterns", [])
        self.rate_limit_delay = config.get("rate_limit_delay", 1.5)
        self.user_agent = config.get("user_agent", "Suchi Cancer Bot/1.0")
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.user_agent})
        
    def get_sitemap_urls(self, sitemap_url: str) -> List[str]:
        """Fetch URLs from a sitemap or sitemap index"""
        try:
            response = self.session.get(sitemap_url, timeout=30)
            response.raise_for_status()
            xml_content = response.text
        except Exception as e:
            print(f"Error fetching {sitemap_url}: {e}")
            return []
        
        root = ET.fromstring(xml_content)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        
        # Check if this is a sitemap index (contains <sitemap> tags)
        sitemaps = root.findall(".//sm:sitemap", ns)
        if sitemaps:
            # This is a sitemap index, return child sitemap URLs
            return [loc.find("sm:loc", ns).text.strip() for loc in sitemaps if loc.find("sm:loc", ns) is not None]
        
        # This is a regular sitemap, return URLs
        urls = []
        for url_entry in root.findall(".//sm:url", ns):
            loc = url_entry.find("sm:loc", ns)
            if loc is not None:
                urls.append(loc.text.strip())
        
        return urls
    
    def should_include_url(self, url: str) -> bool:
        """Check if URL should be included based on target sections and exclude patterns"""
        # Check exclude patterns
        for pattern in self.exclude_patterns:
            if pattern in url:
                return False
        
        # Check if URL matches any target section
        if not self.target_sections:
            return True  # Include all if no filters specified
        
        for section in self.target_sections:
            if section in url:
                return True
        
        return False
    
    def crawl(self) -> List[Dict[str, str]]:
        """Crawl sitemap and return filtered URLs with metadata"""
        print(f"Fetching sitemap index from {self.sitemap_url}...")
        
        # Get sitemap index
        child_sitemaps = self.get_sitemap_urls(self.sitemap_url)
        
        if not child_sitemaps:
            print("No child sitemaps found. Treating as single sitemap.")
            # Try as single sitemap
            urls = self.get_sitemap_urls(self.sitemap_url)
            child_sitemaps = [] if urls else []
        
        all_urls = []
        
        # Expand child sitemaps
        if child_sitemaps:
            print(f"Found {len(child_sitemaps)} child sitemaps. Expanding...")
            for i, sitemap_url in enumerate(child_sitemaps, 1):
                print(f"  Processing sitemap {i}/{len(child_sitemaps)}: {sitemap_url}")
                urls = self.get_sitemap_urls(sitemap_url)
                
                for url in urls:
                    if self.should_include_url(url):
                        all_urls.append({
                            "url": url,
                            "source": "sitemap"
                        })
                
                # Rate limiting
                if i < len(child_sitemaps):
                    time.sleep(self.rate_limit_delay)
        else:
            # Single sitemap
            urls = self.get_sitemap_urls(self.sitemap_url)
            for url in urls:
                if self.should_include_url(url):
                    all_urls.append({
                        "url": url,
                        "source": "sitemap"
                    })
        
        # Remove duplicates
        seen = set()
        unique_urls = []
        for item in all_urls:
            if item["url"] not in seen:
                seen.add(item["url"])
                unique_urls.append(item)
        
        print(f"\n[OK] Found {len(unique_urls)} unique URLs matching target sections")
        return unique_urls


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Crawl NCI sitemap and extract target URLs")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    parser.add_argument("--output", help="Output file for URLs (JSON)")
    
    args = parser.parse_args()
    
    # Load config
    try:
        with open(args.config, "r") as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"Error: Config file {args.config} not found")
        sys.exit(1)
    
    # Crawl sitemap
    crawler = NCISitemapCrawler(config)
    urls = crawler.crawl()
    
    # Output results
    if args.output:
        import json
        with open(args.output, "w") as f:
            json.dump(urls, f, indent=2)
        print(f"\n[OK] Saved URLs to {args.output}")
    else:
        print("\nSample URLs:")
        for item in urls[:10]:
            print(f"  - {item['url']}")
        if len(urls) > 10:
            print(f"  ... and {len(urls) - 10} more")


if __name__ == "__main__":
    main()



