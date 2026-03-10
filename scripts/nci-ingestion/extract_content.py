#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NCI Content Extractor

Downloads HTML pages from cancer.gov and extracts main content and metadata.
"""

import sys
import io
import time

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import re
import json
from datetime import datetime
from typing import Dict, Optional
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup
import yaml


class NCIContentExtractor:
    def __init__(self, config: Dict):
        self.rate_limit_delay = config.get("rate_limit_delay", 1.5)
        self.user_agent = config.get("user_agent", "Suchi Cancer Bot/1.0")
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": self.user_agent})
        
    def extract_metadata(self, soup: BeautifulSoup, url: str) -> Dict:
        """Extract metadata from HTML page"""
        metadata = {
            "url": url,
            "title": "",
            "published_at": None,
            "lastReviewed": None,
            "description": ""
        }
        
        # Title
        title_tag = soup.find("title")
        if title_tag:
            metadata["title"] = title_tag.get_text().strip()
        else:
            h1 = soup.find("h1")
            if h1:
                metadata["title"] = h1.get_text().strip()
        
        # Meta description
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc:
            metadata["description"] = meta_desc.get("content", "").strip()
        
        # Publication/Review dates
        # Look for common patterns in NCI pages
        page_text = soup.get_text()
        
        # Pattern: "Reviewed: Month Day, Year" or "Last Modified: ..."
        reviewed_pattern = r"(?:Reviewed|Last\s+[Rr]eviewed|Last\s+[Mm]odified)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})"
        match = re.search(reviewed_pattern, page_text)
        if match:
            try:
                date_str = match.group(1)
                metadata["lastReviewed"] = self.parse_date(date_str)
            except:
                pass
        
        # Pattern: "Published: ..."
        published_pattern = r"Published[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})"
        match = re.search(published_pattern, page_text)
        if match:
            try:
                date_str = match.group(1)
                metadata["published_at"] = self.parse_date(date_str)
            except:
                pass
        
        # Structured data (JSON-LD)
        json_ld = soup.find("script", type="application/ld+json")
        if json_ld:
            try:
                data = json.loads(json_ld.string)
                if isinstance(data, dict):
                    if "datePublished" in data:
                        metadata["published_at"] = self.parse_date(data["datePublished"])
                    if "dateModified" in data:
                        metadata["lastReviewed"] = self.parse_date(data["dateModified"])
            except:
                pass
        
        return metadata
    
    def parse_date(self, date_str: str) -> Optional[str]:
        """Parse date string to ISO format"""
        try:
            # Try common formats
            formats = [
                "%B %d, %Y",
                "%B %d %Y",
                "%b %d, %Y",
                "%b %d %Y",
                "%Y-%m-%d",
                "%m/%d/%Y"
            ]
            
            for fmt in formats:
                try:
                    dt = datetime.strptime(date_str.strip(), fmt)
                    return dt.date().isoformat()
                except:
                    continue
        except:
            pass
        return None
    
    def extract_main_content(self, soup: BeautifulSoup) -> str:
        """Extract main content area from HTML"""
        # Try multiple selectors for main content
        selectors = [
            "main",
            "#main-content",
            ".main-content",
            "[role='main']",
            ".content-main",
            ".article-content",
            "article"
        ]
        
        main_content = None
        for selector in selectors:
            main_content = soup.select_one(selector)
            if main_content:
                break
        
        # Fallback to body if no main content found
        if not main_content:
            main_content = soup.find("body")
        
        if not main_content:
            return ""
        
        # Remove unwanted elements
        for element in main_content.find_all(["nav", "header", "footer", "aside", "script", "style"]):
            element.decompose()
        
        # Remove common NCI page elements
        for class_name in ["breadcrumb", "site-header", "site-footer", "sidebar", "related-content"]:
            for element in main_content.find_all(class_=class_name):
                element.decompose()
        
        return main_content
    
    def extract_cancer_types(self, url: str, content: str) -> list:
        """Extract cancer type tags from URL and content"""
        cancer_types = []
        
        # Extract from URL patterns like /types/breast/...
        url_match = re.search(r"/types/([^/]+)", url)
        if url_match:
            cancer_type = url_match.group(1).replace("-", " ")
            cancer_types.append(cancer_type)
        
        # Common cancer types to look for in content
        common_types = [
            "breast", "lung", "colorectal", "prostate", "skin",
            "pancreatic", "liver", "kidney", "bladder", "ovarian"
        ]
        
        content_lower = content.lower()
        for ct in common_types:
            if ct in content_lower and ct not in [t.lower() for t in cancer_types]:
                cancer_types.append(ct)
        
        return cancer_types
    
    def extract_tags(self, url: str, title: str) -> list:
        """Extract tags based on URL and title"""
        tags = []
        
        # PDQ tag
        if "/pdq" in url or "PDQ" in title:
            tags.append("pdq")
        
        # Treatment tag
        if "/treatment" in url or "treatment" in title.lower():
            tags.append("treatment")
        
        # Dictionary tag
        if "/dictionaries" in url or "dictionary" in title.lower():
            tags.append("dictionary")
        
        # Cancer type tags
        if "/types/" in url:
            tags.append("cancer-type")
        
        # Support/coping
        if "/coping" in url or "support" in title.lower():
            tags.append("support")
        
        return tags
    
    def extract(self, url: str) -> Optional[Dict]:
        """Extract content and metadata from a single URL"""
        try:
            print(f"  Extracting: {url}")
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            
            # Parse HTML
            soup = BeautifulSoup(response.text, "lxml")
            
            # Extract metadata
            metadata = self.extract_metadata(soup, url)
            
            # Extract main content
            main_content = self.extract_main_content(soup)
            content_html = str(main_content) if main_content else ""
            
            # Extract cancer types and tags
            content_text = main_content.get_text() if main_content else ""
            cancer_types = self.extract_cancer_types(url, content_text)
            tags = self.extract_tags(url, metadata["title"])
            
            return {
                "url": url,
                "html": content_html,
                "text": content_text,
                "metadata": metadata,
                "cancer_types": cancer_types,
                "tags": tags
            }
            
        except Exception as e:
            print(f"  [ERROR] Error extracting {url}: {e}")
            return None


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Extract content from NCI URLs")
    parser.add_argument("--urls", required=True, help="JSON file with URLs to extract")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    parser.add_argument("--output", default="extracted_content.json", help="Output file")
    
    args = parser.parse_args()
    
    # Load config
    try:
        with open(args.config, "r") as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"Error: Config file {args.config} not found")
        sys.exit(1)
    
    # Load URLs
    try:
        with open(args.urls, "r") as f:
            url_list = json.load(f)
    except FileNotFoundError:
        print(f"Error: URL file {args.urls} not found")
        sys.exit(1)
    
    # Extract content
    extractor = NCIContentExtractor(config)
    results = []
    
    print(f"Extracting content from {len(url_list)} URLs...")
    for i, item in enumerate(url_list, 1):
        url = item.get("url", item) if isinstance(item, dict) else item
        result = extractor.extract(url)
        if result:
            results.append(result)
        
        # Rate limiting
        if i < len(url_list):
            time.sleep(config.get("rate_limit_delay", 1.5))
    
    # Save results
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n[OK] Extracted {len(results)}/{len(url_list)} pages")
    print(f"[OK] Saved to {args.output}")


if __name__ == "__main__":
    main()



