# DevOps GCP Deployer Agent Instructions

**Role:** Infrastructure & Deployment Specialist  
**Current Assignment:** Trust-First RAG v2 - Phase 1 (Ingestion Workstream - Optional)  
**Handoff Document:** `docs/ops/handoffs/2026-01-20-retrieval-engineer-ingestion-hashing.md`

---

## Your Mission (Optional)

Implement idempotent KB ingestion with content hashing to skip unchanged documents. This improves operational efficiency but is not critical path for Phase 1.

**Note:** This workstream can be handled by @retrieval-engineer if you're unavailable.

---

## Step-by-Step Instructions

### STEP 1: Read Your Handoff Document
```bash
# Open and read carefully
code docs/ops/handoffs/2026-01-20-retrieval-engineer-ingestion-hashing.md
```

**Key sections to understand:**
- Context: Current ingestion always re-processes all docs
- Tasks 1-5: Normalization, hashing, SKIP logic
- Acceptance Criteria: Fast re-runs when KB unchanged

### STEP 2: Add Content Normalization Function

**File:** `apps/api/src/scripts/ingest-kb.ts`

Add this function after imports (around line 30):

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

### STEP 3: Update Hash Computation with SKIP Logic

**File:** `apps/api/src/scripts/ingest-kb.ts`

Find the `ingestDoc` function (around line 168) and modify:

1. **Before chunking**, normalize content and compute hash:

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

  const sourceInfo = `[${doc.sourceType || "unknown"}] ${doc.source || "Unknown"}`;
  
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
    console.log(`  ⏭️  SKIP ${doc.id} ${sourceInfo} (unchanged hash: ${versionHash})`);
    return; // Early return
  }

  // Document is NEW or UPDATED - proceed with chunking
  const logPrefix = existingDoc ? 'UPDATE' : 'NEW';
  console.log(`  ${logPrefix} ${doc.id} ${sourceInfo} (hash: ${versionHash})`);

  // Continue with existing chunking logic...
  const chunks = chunkMarkdown(normalizedContent, opts.maxChunkChars, opts.overlapChars);
  
  console.log(`[DOC] ${doc.id}  ${sourceInfo}  (${chunks.length} chunks)`);
  if (opts.dryRun) return;

  // ... rest of existing upsert logic continues unchanged ...
```

2. **Update the existing versionHash line** (around line 187) - it should now use `versionHash` already computed above, so remove any duplicate hash computation.

### STEP 4: Verify Dry Run Behavior

The existing dry run logic should work correctly with the new SKIP logic. Verify that:

1. SKIP detection runs even in dry run mode
2. Dry run logs show SKIP/NEW/UPDATE without mutations
3. Dry run returns early after logging (no DB writes)

The code should already handle this correctly with the existing:
```typescript
if (opts.dryRun) return;
```

### STEP 5: Test Idempotent Ingestion

**Test 1: First run (everything should be NEW or UPDATE)**

```bash
cd apps/api

# Full ingestion
npm run kb:ingest

# Note the execution time
# Expected: All docs show "NEW" or "UPDATE"
```

**Test 2: Second run (everything should SKIP)**

```bash
# Run again with no KB changes
npm run kb:ingest

# Expected output:
#   ⏭️  SKIP doc-001 [02_nci_core] NCI Core (unchanged hash: abc123456789abcd)
#   ⏭️  SKIP doc-002 [01_suchi_oncotalks] Suchi Oncotalks (unchanged hash: def456789012def4)
#   ...
#   ✓ Ingestion complete!

# Execution time should be much faster (90% reduction)
```

**Test 3: Dry run preview**

```bash
# Make a small edit to ONE KB file (add a line or change text)

# Dry run to preview
npm run kb:dry

# Expected output:
#   [DRY RUN] UPDATE doc-001 [02_nci_core] NCI Core (hash: xyz789..., 15 chunks)
#   ⏭️  SKIP doc-002 [01_suchi_oncotalks] Suchi Oncotalks (unchanged hash: def456...)
#   ⏭️  SKIP doc-003 [03_who_public_health] WHO (unchanged hash: ghi789...)
#   ...

# Should show which docs changed without actually ingesting
```

**Test 4: Verify chunk counts unchanged**

```bash
# Before second run
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"KbChunk\";"

# After second run with all SKIPs
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"KbChunk\";"

# Counts should be identical
```

### STEP 6: Performance Validation

Measure and document:

**Before optimization:**
- 100 docs, 2000 chunks, all re-processed: ~10-15 minutes

**After optimization (unchanged KB):**
- 100 docs, 2000 chunks, all SKIP: ~30-60 seconds
- **~90-95% time reduction**

Document actual numbers in your test results.

---

## Success Checklist

Before marking your work complete, verify:

- [ ] `normalizeContent()` function added
- [ ] Hash computed from normalized content (not raw)
- [ ] SKIP logic checks `versionHash` and `status='active'`
- [ ] SKIP logs show clear message with hash
- [ ] NEW/UPDATE logs distinguish between create and update
- [ ] Dry run shows accurate preview without mutations
- [ ] Running ingestion twice on unchanged KB: all SKIPs
- [ ] Performance improvement: 90%+ time reduction on re-run
- [ ] No TypeScript errors
- [ ] No breaking changes to existing ingestion

---

## Additional Notes

### Why Normalize Before Hashing?

Without normalization, trivial formatting changes (extra blank lines, trailing spaces, different line endings) would cause unnecessary re-ingestion. Normalization ensures hash only changes when actual content changes.

### When Does SKIP Not Apply?

SKIP logic is bypassed when:
- `--wipeChunks` flag is set (force refresh)
- Document status is not 'active' (deprecated docs always re-process)
- `versionHash` field is null/missing (legacy documents)

### Migration Path for Existing Data

Existing documents without `versionHash` will be treated as NEW on first run after this change:
1. First run: All existing docs get `versionHash` populated (UPDATE)
2. Second run onwards: SKIP works as expected

---

## If You Get Stuck

**Common Issues:**

1. **All docs show UPDATE on second run:** Check hash computation using normalized content
2. **Dry run not working:** Ensure early return after logging in dry run mode
3. **Hashes keep changing:** Verify normalization removes all formatting variations
4. **Performance not improved:** Check that SKIP actually returns early (before chunking)

**Get Help:**
- Review handoff document for more details
- Check existing ingestion flow for patterns
- Test normalization function in isolation
- Ask orchestrator for clarification

---

## When Complete

1. Update TODO status
2. Document performance improvements in PR description
3. Coordinate with orchestrator for final integration
4. Optional: Add monitoring for SKIP/NEW/UPDATE ratios

This optimization makes KB maintenance much more efficient!
