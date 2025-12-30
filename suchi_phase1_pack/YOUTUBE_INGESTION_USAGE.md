# YouTube Transcript Ingestion - Usage Guide

## Multi-Language Support

The YouTube ingestion system now supports **both English and Hindi** transcripts, automatically detecting and organizing them into separate knowledge bases.

### How It Works

1. **Automatic Language Detection**
   - Tries English first (`en`)
   - Falls back to Hindi (`hi`) if English not available
   - Accepts any available language as last resort

2. **Separate Knowledge Bases**
   - English transcripts → `kb/en/01_suchi_oncotalks/`
   - Hindi transcripts → `kb/hi/01_suchi_oncotalks/`
   - Both tracked in `kb/manifest.json`

## API Endpoints

### Base URL
```
https://suchi-api-514521785197.us-central1.run.app/v1
```

### Authentication
```bash
Username: admin
Password: SuchiAdmin2024!
```

## Test a Single Video

Check if a video has transcripts and preview the content:

```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/test \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": "X3dCbyG-GnE"
  }'
```

**With language preference:**
```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/test \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d '{
    "videoId": "X3dCbyG-GnE",
    "language": "hi"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "videoId": "X3dCbyG-GnE",
  "title": "Onco Talks Episode - X3dCbyG-GnE",
  "language": "hi",
  "textLength": 15420,
  "segmentCount": 234,
  "preview": "स्वागत है आपका ऑन्को टॉक्स में..."
}
```

## Ingest Multiple Videos

Add transcripts to the knowledge base:

```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/ingest \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d '{
    "videoIds": ["VIDEO_ID_1", "VIDEO_ID_2", "VIDEO_ID_3"]
  }'
```

**With language preference (force Hindi):**
```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/ingest \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d '{
    "videoIds": ["VIDEO_ID_1", "VIDEO_ID_2"],
    "language": "hi"
  }'
```

**Using URLs instead of IDs:**
```bash
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/ingest \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d '{
    "videoUrls": [
      "https://www.youtube.com/watch?v=X3dCbyG-GnE",
      "https://youtu.be/ABC123XYZ"
    ]
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Successfully ingested 2 YouTube transcripts",
  "processed": 2,
  "saved": 2,
  "errors": 0,
  "manifestEntries": [
    {
      "id": "kb_hi_oncotalks_X3dCbyG-GnE_v1",
      "title": "Onco Talks Episode - X3dCbyG-GnE",
      "videoId": "X3dCbyG-GnE"
    }
  ]
}
```

## After Ingestion: Update Database

After adding new transcripts to the KB, you must re-run the KB ingestion job:

```bash
gcloud run jobs execute suchi-kb-ingest --region us-central1
```

This will:
1. Read all markdown files from `kb/en/` and `kb/hi/`
2. Generate embeddings for new content
3. Update the PostgreSQL database
4. Make transcripts searchable in the chatbot

## Language-Specific Knowledge Bases

### English KB
- **Path**: `kb/en/01_suchi_oncotalks/`
- **Manifest ID**: `kb_en_oncotalks_VIDEO_ID_v1`
- **Source**: `Suchi Cancer Care Foundation - Onco Talks (EN)`

### Hindi KB
- **Path**: `kb/hi/01_suchi_oncotalks/`
- **Manifest ID**: `kb_hi_oncotalks_VIDEO_ID_v1`
- **Source**: `Suchi Cancer Care Foundation - Onco Talks (HI)`

## Workflow Summary

```
1. Find Onco Talks video IDs
   ↓
2. Test with /admin/youtube/test
   ↓
3. Ingest with /admin/youtube/ingest
   ↓
4. Transcripts saved to kb/en/ or kb/hi/
   ↓
5. manifest.json updated
   ↓
6. Run: gcloud run jobs execute suchi-kb-ingest
   ↓
7. Chatbot can now answer questions from videos!
```

## Finding Video IDs

### From YouTube URL
```
https://www.youtube.com/watch?v=X3dCbyG-GnE
                                 └─────┬─────┘
                                   Video ID
```

### From Onco Talks Channel
1. Go to: https://www.youtube.com/@SuchiFdn/videos
2. Click on each video
3. Copy the `v=` parameter from the URL

## Common Issues

### "Transcript is disabled on this video"
- The channel owner has disabled transcripts for this video
- Try a different video
- Contact channel owner to enable auto-captions

### "No new transcripts to add"
- Video was already ingested
- Check `kb/manifest.json` for existing entries
- Use unique video IDs

### Authentication Failed
- Ensure credentials are correct: `admin:SuchiAdmin2024!`
- Use `-u` flag with curl
- Or use `Authorization: Basic` header

## Example: Batch Process Onco Talks Videos

```bash
# Step 1: Create a list of video IDs
VIDEO_IDS='["X3dCbyG-GnE","ABC123XYZ","DEF456UVW"]'

# Step 2: Test first video
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/test \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d '{"videoId": "X3dCbyG-GnE"}'

# Step 3: Ingest all videos
curl -X POST https://suchi-api-514521785197.us-central1.run.app/v1/admin/youtube/ingest \
  -u "admin:SuchiAdmin2024!" \
  -H "Content-Type: application/json" \
  -d "{\"videoIds\": $VIDEO_IDS}"

# Step 4: Update database
gcloud run jobs execute suchi-kb-ingest --region us-central1

# Step 5: Monitor job
gcloud run jobs executions list --region us-central1 | head -5
```

## Rate Limiting

- 1 second delay between video requests
- Prevents YouTube API throttling
- Batch processing is automatic
- Failed videos don't stop the batch

## Next Steps

1. Build a list of all Onco Talks video IDs
2. Filter for videos with transcripts enabled
3. Run batch ingestion
4. Create both English and Hindi knowledge bases
5. Enable multi-language chatbot support
