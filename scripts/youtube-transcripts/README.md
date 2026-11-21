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
- **Markdown files**: Processed transcripts saved to `kb/<lang>/01_suchi_oncotalks/`,
  where `<lang>` is the language of the caption track actually used — most of
  this channel is Hindi, so most drafts land in `kb/hi/`.
- **Manifest**: `kb/manifest.oncotalks-pending.json` — the **staging** manifest,
  not `kb/manifest.json`. `npm run kb:ingest` reads `kb/manifest.json` only, so
  nothing written here is ingested. Use `--skip-manifest` to skip even that.

Every document is written with `status: inactive` and `reviewStatus: pending`.
Retrieval filters on `status = 'active'` (`rag.service.ts`), so a draft cannot
reach an answer.

## Monthly Update Process

1. Run extraction:
   ```bash
   python extract_transcripts.py --channel-id UCI242a2_VRTCdCbpXzyeW4w
   ```

2. Open a PR with the generated Markdown and have SCCF review it. Every caption
   on this channel is machine-generated and is wrong on exactly the words that
   matter — names, drug names, dosages (issue #91).

3. **Do not run `npm run kb:ingest` to publish these drafts.** Ingestion is a
   separate, deliberate step that happens only after review: move the reviewed
   entry from `kb/manifest.oncotalks-pending.json` into `kb/manifest.json` and
   set its `status` to `active`. See `kb/README.md`.

## Notes

- The script uses `youtube-transcript-api` which works without API keys
- For video metadata (title, date), you may need YouTube Data API v3 or yt-dlp
- Machine-**translated** caption tracks are rejected outright: YouTube will
  translate a machine transcription into any language, and stacking two lossy
  machine steps on medical content is not acceptable as a KB source
- A transcript shorter than `MIN_TRANSCRIPT_CHARS` (400) is refused rather than
  written as an empty document
- Files are automatically formatted for the Gold Stack KB structure

## Troubleshooting

- **No transcripts found**: Video may not have captions enabled
- **API errors**: Check internet connection and video availability
- **Encoding issues**: Ensure UTF-8 encoding for non-English transcripts






















