# YouTube Transcript Extraction for Suchi KB

This script extracts transcripts from the Suchitra Cancer Care Foundation YouTube channel and converts them to Markdown format for KB ingestion.

## Setup

1. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure** (optional):
   - Edit `config.yaml` to customize settings
   - Set environment variables if needed (see `.env.example`)

## Usage

### Extract specific videos:
```bash
python extract_transcripts.py --video-ids VIDEO_ID_1 VIDEO_ID_2
```

### Extract from config:
```bash
# Add video_ids to config.yaml, then:
python extract_transcripts.py
```

### With channel ID:
```bash
python extract_transcripts.py --channel-id UCI242a2_VRTCdCbpXzyeW4w
```

### Skip manifest update:
```bash
python extract_transcripts.py --video-ids VIDEO_ID --skip-manifest
```

## Output

- **JSON files**: Raw transcript data saved to `output/` directory
- **Markdown files**: Processed transcripts saved to `kb/en/01_suchi_oncotalks/`
- **Manifest**: Automatically updated with new entries (unless `--skip-manifest`)

## Monthly Update Process

1. Run extraction:
   ```bash
   python extract_transcripts.py --channel-id UCI242a2_VRTCdCbpXzyeW4w
   ```

2. Review generated Markdown files

3. Run KB ingestion:
   ```bash
   cd ../../apps/api
   npm run kb:ingest
   ```

## Notes

- The script uses `youtube-transcript-api` which works without API keys
- For video metadata (title, date), you may need YouTube Data API v3 or yt-dlp
- Transcripts are extracted with English as primary language
- Files are automatically formatted for the Gold Stack KB structure

## Troubleshooting

- **No transcripts found**: Video may not have captions enabled
- **API errors**: Check internet connection and video availability
- **Encoding issues**: Ensure UTF-8 encoding for non-English transcripts











