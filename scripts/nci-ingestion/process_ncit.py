#!/usr/bin/env python3
"""
NCIt Thesaurus Processor

Downloads and parses NCI Thesaurus (NCIt) OWL file to extract concepts,
synonyms, and create mapping dictionaries.
"""

import sys
import json
import re
from pathlib import Path
from typing import Dict, List, Set
from datetime import datetime
import requests
from rdflib import Graph, Namespace, RDFS, SKOS, URIRef
import yaml

# RDF Namespaces
RDF = Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#")
RDFS = Namespace("http://www.w3.org/2000/01/rdf-schema#")
SKOS = Namespace("http://www.w3.org/2004/02/skos/core#")
NCIT = Namespace("http://ncicb.nci.nih.gov/xml/owl/EVS/Thesaurus.owl#")


class NCItProcessor:
    def __init__(self, config: Dict):
        self.ncit_url = config.get("ncit_url", "https://evs.nci.nih.gov/ftp1/rdf/Thesaurus.owl")
        self.output_dir = Path(config.get("output_dir", "../../kb/en/02_nci_core"))
        self.ncit_dir = self.output_dir / "ncit"
        self.ncit_dir.mkdir(parents=True, exist_ok=True)
        self.concepts_dir = self.ncit_dir / "concepts"
        self.concepts_dir.mkdir(parents=True, exist_ok=True)
        
    def download_ncit(self, output_path: Path) -> bool:
        """Download NCIt OWL file"""
        print(f"Downloading NCIt from {self.ncit_url}...")
        try:
            response = requests.get(self.ncit_url, timeout=300, stream=True)
            response.raise_for_status()
            
            with open(output_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            print(f"[OK] Downloaded {output_path.stat().st_size / (1024*1024):.1f} MB")
            return True
        except Exception as e:
            print(f"[ERROR] Error downloading NCIt: {e}")
            return False
    
    def extract_concept_id(self, uri: URIRef) -> str:
        """Extract concept ID from URI (e.g., C4872)"""
        uri_str = str(uri)
        # Pattern: .../C12345 or ...#C12345
        match = re.search(r'[#/](C\d+)', uri_str)
        return match.group(1) if match else None
    
    def parse_owl(self, owl_path: Path) -> Dict[str, Dict]:
        """Parse OWL file and extract concepts"""
        print("Parsing NCIt OWL file...")
        
        g = Graph()
        try:
            g.parse(str(owl_path), format="xml")
        except Exception as e:
            print(f"[ERROR] Error parsing OWL: {e}")
            return {}
        
        concepts = {}
        
        # Find all classes (concepts)
        for concept_uri, _, _ in g.triples((None, RDF.type, RDFS.Class)):
            concept_id = self.extract_concept_id(concept_uri)
            if not concept_id:
                continue
            
            # Get preferred label
            preferred = None
            for _, _, label in g.triples((concept_uri, RDFS.label, None)):
                if preferred is None:  # Take first label as preferred
                    preferred = str(label)
                    break
            
            if not preferred:
                continue
            
            # Get synonyms (alternative labels)
            synonyms = []
            for _, _, alt_label in g.triples((concept_uri, SKOS.altLabel, None)):
                synonyms.append(str(alt_label))
            
            # Also check RDFS.label for additional terms
            label_count = 0
            for _, _, label in g.triples((concept_uri, RDFS.label, None)):
                if label_count > 0:  # Skip first (preferred)
                    label_str = str(label)
                    if label_str not in synonyms and label_str != preferred:
                        synonyms.append(label_str)
                label_count += 1
            
            # Get definition
            definition = None
            for _, _, comment in g.triples((concept_uri, RDFS.comment, None)):
                definition = str(comment)
                break
            
            # Get parent concepts (hierarchy)
            parents = []
            for _, _, parent in g.triples((concept_uri, RDFS.subClassOf, None)):
                parent_id = self.extract_concept_id(parent)
                if parent_id:
                    parents.append(parent_id)
            
            concepts[concept_id] = {
                "preferred": preferred,
                "synonyms": list(set(synonyms)),  # Remove duplicates
                "definition": definition,
                "parents": parents,
                "uri": str(concept_uri)
            }
        
        print(f"[OK] Extracted {len(concepts)} concepts")
        return concepts
    
    def save_synonym_mapping(self, concepts: Dict) -> Path:
        """Save synonym mapping as JSON"""
        mapping = {}
        for concept_id, data in concepts.items():
            mapping[concept_id] = {
                "preferred": data["preferred"],
                "synonyms": data["synonyms"]
            }
        
        output_path = self.ncit_dir / "ncit-synonyms.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(mapping, f, indent=2, ensure_ascii=False)
        
        print(f"[OK] Saved synonym mapping: {output_path}")
        return output_path
    
    def save_concept_files(self, concepts: Dict):
        """Save individual concept files as Markdown"""
        saved = 0
        for concept_id, data in concepts.items():
            # Skip concepts without preferred term
            if not data.get("preferred"):
                continue
            
            # Create Markdown file
            filename = f"{concept_id}-{data['preferred'].lower().replace(' ', '-').replace('/', '-')[:50]}.md"
            filename = re.sub(r"[^\w\-_]", "-", filename)
            filename = re.sub(r"-+", "-", filename)
            filepath = self.concepts_dir / filename
            
            # Create frontmatter
            frontmatter = {
                "title": data["preferred"],
                "concept_id": concept_id,
                "source": "NCI Thesaurus",
                "sourceType": "02_nci_core",
                "license": "cc_by",
                "url": data.get("uri", ""),
                "version": "v1",
                "status": "active",
                "lastReviewed": datetime.utcnow().date().isoformat(),
                "reviewFrequency": "quarterly",
                "language": "en",
                "tags": ["ncit", "thesaurus", "concept"],
                "citation": f"NCIt {concept_id}, {datetime.utcnow().year}"
            }
            
            frontmatter_yaml = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
            
            # Create content
            content_parts = [f"# {data['preferred']}\n"]
            content_parts.append(f"**Concept ID:** {concept_id}\n")
            
            if data.get("synonyms"):
                content_parts.append("\n## Synonyms\n\n")
                for synonym in data["synonyms"]:
                    content_parts.append(f"- {synonym}\n")
            
            if data.get("definition"):
                content_parts.append("\n## Definition\n\n")
                content_parts.append(f"{data['definition']}\n")
            
            if data.get("parents"):
                content_parts.append("\n## Parent Concepts\n\n")
                for parent_id in data["parents"]:
                    content_parts.append(f"- {parent_id}\n")
            
            content = "---\n" + frontmatter_yaml + "---\n\n" + "".join(content_parts)
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            
            saved += 1
        
        print(f"[OK] Saved {saved} concept files")
    
    def process(self, force_download: bool = False):
        """Main processing function"""
        owl_path = self.ncit_dir / "Thesaurus.owl"
        
        # Download if needed
        if force_download or not owl_path.exists():
            if not self.download_ncit(owl_path):
                return False
        else:
            print(f"Using existing OWL file: {owl_path}")
        
        # Parse OWL
        concepts = self.parse_owl(owl_path)
        if not concepts:
            print("No concepts extracted. Exiting.")
            return False
        
        # Save synonym mapping
        self.save_synonym_mapping(concepts)
        
        # Save concept files (optional - can be large)
        # Uncomment if you want individual concept files
        # self.save_concept_files(concepts)
        
        print(f"\n[OK] NCIt processing complete: {len(concepts)} concepts")
        return True


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Process NCIt Thesaurus")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    parser.add_argument("--force-download", action="store_true", help="Force re-download of OWL file")
    
    args = parser.parse_args()
    
    # Load config
    try:
        with open(args.config, "r") as f:
            config = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(f"Error: Config file {args.config} not found")
        sys.exit(1)
    
    # Process NCIt
    processor = NCItProcessor(config)
    success = processor.process(force_download=args.force_download)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()























