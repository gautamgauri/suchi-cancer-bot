# Knowledge Base Ingestion - Safety Guide

## ⚠️ CRITICAL: Data Protection

This document outlines safety features protecting against accidental data loss during KB ingestion.

## Safety Features Implemented

### 1. **Double Confirmation Required for Wipe Operations**

The `--wipeChunks` flag now **requires** `--confirmWipe` to execute:

```bash
# ❌ BLOCKED - Safety check will fail
npm run kb:ingest -- --wipeChunks

# ✅ ALLOWED - Both flags present
npm run kb:ingest -- --wipeChunks --confirmWipe
```

### 2. **Pre-Wipe Statistics Warning**

Before any wipe operation, the script shows:
- Current document count
- Total chunks in database
- Chunks with embeddings

Example output:
```
⚠️  WARNING: DESTRUCTIVE OPERATION REQUESTED
   Current database state:
   - Documents: 805
   - Total chunks: 31,610
   - Chunks with embeddings: 31,026

   --wipeChunks will DELETE all 31,610 chunks!
```

### 3. **Safe NPM Scripts by Default**

Updated npm scripts use safe defaults:

| Script | Behavior | Use Case |
|--------|----------|----------|
| `npm run kb:ingest` | Resume from checkpoint, no wipe | **Default** - Safest option |
| `npm run kb:dry` | Dry run, shows what would happen | Testing changes |
| `npm run kb:ingest:fresh` | Fresh start with wipe + confirmation | Complete rebuild |
| `npm run kb:ingest:no-embeddings` | Resume without generating embeddings | Fast content updates |

### 4. **Automatic Checkpointing**

- Checkpoint saved after **every document** processed
- Resume capability with `--resume` flag
- Protects against interruptions

## Recommended Workflows

### Normal Operations: Add/Update Documents

```bash
# 1. Add new markdown files to kb/en/
# 2. Run ingestion (uses --resume by default)
npm run kb:ingest
```

This will:
- ✅ Resume from last checkpoint
- ✅ Skip already-processed documents
- ✅ Only process new/changed documents
- ✅ No data loss risk

### Fresh Start: Complete Rebuild

**⚠️ Use only when necessary (e.g., schema changes, corruption)**

```bash
# Shows statistics and requires explicit confirmation
npm run kb:ingest:fresh
```

This will:
- ⚠️ Delete ALL existing chunks
- ⚠️ Regenerate all embeddings (~4-5 hours for 1,400 docs)
- ⚠️ Requires explicit --confirmWipe flag

### Testing: Dry Run

```bash
npm run kb:dry
```

This will:
- ✅ Show what would be processed
- ✅ No database changes
- ✅ No API calls for embeddings

## Flags Reference

### Safety Flags

- `--confirmWipe` - Required with `--wipeChunks` to prevent accidents
- `--dryRun` - Preview mode, no database changes

### Operation Flags

- `--resume` - Resume from checkpoint (recommended)
- `--wipeChunks` - Delete existing chunks (requires --confirmWipe)
- `--skipEmbeddings` - Skip embedding generation (for content-only updates)

### Configuration Flags

- `--kbRoot <path>` - Custom KB directory path
- `--maxChunkChars <number>` - Maximum chunk size (default: 1400)
- `--overlapChars <number>` - Chunk overlap (default: 200)

## Common Scenarios

### Scenario 1: Added 50 new documents

```bash
# Just run the default command
npm run kb:ingest
```

**Time:** ~15-30 minutes (only processes new docs)

### Scenario 2: Updated metadata in manifest.json

```bash
# No need to regenerate chunks/embeddings
npm run kb:ingest
```

**Time:** ~5-10 minutes (updates metadata only)

### Scenario 3: Changed chunking parameters

```bash
# Need fresh rebuild to apply new chunking
npm run kb:ingest:fresh
```

**Time:** ~4-5 hours (full rebuild with embeddings)

### Scenario 4: Testing changes before deployment

```bash
# Always test first with dry run
npm run kb:dry
```

**Time:** <1 minute (no processing)

## Emergency Recovery

If ingestion fails mid-process:

1. **Check the checkpoint file:**
   ```bash
   cat .ingestion-checkpoint.json
   ```

2. **Resume from checkpoint:**
   ```bash
   npm run kb:ingest
   ```

3. **If checkpoint is corrupted:**
   ```bash
   # Delete checkpoint to start fresh
   rm .ingestion-checkpoint.json
   npm run kb:ingest
   ```

## Incident Prevention Checklist

Before running any ingestion:

- [ ] Do you know how many documents are currently in the database?
- [ ] Do you need to wipe existing data, or just add new content?
- [ ] Have you tested with `--dryRun` first?
- [ ] If wiping, have you confirmed this is intentional?
- [ ] Do you have a recent database backup?

## Version History

- **v2.0** (2026-01-01): Added double confirmation, statistics, safe npm scripts
- **v1.0** (2025-12-31): Initial checkpointing implementation

## Contact

For questions or issues, refer to the main project documentation.
