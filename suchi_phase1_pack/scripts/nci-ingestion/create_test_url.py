#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Helper script to create a test URL file for quick testing
"""

import json
import sys
import io

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Some good test URLs from NCI
TEST_URLS = [
    "https://www.cancer.gov/types/breast/hp/breast-treatment-pdq",
    "https://www.cancer.gov/types/lung/patient/non-small-cell-lung-treatment-pdq",
    "https://www.cancer.gov/publications/dictionaries/cancer-terms",
    "https://www.cancer.gov/types/breast",
]

def main():
    output_file = "test_urls.json"
    
    urls_list = [{"url": url} for url in TEST_URLS]
    
    with open(output_file, "w") as f:
        json.dump(urls_list, f, indent=2)
    
    print(f"[OK] Created {output_file} with {len(TEST_URLS)} test URLs")
    print("\nTo extract content from these URLs:")
    print(f"  python extract_content.py --urls {output_file} --output test_extracted.json")

if __name__ == "__main__":
    main()



