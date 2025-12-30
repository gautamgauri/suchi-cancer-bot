# Onco Talks YouTube Transcript Ingestion Guide

## Workflow

### Step 1: Run YouTube Transcript Extraction (Google Colab)

1. Open Google Colab
2. Run your transcript ingestion script (the one you shared)
3. This will create in your Google Drive:
   ```
   MyDrive/suchi_kb/youtube/
   ├── transcripts/
   │   ├── VIDEO_ID_1.json
   │   ├── VIDEO_ID_1.txt
   │   ├── VIDEO_ID_2.json
   │   └── ...
   ├── manifest.jsonl
   └── run_summary.json
   ```

### Step 2: Download YouTube Transcripts

Download the entire `youtube/` folder from your Google Drive to:
```
suchi_phase1_pack/youtube/
```

### Step 3: Convert to KB Format

Run the conversion script:
```bash
cd suchi_phase1_pack/scripts
python convert-youtube-to-kb.py
```

This will:
- Read `youtube/transcripts/*.json`
- Create markdown files in `kb/en/01_suchi_oncotalks/`
- Update `kb/manifest.json` with new entries
- Auto-detect cancer types and tags from content

### Step 4: Review Generated Files

Check:
- `kb/en/01_suchi_oncotalks/` - new markdown files
- `kb/manifest.json` - updated with Onco Talks entries

### Step 5: Re-ingest Knowledge Base

Run the Cloud Run Job to update the database:
```bash
gcloud run jobs execute suchi-kb-ingest --region us-central1
```

---

## Customization

### Video Titles
The script generates titles like "Onco Talks Episode - VIDEO_ID".

To get actual video titles, enhance the Colab script to fetch metadata:
```python
# Add to Colab after getting video IDs
def get_video_metadata(video_id):
    cmd = ["yt-dlp", "--dump-json", f"https://www.youtube.com/watch?v={video_id}"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return json.loads(result.stdout)
    return {}

# Then save metadata alongside transcripts
```

### Cancer Type Detection
Edit `extract_metadata_from_text()` in `convert-youtube-to-kb.py` to improve:
- Cancer type keywords
- Topic/tag keywords
- Pattern matching for episode numbers

### Manual Metadata
Create a `youtube/video_metadata.json` file:
```json
{
  "VIDEO_ID_1": {
    "title": "Understanding Breast Cancer Treatment Options",
    "cancer_types": ["breast"],
    "tags": ["treatment", "surgery", "chemotherapy"]
  }
}
```

Then update the script to load and use this.

---

## Summary Output Format

Each Onco Talks video becomes:
```
kb/en/01_suchi_oncotalks/episode-title-VIDEO_ID.md
```

With manifest entry:
```json
{
  "id": "kb_en_oncotalks_VIDEO_ID_v1",
  "title": "Episode Title",
  "source": "Suchi Cancer Care Foundation - Onco Talks",
  "sourceType": "01_suchi_oncotalks",
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  ...
}
```
