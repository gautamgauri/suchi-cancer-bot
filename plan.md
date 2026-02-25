# Plan: Fix Funding Bot Output — Content Quality & Depth

## Problem Summary
The proposal bot produces output that reads too generic and boilerplate compared to a manually-written proposal. Sections lack org-specific depth, don't sound like a real Indian NGO proposal, and fail to weave evidence into compelling narrative.

## Root Cause Analysis (from code review)

| # | Root Cause | Location | Impact |
|---|-----------|----------|--------|
| 1 | **Evidence chunks truncated to 800 chars** | `section-writer.service.ts:42` | The LLM only sees a fragment of each evidence document — not enough to write rich, contextual narrative |
| 2 | **Section writer prompt is instruction-heavy but lacks examples** | `section-writer.prompt.ts` | Tells the LLM what to include but never shows what a well-written section looks like — leads to checkbox-style output |
| 3 | **Model is `deepseek-chat`** for all stages | `proposal.service.ts:188-191` | Cheaper model produces more formulaic, less nuanced prose |
| 4 | **Org profile is a bulleted factsheet, not narrative** | `org-profile.ts` | The LLM mirrors the input format — gets bullets in, writes bullets out, rather than weaving facts into a story |
| 5 | **Section guidance is generic defaults** | `section-writer.prompt.ts:133-298` | The "REQUIRED for this section" blocks read like checklists, so the LLM outputs checklist-style content |
| 6 | **No "voice and tone" instruction** | `section-writer.prompt.ts:6-55` | Missing: write in first person plural ("we"), use active voice, lead with impact, keep paragraphs under 4 sentences |
| 7 | **Activity facts injected as raw JSON** | `proposal.service.ts:521` | `JSON.stringify(activityFacts, null, 2)` dumps raw JSON into the prompt — LLM often copies it verbatim or awkwardly references it |
| 8 | **Template fallback is very thin** | `section-writer.service.ts:110-153` | When no evidence is found, the fallback barely uses org context |

## Implementation Plan

### Step 1: Improve Section Writer System Prompt — Voice & Tone
**File:** `section-writer.prompt.ts` (SECTION_WRITER_SYSTEM_PROMPT)

Add a WRITING STYLE block to the system prompt:
```
WRITING STYLE (CRITICAL — this is what separates a bot draft from a fundable proposal):
- Write in first person plural ("We", "Our team", "Diksha Foundation proposes...")
- Lead every section with a compelling 1-2 sentence hook that states the impact, not the process
- Use active voice: "We train 8 Fellow Teachers" not "8 Fellow Teachers are trained"
- Weave statistics INTO narrative sentences: "Our 3 KHEL centers serve 476 children across Patna, Bihta and Sarairanjan" — NOT a standalone bullet
- Each paragraph should flow: Context → Action → Evidence → Outcome
- Keep paragraphs 3-4 sentences max; use subheadings for readability
- Bihar-specific framing: reference NEP 2020, state education challenges, local geography by name
- Do NOT produce bullet-only sections. Funders want to read narrative prose with bullets only for tables, lists of deliverables, or enumerations
- Avoid hollow phrases: "holistic approach", "sustainable impact", "transformative change" — replace with SPECIFIC descriptions of what happens
```

### Step 2: Increase Evidence Chunk Size
**File:** `section-writer.service.ts:42`

Change `chunk.content.substring(0, 800)` → `chunk.content.substring(0, 2000)`

This gives the LLM 2.5x more context per evidence chunk to draw from, enabling richer narrative grounding. The trade-off (more tokens per section) is worth it for quality.

### Step 3: Convert Activity Facts from JSON to Narrative
**File:** `proposal.service.ts:519-525`

Replace the raw `JSON.stringify(activityFacts)` injection with a helper function that converts activity facts into readable narrative paragraphs. Create a new function `formatActivityFactsAsNarrative()` in `proposal.service.ts` or a utils file:

```typescript
private formatActivityFactsAsNarrative(facts: Record<string, unknown>): string {
  // Convert structured facts into prose paragraphs that the LLM can naturally weave into sections
  // e.g., "Across our 3 centers (KHEL Patna, KHEL Bihta, KHEL Sarairanjan), we currently serve 476 students..."
}
```

### Step 4: Enrich Org Profile from Factsheet to Narrative
**File:** `org-profile.ts`

Transform `DIKSHA_ORG_PROFILE` from a bulleted factsheet into a 2-paragraph narrative summary that models the writing style we want the LLM to produce. Keep the same facts but wrap them in proposal-quality prose. The LLM will mirror this tone.

### Step 5: Improve Section-Type Guidance from Checklists to Instructions
**File:** `section-writer.prompt.ts` (SECTION_TYPE_GUIDANCE)

For the 3 most impactful section types (need, projectDesign, objectives), rewrite the guidance to include a brief "golden paragraph" example showing what good output looks like. This gives the LLM a concrete quality target. Keep the required-fields list but prefix each section type with a 3-4 sentence example.

### Step 6: Make LLM Model Configurable with a Quality Tier
**File:** `proposal.service.ts:186-192`

Add an environment variable `PROPOSAL_LLM_MODEL` (default: `deepseek-chat`) so users can upgrade the writer model without code changes. Document that `claude-sonnet-4-20250514` or `gpt-4o` produce significantly better narrative quality.

### Step 7: Strengthen Template Fallback
**File:** `section-writer.service.ts:110-153`

When no evidence is retrieved, the current fallback barely uses org context. Improve it to:
- Always inject the full org profile + activity facts
- Use section-type-specific guidance
- Include the proposal scope for consistency
- Use a more detailed system prompt that instructs the LLM to write as if it had evidence

---

## Files Modified (summary)

| File | Change Type |
|------|------------|
| `apps/funding-api/src/modules/proposal/prompts/section-writer.prompt.ts` | Major: voice/tone instructions + example-enriched guidance |
| `apps/funding-api/src/modules/proposal/services/section-writer.service.ts` | Medium: increase chunk size, improve template fallback |
| `apps/funding-api/src/modules/proposal/proposal.service.ts` | Medium: narrative activity facts, configurable model |
| `apps/funding-api/src/modules/proposal/prompts/org-profile.ts` | Medium: narrative rewrite |

## Non-goals (out of scope)
- Eval harness fixes (the eval report shows infra failures, not content issues)
- Budget JSON rendering changes
- Citation integrity changes
- Frontend/web app changes
- Database schema changes

## Risk Assessment
- **Low risk:** Steps 1, 2, 5, 6 are prompt/config changes — no logic change, easy to revert
- **Medium risk:** Steps 3, 4 change the input format to the LLM — could affect downstream parsing if not careful
- **Low risk:** Step 7 only affects the no-evidence fallback path
