# Trust-First RAG v2 - Ingestion & Hashing Workstream

**Date:** 2026-01-20  
**Agent:** @retrieval-engineer (or @devops-gcp-deployer)  
**Scope:** Phase 1 - Idempotent ingestion with content hashing  
**Priority:** MEDIUM - Operational efficiency improvement

---

## Objective

Make KB ingestion **idempotent** and **efficient** by:
1. Normalizing content before hashing
2. Skipping unchanged documents (same `versionHash`)
3. Supporting dry-run mode to preview changes

---

## Context

Current `ingest-kb.ts`:
- Generates `versionHash` from raw content (line 187)
- Always re-chunks and re-embeds all docs (inefficient)
- No SKIP logic for unchanged documents

**Phase 1 Goal:** Add hash-based change detection so running ingestion twice on the same KB is fast and safe.

---

## Tasks

### 1. Clarify versionHash Semantics

**Current behavior:** `versionHash` is computed from raw file content.

**New behavior:** `versionHash` = hash of **normalized content** actually used for chunking.

**Why?** Ensures hash changes only when chunking output would change (not just formatting).

### 2. Implement Content Normalization

**File:** `apps/api/src/scripts/ingest-kb.ts`

Add normalization function before hashing:

```typescript
/**
 * Normalize content for stable hashing
 * Apply same transformations used by chunker to ensure hash consistency
 */
function normalizeContent(content: string): string {
  let normalized = content;
  
  // 1. Normalize line endings to \n
  normalized = normalized.replace(/\r\n/g, '\n');
  
  // 2. Trim trailing whitespace per line
  normalized = normalized.split('\n')
    .map(line => line.trimEnd())
    .join('\n');
  
  // 3. Collapse 3+ blank lines to 2 (chunker ignores excessive spacing)
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  
  // 4. Trim overall content
  normalized = normalized.trim();
  
  return normalized;
}
```

### 3. Update Hash Computation

**File:** `apps/api/src/scripts/ingest-kb.ts`

Modify `ingestDoc` function (around line 168-189):

```typescript
async function ingestDoc(doc: ManifestDoc, opts: Opts) {
  const full = path.join(opts.kbRoot, doc.path);
  mustExist(full);
  const raw = fs.readFileSync(full, "utf-8");
  const parsed = matter(raw);
  const rawContent = parsed.content.trim();

  // NORMALIZE content before hashing (same as chunker input)
  const normalizedContent = normalizeContent(rawContent);
  
  // Generate version hash from NORMALIZED content
  const versionHash = createHash("sha256")
    .update(normalizedContent)
    .digest("hex")
    .substring(0, 16);

  // Check if document is unchanged (SKIP logic)
  const existingDoc = await withRetry(() => 
    prisma.kbDocument.findUnique({ 
      where: { id: doc.id },
      select: { versionHash: true, status: true }
    })
  );

  if (existingDoc && 
      existingDoc.versionHash === versionHash && 
      existingDoc.status === 'active' &&
      !opts.wipeChunks) {
    // Document unchanged - SKIP re-chunking/re-embedding
    console.log(`  ⏭️  SKIP (unchanged hash: ${versionHash})`);
    return; // Early return
  }

  // Document is NEW or UPDATED - proceed with chunking
  const logPrefix = existingDoc ? 'UPDATE' : 'NEW';
  console.log(`  ${logPrefix} (hash: ${versionHash})`);

  // Continue with existing chunking logic...
  const chunks = chunkMarkdown(normalizedContent, opts.maxChunkChars, opts.overlapChars);
  
  const sourceInfo = `[${doc.sourceType || "unknown"}] ${doc.source || "Unknown"}`;
  console.log(`[DOC] ${doc.id}  ${sourceInfo}  (${chunks.length} chunks)`);
  if (opts.dryRun) return;

  // ... rest of existing upsert logic ...
}
```

### 4. Verify Dry Run Mode

**File:** `apps/api/src/scripts/ingest-kb.ts`

Ensure dry run prints SKIP/NEW/UPDATE without mutations:

```typescript
async function ingestDoc(doc: ManifestDoc, opts: Opts) {
  // ... normalization and hash calculation ...

  // Check for SKIP (even in dry run)
  const existingDoc = await withRetry(() => 
    prisma.kbDocument.findUnique({ 
      where: { id: doc.id },
      select: { versionHash: true, status: true }
    })
  );

  const isUnchanged = existingDoc && 
                      existingDoc.versionHash === versionHash && 
                      existingDoc.status === 'active';

  if (isUnchanged && !opts.wipeChunks) {
    console.log(`  ⏭️  SKIP (unchanged hash: ${versionHash})`);
    return;
  }

  const logPrefix = existingDoc ? 'UPDATE' : 'NEW';
  
  // DRY RUN: Print action but don't execute
  if (opts.dryRun) {
    const chunks = chunkMarkdown(normalizedContent, opts.maxChunkChars, opts.overlapChars);
    console.log(`  [DRY RUN] ${logPrefix} (hash: ${versionHash}, ${chunks.length} chunks)`);
    return; // Stop here for dry run
  }

  // REAL RUN: Proceed with upsert
  console.log(`  ${logPrefix} (hash: ${versionHash})`);
  // ... rest of existing logic ...
}
```

### 5. Test Idempotency

**Scenario:** Run ingestion twice with no KB changes

```bash
# First run (all docs should be NEW or UPDATE)
npm run kb:ingest

# Second run (all docs should be SKIP)
npm run kb:ingest

# Expected output:
#   ⏭️  SKIP (unchanged hash: abc123...)
#   ⏭️  SKIP (unchanged hash: def456...)
#   ...

# Verify: Chunk counts should NOT change
# Query: SELECT COUNT(*) FROM "KbChunk"; -- should be same
```

**Scenario:** Dry run after changes

```bash
# Make a small edit to one KB file (add a line)

# Dry run to preview
npm run kb:dry

# Expected output:
#   [DRY RUN] UPDATE (hash: xyz789, 12 chunks)  <- changed doc
#   ⏭️  SKIP (unchanged hash: abc123...)        <- all others
```

---

## Acceptance Criteria

✅ Content normalization function strips formatting differences  
✅ `versionHash` computed from normalized content (not raw)  
✅ Unchanged docs logged as SKIP (no re-chunking, no DB writes)  
✅ Changed docs logged as UPDATE (with new hash)  
✅ New docs logged as NEW  
✅ Dry run mode prints SKIP/NEW/UPDATE without DB mutations  
✅ Running ingestion twice on same KB is fast (<10% of original time)

---

## Files to Modify

1. **EDIT:** `apps/api/src/scripts/ingest-kb.ts` (add normalization, SKIP logic)

---

## Testing Commands

```bash
# Full ingestion (first time)
npm run kb:ingest

# Full ingestion (second time - should be fast with SKIPs)
npm run kb:ingest

# Dry run (preview changes)
npm run kb:dry

# Wipe and re-ingest (for testing)
npm run kb:ingest -- --wipeChunks --confirmWipe
```

---

## Performance Expectations

**Before:** Re-ingesting 100 docs with no changes takes ~10 minutes (re-chunks, re-embeds all)

**After:** Re-ingesting 100 unchanged docs takes ~30 seconds (SKIPs all, only DB lookups)

---

## Questions / Blockers

- **Normalization rules?** Should we also normalize casing or punctuation? (Currently: no)
- **frontmatter handling?** Does `gray-matter` strip frontmatter before hashing? (Yes)
- **Checkpoint interaction?** Should SKIP docs update checkpoint? (Yes, to track progress)

---

## Notes

- Keep existing `--wipeChunks` flag for force-refresh scenarios
- SKIP logic only applies when `status='active'` (don't skip deprecated docs)
- Hash collisions are negligible with SHA-256 (first 16 chars = 64 bits)
