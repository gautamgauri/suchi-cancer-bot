#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Quick Setup Test Script

Tests that all dependencies are installed and basic functionality works.
"""

import sys
import io

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def test_imports():
    """Test that all required packages can be imported"""
    print("Testing Python package imports...")
    
    packages = {
        "requests": "requests",
        "beautifulsoup4": "bs4",
        "lxml": "lxml",
        "rdflib": "rdflib",
        "yaml": "yaml",
        "dotenv": "dotenv",
        "markdownify": "markdownify"
    }
    
    failed = []
    for package_name, import_name in packages.items():
        try:
            __import__(import_name)
            print(f"  ✓ {package_name}")
        except ImportError:
            print(f"  ✗ {package_name} - NOT INSTALLED")
            failed.append(package_name)
    
    if failed:
        print(f"\n❌ Missing packages: {', '.join(failed)}")
        print("Run: pip install -r requirements.txt")
        return False
    
    print("\n✓ All packages installed successfully!")
    return True

def test_config():
    """Test that config file exists and is valid"""
    print("\nTesting configuration...")
    
    try:
        import yaml
        with open("config.yaml", "r") as f:
            config = yaml.safe_load(f)
        
        required_keys = ["sitemap_url", "target_sections", "output_dir"]
        missing = [key for key in required_keys if key not in config]
        
        if missing:
            print(f"  ✗ Missing config keys: {', '.join(missing)}")
            return False
        
        print("  ✓ Config file is valid")
        print(f"  ✓ Target sections: {len(config.get('target_sections', []))}")
        return True
    except FileNotFoundError:
        print("  ✗ config.yaml not found")
        return False
    except Exception as e:
        print(f"  ✗ Error reading config: {e}")
        return False

def test_url_access():
    """Test that we can access NCI sitemap"""
    print("\nTesting NCI sitemap access...")
    
    try:
        import requests
        response = requests.get("https://www.cancer.gov/sitemap.xml", timeout=10)
        response.raise_for_status()
        print(f"  ✓ Sitemap accessible (status: {response.status_code})")
        return True
    except Exception as e:
        print(f"  ✗ Cannot access sitemap: {e}")
        print("  (Check internet connection)")
        return False

def test_output_directory():
    """Test that output directory can be created"""
    print("\nTesting output directory...")
    
    try:
        from pathlib import Path
        import yaml
        
        with open("config.yaml", "r") as f:
            config = yaml.safe_load(f)
        
        output_dir = Path(config.get("output_dir", "../../kb/en/02_nci_core"))
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Try to write a test file
        test_file = output_dir / ".test_write"
        test_file.write_text("test")
        test_file.unlink()
        
        print(f"  ✓ Output directory writable: {output_dir}")
        return True
    except Exception as e:
        print(f"  ✗ Cannot write to output directory: {e}")
        return False

def main():
    print("=" * 60)
    print("NCI Ingestion Setup Test")
    print("=" * 60)
    print()
    
    results = []
    results.append(("Package Imports", test_imports()))
    results.append(("Configuration", test_config()))
    results.append(("URL Access", test_url_access()))
    results.append(("Output Directory", test_output_directory()))
    
    print("\n" + "=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    
    all_passed = True
    for test_name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}: {test_name}")
        if not passed:
            all_passed = False
    
    print()
    if all_passed:
        print("✅ All tests passed! You're ready to run the ingestion pipeline.")
        print("\nNext steps:")
        print("  1. Test with single URL: python extract_content.py --urls test_url.json")
        print("  2. Run limited pipeline: python update_nci.py --limit 5")
        print("  3. Run full pipeline: python update_nci.py --skip-ncit")
    else:
        print("❌ Some tests failed. Please fix the issues above before proceeding.")
        sys.exit(1)

if __name__ == "__main__":
    main()


