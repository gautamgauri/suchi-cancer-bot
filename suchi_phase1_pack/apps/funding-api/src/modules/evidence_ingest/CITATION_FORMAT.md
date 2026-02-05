# Citation / Attribution Format (P2-05)

## Machine format (API / parser)

- **Format:** `[citation:docId:chunkId]`
- **docId:** Evidence document UUID (same as `source` in retrieval response).
- **chunkId:** Document chunk UUID (same as `id` in retrieval response).

The draft/need-statement API expects chunks with `id` (chunk id) and `source` (doc id). Every factual claim in the model output should use this exact format so responses can be traced to the exact chunk(s).

## Human-readable attribution

- **Format:** `[DocName — Section/Chunk — Year]`
- **Example:** `[Annual Report 2023 — Outcomes — 2023]`

Use for display in UI or exports. Map from `docId`/`chunkId` using document `name`, chunk `sectionTitle`, and document `modifiedTime` year.

## Policy

- **Tier A:** Citations may be used as hard claims (numbers, outcomes, scale).
- **Tier B/C:** Phrase as “historical context suggests…” unless corroborated by Tier A. Use `claimType` from retrieval (`hard` vs `context`) to enforce in prompts.
