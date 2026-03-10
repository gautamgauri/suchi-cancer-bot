#!/usr/bin/env python3
"""
Convert YouTube transcript JSONs to Suchi KB format.
Reads from: youtube/transcripts/*.json
Outputs to: kb/en/01_suchi_oncotalks/*.md + updates manifest.json
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, List

def sanitize_filename(text: str, max_len: int = 50) -> str:
    """Convert title to safe filename"""
    # Remove special chars, convert to lowercase
    safe = re.sub(r'[^a-z0-9\s-]', '', text.lower())
    safe = re.sub(r'\s+', '-', safe.strip())
    safe = re.sub(r'-+', '-', safe)
    return safe[:max_len].rstrip('-')

def extract_metadata_from_text(text: str, video_id: str) -> Dict:
    """
    Extract cancer types and topics from transcript text.
    You can customize this based on Onco Talks naming/content patterns.
    """
    text_lower = text.lower()

    # Detect cancer types
    cancer_types = []
    cancer_keywords = {
        'breast': 'breast',
        'lung': 'lung',
        'prostate': 'prostate',
        'colorectal': 'colorectal',
        'colon': 'colorectal',
        'pancreatic': 'pancreatic',
        'ovarian': 'ovarian',
        'leukemia': 'leukemia',
        'lymphoma': 'lymphoma',
        'melanoma': 'skin',
    }

    for keyword, cancer_type in cancer_keywords.items():
        if keyword in text_lower and cancer_type not in cancer_types:
            cancer_types.append(cancer_type)

    if not cancer_types:
        cancer_types = ['general']

    # Detect topics/tags
    tags = []
    topic_keywords = {
        'treatment': 'treatment',
        'therapy': 'treatment',
        'chemotherapy': 'chemotherapy',
        'radiation': 'radiation-therapy',
        'surgery': 'surgery',
        'immunotherapy': 'immunotherapy',
        'screening': 'screening',
        'prevention': 'prevention',
        'symptom': 'symptoms',
        'diagnosis': 'diagnosis',
        'nutrition': 'nutrition',
        'side effect': 'side-effects',
        'caregiver': 'caregiver',
        'support': 'support',
    }

    for keyword, tag in topic_keywords.items():
        if keyword in text_lower and tag not in tags:
            tags.append(tag)

    if not tags:
        tags = ['oncology', 'education']

    return {
        'cancer_types': cancer_types,
        'tags': tags
    }

def convert_youtube_transcript(json_path: Path, output_dir: Path, video_metadata: Dict = None) -> Dict:
    """
    Convert a single YouTube transcript JSON to KB markdown format.
    Returns manifest entry.
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    video_id = data['video_id']
    text = data.get('text', '')

    # If no text, reconstruct from segments
    if not text and 'segments' in data:
        text = '\n'.join(s.get('text', '').strip() for s in data['segments'] if s.get('text'))

    # Get video title (you can enhance this with yt-dlp metadata)
    title = video_metadata.get(video_id, {}).get('title', f"Onco Talks Episode - {video_id}")

    # Extract metadata
    metadata = extract_metadata_from_text(text, video_id)

    # Create markdown filename
    filename = f"{sanitize_filename(title)}-{video_id}.md"
    md_path = output_dir / filename

    # Create markdown content with frontmatter
    md_content = f"""---
title: "{title}"
version: "v1"
status: "active"
source: "Suchi Cancer Care Foundation - Onco Talks"
video_id: "{video_id}"
---

# {title}

**Source**: Onco Talks YouTube Channel
**Video URL**: https://www.youtube.com/watch?v={video_id}
**Language**: {data.get('selected_language', 'en')}
**Transcript Type**: {"Auto-generated" if data.get('is_generated') else "Manual"}

## Transcript

{text}

---
*This transcript is from the Onco Talks YouTube channel by Suchi Cancer Care Foundation.*
"""

    # Write markdown file
    md_path.write_text(md_content, encoding='utf-8')

    # Create manifest entry
    manifest_entry = {
        "id": f"kb_en_oncotalks_{video_id}_v1",
        "title": title,
        "version": "v1",
        "status": "active",
        "source": "Suchi Cancer Care Foundation - Onco Talks",
        "sourceType": "01_suchi_oncotalks",
        "path": f"en/01_suchi_oncotalks/{filename}",
        "license": "sccf_owned",
        "lastReviewed": datetime.now().strftime("%Y-%m-%d"),
        "reviewFrequency": "annual",
        "audienceLevel": "patient",
        "language": "en",
        "cancerTypes": metadata['cancer_types'],
        "tags": metadata['tags'],
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "citation": f"Onco Talks, SCCF, Video ID: {video_id}"
    }

    return manifest_entry

def main():
    # Paths
    youtube_dir = Path("../youtube")  # Adjust to your Colab output location
    transcripts_dir = youtube_dir / "transcripts"
    kb_root = Path("../kb")
    output_dir = kb_root / "en" / "01_suchi_oncotalks"
    manifest_path = kb_root / "manifest.json"

    output_dir.mkdir(parents=True, exist_ok=True)

    # Optional: Load video metadata (title, etc.) from yt-dlp if available
    video_metadata = {}

    # Read existing manifest
    if manifest_path.exists():
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    else:
        manifest = {"locale": "en", "schemaVersion": "2.0", "docs": []}

    # Get existing video IDs to avoid duplicates
    existing_ids = {doc['id'] for doc in manifest['docs']}

    # Process all transcript JSONs
    new_entries = []
    for json_path in sorted(transcripts_dir.glob("*.json")):
        video_id = json_path.stem
        doc_id = f"kb_en_oncotalks_{video_id}_v1"

        # Skip if already in manifest
        if doc_id in existing_ids:
            print(f"SKIP (already exists): {video_id}")
            continue

        try:
            entry = convert_youtube_transcript(json_path, output_dir, video_metadata)
            new_entries.append(entry)
            print(f"OK: {video_id} -> {entry['path']}")
        except Exception as e:
            print(f"ERROR: {video_id}: {e}")

    # Add new entries to manifest
    if new_entries:
        manifest['docs'].extend(new_entries)

        # Write updated manifest
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

        print(f"\nAdded {len(new_entries)} new Onco Talks episodes to manifest")
        print(f"Total docs in manifest: {len(manifest['docs'])}")
    else:
        print("\nNo new transcripts to add")

if __name__ == "__main__":
    main()
