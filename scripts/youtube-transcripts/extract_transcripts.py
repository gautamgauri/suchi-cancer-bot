#!/usr/bin/env python3
"""
YouTube Transcript Extraction Script for Suchi Cancer Bot

Extracts transcripts from Suchitra Cancer Care Foundation YouTube channel
and converts them to Markdown format for KB ingestion.
"""

import os
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
import yaml
from dotenv import load_dotenv

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter
except ImportError:
    print("Error: youtube-transcript-api not installed. Run: pip install youtube-transcript-api")
    sys.exit(1)

# Load environment variables
load_dotenv()

# Minimum usable transcript length in characters (~30s of speech at the measured
# ~763 chars/minute density of this channel). Below this there is nothing to
# ingest and writing a KB file would only corrupt the manifest. See issue #91.
MIN_TRANSCRIPT_CHARS = 400


class YouTubeTranscriptExtractor:
    def __init__(self, config_path: str = "config.yaml"):
        """Initialize extractor with configuration"""
        self.config = self.load_config(config_path)
        self.output_dir = Path(self.config.get("output_dir", "./output"))
        # Root of the kb/ checkout. The per-language folder is chosen from the
        # transcript's ACTUAL caption language at write time (see kb_dir_for) —
        # the old code hardcoded kb/en/ and so filed Hindi transcripts, which is
        # most of this channel, under English.
        self.kb_root = Path(self.config.get("kb_root", "../../kb"))
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def kb_dir_for(self, language: str) -> Path:
        """Output folder for a transcript in `language`."""
        lang = language if language in ("hi", "en") else "en"
        target = self.kb_root / lang / "01_suchi_oncotalks"
        target.mkdir(parents=True, exist_ok=True)
        return target
        
    def load_config(self, config_path: str) -> Dict:
        """Load configuration from YAML file"""
        try:
            with open(config_path, "r") as f:
                return yaml.safe_load(f) or {}
        except FileNotFoundError:
            print(f"Warning: Config file {config_path} not found. Using defaults.")
            return {}
    
    def get_video_ids_from_channel(self, channel_id: str) -> List[str]:
        """
        Get all video IDs from a YouTube channel.
        
        Note: This requires YouTube Data API v3 or yt-dlp.
        For now, we'll use a manual list or playlist approach.
        """
        # Option 1: Use YouTube Data API (requires API key)
        # Option 2: Use yt-dlp to scrape channel
        # Option 3: Manual list (for initial implementation)
        
        # Check if video_ids are provided in config
        if "video_ids" in self.config:
            return self.config["video_ids"]
        
        # If channel_id is provided, try to fetch (requires API or scraping)
        print(f"Warning: Automatic channel scraping not implemented yet.")
        print(f"Please provide video_ids in config.yaml or use --video-ids argument")
        return []
    
    def extract_transcript(self, video_id: str, languages: Optional[List[str]] = None) -> Optional[Dict]:
        """Extract transcript for a single video.

        ISSUE #91 (c) — THE BUG THIS FIXES
        ----------------------------------
        `process_video` used to call `self.extract_transcript(video_id)` with no
        `languages` argument, so the default `["en"]` was always used and the
        `languages: [en, hi]` list in config.yaml was silently ignored. Most of
        this channel has no English captions, so the script failed on almost
        every video it was pointed at.

        It also recorded `languages[0]` as the language of the result, i.e. it
        claimed English for a transcript it had not necessarily fetched in
        English. The real language code is now read back off the transcript.

        Auto-TRANSLATED tracks are rejected. YouTube will happily machine-
        translate a machine transcription into any language; stacking two lossy
        machine steps on medical content is not acceptable as a KB source.
        """
        languages = languages or self.config.get("languages", ["en"])
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

            transcript = None
            # 1. Human-authored captions in a preferred language.
            try:
                transcript = transcript_list.find_manually_created_transcript(languages)
            except Exception:
                transcript = None
            # 2. Original-language ASR in a preferred language.
            if transcript is None:
                try:
                    transcript = transcript_list.find_generated_transcript(languages)
                except Exception:
                    transcript = None
            # 3. Original-language ASR in ANY language — better an honest Hindi
            #    transcript than a translated English one.
            if transcript is None:
                for candidate in transcript_list:
                    if not getattr(candidate, "is_translated", False):
                        transcript = candidate
                        break

            if transcript is None:
                print(f"  ✗ No transcript available for {video_id}")
                return None

            if getattr(transcript, "is_translated", False):
                print(
                    f"  ✗ Only a machine-TRANSLATED track is available for {video_id} "
                    f"({transcript.language_code}); refusing it as a KB source"
                )
                return None

            transcript_list_data = transcript.fetch()
            if not transcript_list_data:
                # The API resolves with an EMPTY LIST rather than raising when a
                # video has no captions. Guard explicitly — see issue #91 (a).
                print(f"  ✗ Empty transcript returned for {video_id}")
                return None

            formatter = TextFormatter()
            transcript_text = formatter.format_transcript(transcript_list_data)

            if len(transcript_text.strip()) < MIN_TRANSCRIPT_CHARS:
                print(
                    f"  ✗ Transcript for {video_id} is {len(transcript_text.strip())} chars "
                    f"(minimum {MIN_TRANSCRIPT_CHARS}); refusing to write a KB file"
                )
                return None

            return {
                "video_id": video_id,
                "transcript": transcript_text,
                "segments": transcript_list_data,
                "language": transcript.language_code,
                "is_generated": bool(getattr(transcript, "is_generated", True)),
                "extracted_at": datetime.utcnow().isoformat()
            }
        except Exception as e:
            print(f"Error extracting transcript for {video_id}: {str(e)}")
            return None

    def get_video_metadata(self, video_id: str) -> Dict:
        """
        Get video metadata (title, published date, etc.)
        
        Note: This requires YouTube Data API v3 or yt-dlp
        """
        # Placeholder - implement with YouTube Data API or yt-dlp
        return {
            "video_id": video_id,
            "title": f"Video {video_id}",  # Placeholder
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "published_at": None,
            "duration_seconds": None,
            "description": None
        }
    
    def save_json(self, data: Dict, video_id: str):
        """Save raw transcript data as JSON"""
        output_file = self.output_dir / f"{video_id}.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  ✓ Saved JSON: {output_file}")
    
    def convert_to_markdown(self, transcript_data: Dict, metadata: Dict) -> str:
        """Convert transcript to Markdown format with frontmatter"""
        # Extract video info
        video_id = transcript_data["video_id"]
        transcript = transcript_data["transcript"]
        published_at = metadata.get("published_at") or datetime.utcnow().date().isoformat()
        title = metadata.get("title") or f"Onco Talks - {video_id}"
        
        # Create frontmatter
        frontmatter = {
            "title": title,
            "video_id": video_id,
            "published_at": published_at,
            "source": "SCCF Onco Talks",
            "sourceType": "01_suchi_oncotalks",
            "license": "sccf_owned",
            # Uncorrected machine captions are never retrievable content.
            # rag.service.ts filters on status = 'active'.
            "status": "inactive",
            "reviewStatus": "pending",
            "version": "v1",
            "lastReviewed": datetime.utcnow().date().isoformat(),
            "reviewFrequency": "monthly",
            "audienceLevel": "patient",
            "language": transcript_data.get("language", "en"),
            "cancerTypes": ["general"],
            "tags": ["onco-talks", "patient-stories", "transcript"],
            "url": metadata.get("url", f"https://www.youtube.com/watch?v={video_id}")
        }
        
        # Format as YAML frontmatter
        frontmatter_yaml = yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
        
        # Combine into Markdown
        markdown = f"---\n{frontmatter_yaml}---\n\n# {title}\n\n## Transcript\n\n{transcript}\n"
        
        return markdown
    
    def save_markdown(self, markdown: str, video_id: str, language: str = "en"):
        """Save Markdown file to the KB folder for `language`"""
        # Create safe filename from video_id
        filename = f"oncotalks-{video_id}.md"
        kb_dir = self.kb_dir_for(language)
        output_file = kb_dir / filename

        with open(output_file, "w", encoding="utf-8") as f:
            f.write(markdown)

        print(f"  ✓ Saved Markdown: {output_file}")
        return str(output_file.relative_to(self.kb_root))
    
    def process_video(self, video_id: str) -> Optional[Dict]:
        """Process a single video: extract transcript and convert to Markdown"""
        print(f"\nProcessing video: {video_id}")
        
        # Extract transcript
        transcript_data = self.extract_transcript(video_id, self.config.get("languages"))
        if not transcript_data:
            return None
        
        # Get metadata
        metadata = self.get_video_metadata(video_id)
        transcript_data.update(metadata)
        
        # Save JSON
        self.save_json(transcript_data, video_id)
        
        # Convert to Markdown
        markdown = self.convert_to_markdown(transcript_data, metadata)
        
        # Save Markdown into the folder for the language actually spoken
        language = transcript_data.get("language", "en")
        kb_path = self.save_markdown(markdown, video_id, language)

        return {
            "video_id": video_id,
            "title": metadata.get("title"),
            "kb_path": kb_path,
            "language": language,
            "status": "success"
        }
    
    def update_manifest(self, results: List[Dict], manifest_path: str):
        """Update manifest.json with new transcript entries"""
        manifest_file = Path(manifest_path)
        
        if not results:
            print("  ⚠ No successful transcripts — manifest left untouched")
            return

        if manifest_file.exists():
            with open(manifest_file, "r") as f:
                manifest = json.load(f)
        else:
            manifest = {
                "locale": "multi",
                "schemaVersion": "2.0",
                "staged": True,
                "note": (
                    "STAGED — NOT INGESTED. Uncorrected machine transcripts awaiting SCCF medical "
                    "review (issue #91 D1-D5). ingest-kb.ts reads kb/manifest.json, not this file."
                ),
                "docs": []
            }
        if not isinstance(manifest.get("docs"), list):
            manifest["docs"] = []

        added = 0
        
        # Add new entries
        for result in results:
            if result.get("status") != "success":
                continue
            
            lang = result.get("language", "en")
            lang_code = lang if lang in ("hi", "en") else "en"
            doc_id = f"kb_{lang_code}_oncotalks_{result['video_id']}_v1"
            
            # Check if already exists
            existing = next((d for d in manifest["docs"] if d["id"] == doc_id), None)
            if existing:
                print(f"  ⚠ Skipping {doc_id} - already in manifest")
                continue
            
            doc_entry = {
                "id": doc_id,
                "title": result.get("title", f"Onco Talks - {result['video_id']}"),
                "version": "v1",
                "status": "inactive",
                "reviewStatus": "pending",
                "source": "SCCF Onco Talks",
                "sourceType": "01_suchi_oncotalks",
                "path": result["kb_path"],
                "license": "sccf_owned",
                "lastReviewed": datetime.utcnow().date().isoformat(),
                "reviewFrequency": "monthly",
                "audienceLevel": "patient",
                "language": lang_code,
                "cancerTypes": ["general"],
                "tags": ["onco-talks", "patient-stories", "transcript"],
                "url": f"https://www.youtube.com/watch?v={result['video_id']}",
                "citation": f"SCCF Onco Talks, {datetime.utcnow().year}"
            }
            
            manifest["docs"].append(doc_entry)
            added += 1
            print(f"  ✓ Added to manifest: {doc_id}")

        if added == 0:
            print("  ⚠ No new entries — manifest left untouched")
            return

        # Save updated manifest
        with open(manifest_file, "w") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        print(f"\n✓ Manifest updated: {manifest_file}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Extract YouTube transcripts for Suchi KB")
    parser.add_argument("--video-ids", nargs="+", help="Video IDs to process")
    parser.add_argument("--channel-id", help="YouTube channel ID")
    parser.add_argument("--config", default="config.yaml", help="Config file path")
    # The STAGING manifest, deliberately. `npm run kb:ingest` reads
    # kb/manifest.json unconditionally, so defaulting there would put
    # uncorrected machine transcripts one routine command away from being
    # chunked and embedded. Writing the live manifest requires naming it.
    parser.add_argument(
        "--manifest",
        default="../../kb/manifest.oncotalks-pending.json",
        help="Manifest file path (default: the staging manifest, NOT kb/manifest.json)",
    )
    parser.add_argument("--skip-manifest", action="store_true", help="Skip manifest update")
    
    args = parser.parse_args()
    
    extractor = YouTubeTranscriptExtractor(args.config)
    
    # Get video IDs
    video_ids = []
    if args.video_ids:
        video_ids = args.video_ids
    elif args.channel_id:
        video_ids = extractor.get_video_ids_from_channel(args.channel_id)
    elif "video_ids" in extractor.config:
        video_ids = extractor.config["video_ids"]
    else:
        print("Error: No video IDs provided. Use --video-ids or configure in config.yaml")
        sys.exit(1)
    
    if not video_ids:
        print("Error: No video IDs to process")
        sys.exit(1)
    
    print(f"Processing {len(video_ids)} videos...")
    
    # Process each video
    results = []
    for video_id in video_ids:
        result = extractor.process_video(video_id)
        if result:
            results.append(result)
    
    # Update manifest
    if not args.skip_manifest and results:
        extractor.update_manifest(results, args.manifest)
    
    print(f"\n✓ Completed: {len(results)}/{len(video_ids)} videos processed successfully")


if __name__ == "__main__":
    main()
