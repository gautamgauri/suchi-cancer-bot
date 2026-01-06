#!/usr/bin/env python3
"""
NCI Content Processor

Converts extracted HTML content to clean Markdown format with frontmatter
for KB ingestion.
"""

import sys
import json
import re
from pathlib import Path
from typing import Dict, List
from datetime import datetime
from markdownify import markdownify as md
import yaml


class NCIContentProcessor:
    def __init__(self, config: Dict):
        self.output_dir = Path(config.get("output_dir", "../../kb/en/02_nci_core"))
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
    def clean_markdown(self, markdown: str) -> str:
        """Clean and normalize markdown content"""
        # Remove excessive whitespace
        lines = markdown.split("\n")
        cleaned_lines = []
        prev_empty = False
        
        for line in lines:
            line = line.strip()
            if not line:
                if not prev_empty:
                    cleaned_lines.append("")
                    prev_empty = True
                continue
            
            prev_empty = False
            cleaned_lines.append(line)
        
        # Remove trailing whitespace
        while cleaned_lines and not cleaned_lines[-1]:
            cleaned_lines.pop()
        
        return "\n".join(cleaned_lines)
    
    def generate_filename(self, url: str, title: str) -> str:
        """Generate safe filename from URL and title"""
        # Extract meaningful part from URL
        url_path = url.replace("https://www.cancer.gov", "").strip("/")
        
        # Replace slashes with dashes
        filename = url_path.replace("/", "-")
        
        # Remove query strings and fragments
        filename = filename.split("?")[0].split("#")[0]
        
        # Clean up
        filename = re.sub(r"[^\w\-_]", "-", filename)
        filename = re.sub(r"-+", "-", filename)
        filename = filename.strip("-")
        
        # Add extension
        if not filename.endswith(".md"):
            filename += ".md"
        
        return filename
    
    def determine_subfolder(self, url: str, tags: List[str]) -> str:
        """Determine subfolder based on URL and tags"""
        if "/pdq" in url or "pdq" in tags:
            return "pdq"
        elif "/types/" in url:
            return "cancer-types"
        elif "/dictionaries" in url or "dictionary" in tags:
            return "dictionaries"
        elif "/treatment" in url:
            return "treatment"
        elif "/coping" in url:
            return "coping"
        else:
            return "general"
    
    def create_frontmatter(self, data: Dict) -> Dict:
        """Create frontmatter metadata"""
        metadata = data.get("metadata", {})
        url = metadata.get("url", "")
        title = metadata.get("title", "Untitled")
        
        frontmatter = {
            "title": title,
            "source": "NCI",
            "sourceType": "02_nci_core",
            "license": "public_domain",
            "url": url,
            "version": "v1",
            "status": "active",
            "reviewFrequency": "quarterly",
            "audienceLevel": "patient",
            "language": "en"
        }
        
        # Add dates if available
        if metadata.get("published_at"):
            frontmatter["published_at"] = metadata["published_at"]
        if metadata.get("lastReviewed"):
            frontmatter["lastReviewed"] = metadata["lastReviewed"]
        else:
            # Default to today if no review date
            frontmatter["lastReviewed"] = datetime.utcnow().date().isoformat()
        
        # Add cancer types
        cancer_types = data.get("cancer_types", [])
        if cancer_types:
            frontmatter["cancerTypes"] = cancer_types
        else:
            frontmatter["cancerTypes"] = ["general"]
        
        # Add tags
        tags = data.get("tags", [])
        if tags:
            frontmatter["tags"] = tags
        
        # Citation
        frontmatter["citation"] = f"NCI, {datetime.utcnow().year}"
        
        return frontmatter
    
    def process(self, data: Dict) -> Dict:
        """Process extracted content into Markdown file"""
        metadata = data.get("metadata", {})
        url = metadata.get("url", "")
        title = metadata.get("title", "Untitled")
        html_content = data.get("html", "")
        
        # Convert HTML to Markdown
        markdown_content = md(
            html_content,
            heading_style="ATX",
            bullets="-",
            strip=["script", "style"]
        )
        
        # Clean markdown
        markdown_content = self.clean_markdown(markdown_content)
        
        # Create frontmatter
        frontmatter = self.create_frontmatter(data)
        
        # Generate filename and path
        filename = self.generate_filename(url, title)
        subfolder = self.determine_subfolder(url, data.get("tags", []))
        
        output_folder = self.output_dir / subfolder
        output_folder.mkdir(parents=True, exist_ok=True)
        
        output_path = output_folder / filename
        
        # Format frontmatter as YAML
        frontmatter_yaml = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
        
        # Combine into final Markdown
        final_markdown = f"---\n{frontmatter_yaml}---\n\n# {title}\n\n{markdown_content}\n"
        
        # Write file
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(final_markdown)
        
        # Return relative path for manifest
        relative_path = f"en/02_nci_core/{subfolder}/{filename}"
        
        return {
            "path": relative_path,
            "filename": filename,
            "frontmatter": frontmatter,
            "status": "success"
        }


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Process extracted NCI content to Markdown")
    parser.add_argument("--input", required=True, help="JSON file with extracted content")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    parser.add_argument("--output", help="Output JSON with processed file info")
    
    args = parser.parse_args()
    
    # Load config
    try:
        with open(args.config, "r") as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"Error: Config file {args.config} not found")
        sys.exit(1)
    
    # Load extracted content
    try:
        with open(args.input, "r", encoding="utf-8") as f:
            extracted_data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Input file {args.input} not found")
        sys.exit(1)
    
    # Process content
    processor = NCIContentProcessor(config)
    results = []
    
    print(f"Processing {len(extracted_data)} content items...")
    for i, item in enumerate(extracted_data, 1):
        try:
            result = processor.process(item)
            results.append({
                **result,
                "url": item.get("metadata", {}).get("url", ""),
                "title": item.get("metadata", {}).get("title", "")
            })
            print(f"  [OK] {i}/{len(extracted_data)}: {result['filename']}")
        except Exception as e:
            print(f"  [ERROR] Error processing item {i}: {e}")
    
    # Save results
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n[OK] Processed {len(results)}/{len(extracted_data)} items")
    if args.output:
        print(f"[OK] Saved results to {args.output}")


if __name__ == "__main__":
    main()















