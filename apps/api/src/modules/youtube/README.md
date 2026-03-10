# YouTube Transcript Ingestion Module

This module provides integrated YouTube transcript extraction and knowledge base ingestion directly within the Suchi API.

## Features

- Extract transcripts from YouTube videos automatically
- Convert transcripts to KB markdown format
- Auto-detect cancer types and topics from content
- Update manifest.json automatically
- Batch process multiple videos
- Admin API endpoints for triggering ingestion

## API Endpoints

### 1. Ingest YouTube Transcripts

**Endpoint**: `POST /admin/youtube/ingest`

**Authentication**: Basic Auth (same as other admin endpoints)

**Request Body**:
```json
{
  "videoIds": ["VIDEO_ID_1", "VIDEO_ID_2"],
  "videoUrls": ["https://www.youtube.com/watch?v=VIDEO_ID"]
}
```

**Example using curl**:
```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/admin/youtube/ingest \
  -u "admin:password" \
  -H "Content-Type: application/json" \
  -d '{
    "videoIds": ["dQw4w9WgXcQ", "9bZkp7q19f0"]
  }'
```

**Response**:
```json
{
  "success": true,
  "message": "Successfully ingested 2 YouTube transcripts",
  "processed": 2,
  "saved": 2,
  "errors": 0,
  "manifestEntries": [
    {
      "id": "kb_en_oncotalks_dQw4w9WgXcQ_v1",
      "title": "Onco Talks Episode - dQw4w9WgXcQ",
      "videoId": "dQw4w9WgXcQ"
    }
  ]
}
```

### 2. Test Single Transcript

**Endpoint**: `POST /admin/youtube/test`

**Request Body**:
```json
{
  "videoId": "VIDEO_ID"
}
```

**Example**:
```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/admin/youtube/test \
  -u "admin:password" \
  -H "Content-Type: application/json" \
  -d '{"videoId": "dQw4w9WgXcQ"}'
```

**Response**:
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "title": "Onco Talks Episode - dQw4w9WgXcQ",
  "language": "en",
  "textLength": 15234,
  "segmentCount": 187,
  "preview": "Welcome to Onco Talks..."
}
```

## Workflow

### Option 1: Direct Video IDs (Recommended)

1. Collect video IDs from Onco Talks channel
2. Call `/admin/youtube/ingest` with video IDs
3. Transcripts are automatically:
   - Extracted from YouTube
   - Converted to KB markdown format
   - Saved to `kb/en/01_suchi_oncotalks/`
   - Added to `kb/manifest.json`
4. Run KB re-ingestion to update database:
   ```bash
   gcloud run jobs execute suchi-kb-ingest --region us-central1
   ```

### Option 2: Video URLs

You can also provide full YouTube URLs:
```json
{
  "videoUrls": [
    "https://www.youtube.com/watch?v=VIDEO_ID_1",
    "https://youtu.be/VIDEO_ID_2"
  ]
}
```

## Output Format

Each YouTube transcript creates:

### Markdown File
`kb/en/01_suchi_oncotalks/episode-title-VIDEO_ID.md`

```markdown
---
title: "Episode Title"
version: "v1"
status: "active"
source: "Suchi Cancer Care Foundation - Onco Talks"
video_id: "VIDEO_ID"
---

# Episode Title

**Source**: Onco Talks YouTube Channel
**Video URL**: https://www.youtube.com/watch?v=VIDEO_ID
**Language**: en
**Transcript Type**: Auto-generated

## Transcript

[Full transcript text...]

---
*This transcript is from the Onco Talks YouTube channel by Suchi Cancer Care Foundation.*
```

### Manifest Entry
```json
{
  "id": "kb_en_oncotalks_VIDEO_ID_v1",
  "title": "Episode Title",
  "source": "Suchi Cancer Care Foundation - Onco Talks",
  "sourceType": "01_suchi_oncotalks",
  "path": "en/01_suchi_oncotalks/episode-title-VIDEO_ID.md",
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "cancerTypes": ["breast", "lung"],
  "tags": ["treatment", "screening"]
}
```

## Metadata Auto-Detection

The module automatically detects:

### Cancer Types
- breast, lung, prostate, colorectal, pancreatic
- ovarian, leukemia, lymphoma, skin (melanoma)
- thyroid, liver, kidney, stomach, bladder
- Falls back to "general" if none detected

### Tags/Topics
- treatment, chemotherapy, radiation-therapy, surgery
- immunotherapy, screening, prevention
- symptoms, diagnosis, nutrition, side-effects
- caregiver, support, palliative-care, survivorship
- Falls back to ["oncology", "education"] if none detected

## Rate Limiting

The ingestion service includes automatic rate limiting:
- 1 second delay between video requests
- Prevents YouTube API throttling
- Continues processing if individual videos fail

## Error Handling

- Failed videos are logged but don't stop batch processing
- Duplicate video IDs are automatically skipped
- Invalid video IDs return error messages
- Manifest updates are atomic (all-or-nothing)

## Future Enhancements

- Channel scraping to auto-discover all videos
- Video metadata fetching (titles, descriptions, thumbnails)
- Scheduled automatic ingestion
- Web UI for triggering ingestion
- Support for multiple languages

## Troubleshooting

### "Could not extract video ID from URL"
- Ensure URL format is correct: `https://www.youtube.com/watch?v=VIDEO_ID`
- Or use video IDs directly instead of URLs

### "Error fetching transcript"
- Video may not have transcripts available
- Video may be private or deleted
- Check video ID is correct

### "No new entries to add to manifest"
- Videos were already ingested previously
- Check `kb/manifest.json` for existing entries

## Example: Batch Ingest Onco Talks Videos

```bash
# Create a list of video IDs
VIDEO_IDS='["abc123", "def456", "ghi789"]'

# Ingest all videos
curl -X POST https://suchi-api-514521785197.us-central1.run.app/admin/youtube/ingest \
  -u "admin:password" \
  -H "Content-Type: application/json" \
  -d "{\"videoIds\": $VIDEO_IDS}"

# Re-ingest knowledge base
gcloud run jobs execute suchi-kb-ingest --region us-central1
```
