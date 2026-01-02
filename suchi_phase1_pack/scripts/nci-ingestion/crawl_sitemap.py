#!/usr/bin/env python3
"""
NCI Sitemap Crawler

Discovers and filters URLs from cancer.gov sitemap for content extraction.
"""

import sys
import time
import requests
import xml.etree.ElementTree as ET
from typing import List, Dict, Set, Tuple
from urllib.parse import urlparse
import yaml

class NCISitemapCrawler:
    def __init__(self, config: Dict):
        self.sitemap_url = config.get("sitemap_url", "https://www.cancer.gov/sitemap.xml")
        self.target_sections = config.get("target_sections", [])
        self.exclude_patterns = config.get("exclude_patterns", [])
        self.rate_limit_delay = config.get("rate_limit_delay", 1.5)
        self.max_sitemap_depth = config.get("max_sitemap_depth", 5)
        self.user_agent = config.get("user_agent", "Suchi Cancer Bot/1.0")
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.user_agent})
        
    def get_sitemap_urls(self, sitemap_url: str) -> Tuple[List[str], List[str]]:
        """
        Fetch URLs from a sitemap or sitemap index.
        Returns tuple: (urls_list, child_sitemaps_list)
        """
        try:
            response = self.session.get(sitemap_url, timeout=30)
            response.raise_for_status()
            xml_content = response.text
        except Exception as e:
            print(f"Error fetching {sitemap_url}: {e}")
            return [], []
        
        root = ET.fromstring(xml_content)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        
        # Check if this is a sitemap index (contains <sitemap> tags)
        sitemaps = root.findall(".//sm:sitemap", ns)
        if sitemaps:
            # This is a sitemap index, return child sitemap URLs
            child_sitemaps = []
            for sitemap_entry in sitemaps:
                loc = sitemap_entry.find("sm:loc", ns)
                if loc is not None:
                    child_sitemaps.append(loc.text.strip())
            return [], child_sitemaps
        
        # This is a regular sitemap, return URLs
        urls = []
        for url_entry in root.findall(".//sm:url", ns):
            loc = url_entry.find("sm:loc", ns)
            if loc is not None:
                urls.append(loc.text.strip())
        
        return urls, []
    
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
    
    def crawl(self, max_depth: int = None) -> List[Dict[str, str]]:
        """
        Recursively crawl sitemap and return filtered URLs with metadata.
        
        Args:
            max_depth: Maximum recursion depth for nested sitemap indexes (defaults to config value)
        """
        if max_depth is None:
            max_depth = self.max_sitemap_depth
        
        print(f"Fetching sitemap index from {self.sitemap_url}...")
        print(f"Max recursion depth: {max_depth}")
        
        # Track visited sitemaps to avoid duplicates
        visited_sitemaps = set()
        all_urls = []
        
        # Queue of (sitemap_url, depth) tuples
        sitemap_queue = [(self.sitemap_url, 0)]
        
        # Recursively expand sitemaps
        while sitemap_queue:
            sitemap_url, depth = sitemap_queue.pop(0)
            
            if sitemap_url in visited_sitemaps:
                continue
            
            if depth > max_depth:
                print(f"  Skipping {sitemap_url} (max depth {max_depth} reached)")
                continue
            
            visited_sitemaps.add(sitemap_url)
            
            try:
                urls, child_sitemaps = self.get_sitemap_urls(sitemap_url)
                
                # Add URLs from this sitemap
                for url in urls:
                    if self.should_include_url(url):
                        all_urls.append({
                            "url": url,
                            "source": "sitemap"
                        })
                
                # If this is a sitemap index, add child sitemaps to queue
                if child_sitemaps:
                    if depth == 0:
                        print(f"Found {len(child_sitemaps)} child sitemaps. Recursively expanding...")
                    else:
                        print(f"  Found {len(child_sitemaps)} nested sitemaps at depth {depth}")
                    
                    for child_sitemap in child_sitemaps:
                        if child_sitemap not in visited_sitemaps:
                            sitemap_queue.append((child_sitemap, depth + 1))
                
                # Rate limiting
                if len(visited_sitemaps) % 10 == 0:
                    print(f"  Processed {len(visited_sitemaps)} sitemaps, found {len(all_urls)} URLs...")
                
                time.sleep(self.rate_limit_delay)
                
            except Exception as e:
                print(f"  Error processing {sitemap_url}: {e}")
                continue
        
        # Remove duplicates
        seen = set()
        unique_urls = []
        for item in all_urls:
            if item["url"] not in seen:
                seen.add(item["url"])
                unique_urls.append(item)
        
        print(f"\n[OK] Found {len(unique_urls)} unique URLs matching target sections")
        print(f"     Processed {len(visited_sitemaps)} sitemaps")
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







