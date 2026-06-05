# Content Page Schema

**Version:** 1.0
**Status:** Draft for review
**Owner:** SCCF / Suchi product
**Related docs:** `SUCHI_KNOWLEDGE_HUB_IA.md`, `CGP_v0.2_SCHEMAS.md`
**Anchored to:** Astro 5 content collections; the existing landing app at `apps/landing/`

## 1. Purpose

The page artifact is **the contract** between the Content Generation Pipeline (CGP) and the website renderer. It is:

- a single Markdown file
- with a strict YAML frontmatter block
- conforming to the Astro content-collection schema below
- evaluable by the existing rubric pack (`eval/rubrics/rubrics.v1.json`) without modification

One file is the canonical form for both: (a) Astro static-site rendering at `suchitracancercare.org`, and (b) RAG retrieval by the chatbot at `chat.suchitracancercare.org`.

## 2. File Location

All pipeline-generated articles live at:

```
apps/landing/src/content/articles/{slug}.md
```

The Astro content collection is declared in:

```
apps/landing/src/content/config.ts   # NEW — to be added
```

Per the Astro deploy workflow (`.github/workflows/deploy-landing.yml`), pushing a commit that touches `apps/landing/**` to `main` triggers a Pages build. So the publisher step is: write file → git commit → git push.

## 3. Astro Content Collection Schema

The collection definition (TypeScript, lives at `apps/landing/src/content/config.ts`):

```typescript
import { defineCollection, z } from 'astro:content';

const CONTENT_TYPES = [
  'cancer_type', 'symptom', 'test', 'treatment', 'side_effect',
  'journey', 'find_care', 'meta', 'resource',
] as const;

// Canonical article lifecycle (FR-CONTENT-012 / OD-002).
// 'safety_checked' is intentionally omitted — the article pipeline has no discrete safety-gate step.
const REVIEW_STATUSES = [
  'ai_draft', 'sent_for_review', 'approved', 'rejected', 'published', 'archived',
] as const;

// Cancer-type IDs — must stay in sync with apps/landing/src/content/videos.json's cancerTypes[].
// When adding new IDs, update both files in the same PR.
const CANCER_TYPE_IDS = [
  'breast', 'oral', 'prostate', 'ovarian', 'lung', 'colorectal',
  'pediatric', 'general',
  // Phase 2 extensions (must also be added to videos.json):
  'cervical', 'leukemia', 'lymphoma', 'head-and-neck',
] as const;

const SITUATION_IDS = [
  'newly-diagnosed', 'treatment-choices', 'side-effects',
  'caregiving', 'prevention',
] as const;

const articleSchema = z.object({
  // ── Identity ────────────────────────────────────────────────────────
  schema_version: z.literal('1.0'),
  page_id: z.string().regex(/^[a-z0-9-]+$/),  // kebab-case
  title: z.string().min(1).max(120),
  summary: z.string().min(20).max(300),
  content_type: z.enum(CONTENT_TYPES),

  // ── Audience + locale ───────────────────────────────────────────────
  locale: z.enum(['en', 'hi', 'hinglish']).default('en'),
  geo_relevance: z.array(z.string()).default(['IN-pan']),
  audience: z.array(z.enum(['patient', 'caregiver', 'general'])).min(1),

  // ── Lifecycle ───────────────────────────────────────────────────────
  last_reviewed: z.coerce.date(),
  review_status: z.enum(REVIEW_STATUSES).default('ai_draft'),
  version_id: z.string(),                     // semver + date + run_id

  // ── Provenance ──────────────────────────────────────────────────────
  provenance: z.object({
    generator_model: z.string(),
    generator_run_id: z.string(),
    pipeline_version: z.string().default('0.2'),
    source_chunks: z.array(z.object({
      doc_id: z.string(),
      chunk_id: z.string(),
      source: z.enum(['NCI', 'kb_local', 'CRUK', 'Macmillan']),
    })).min(1),
    eval_scores: z.object({
      overall: z.number().min(0).max(1),
      safety: z.number().min(0).max(1),
      grounding: z.number().min(0).max(1),
      completeness: z.number().min(0).max(1),
      actionability: z.number().min(0).max(1).optional(),
    }).optional(),
    reviewer_log: z.array(z.object({
      iteration: z.number(),
      fixes_applied: z.number(),
      passed: z.boolean(),
    })).optional(),
    human_qa: z.object({
      reviewer: z.string(),
      decision: z.enum(['approve', 'flag', 'reject']),
      notes: z.string().optional(),
      timestamp: z.coerce.date(),
    }).optional(),
    safety_violations: z.array(z.string()).optional(),
  }),

  // ── Cross-references ────────────────────────────────────────────────
  related_pages: z.array(z.string()).default([]),  // slugs of related articles
  redirects_from: z.array(z.string()).default([]), // old URLs to redirect

  // ── Tags / taxonomy ─────────────────────────────────────────────────
  tags: z.object({
    cancer_types: z.array(z.enum(CANCER_TYPE_IDS)).default([]),
    situations: z.array(z.enum(SITUATION_IDS)).default([]),
    topics: z.array(z.string()).default([]),       // free-form (e.g., "biopsy", "screening")
    clinical_category: z.string().optional(),       // e.g., "head_and_neck"
  }),

  // ── Display flags ───────────────────────────────────────────────────
  featured: z.boolean().default(false),
  hide_from_index: z.boolean().default(false),
});

export const collections = {
  articles: defineCollection({ type: 'content', schema: articleSchema }),
};
```

## 4. Required Sections by `content_type`

**Canonical source:** [`docs/CONTENT_GUIDE.md`](CONTENT_GUIDE.md) — that document defines the required H2 sections, their order, minimum word counts, and Bihar-localisation rules for each `content_type`. This schema document does not duplicate those templates.

> **Why CONTENT_GUIDE.md is canonical:** It was written for the Bihar/pan-India patient-first audience and is the document editors, AI prompts, and the eval gate all reference. Maintaining a separate section table here caused drift (OD-005, now closed).

## 5. Hard Validation Rules

These rules are enforced by the CGP Safety layer (Module 5) and Eval gate (Module 7). A page violating any **hard fail** check is rejected. **Soft pass** thresholds contribute to the overall pass/fail decision but are not individual blockers.

### Hard fail (must pass at 1.0)

| Rule | How checked | Rubric anchor |
|---|---|---|
| Top-of-page disclaimer matches an approved pattern | regex_match_any | `eval/rubrics/rubrics.v1.json → global.disclaimer.patterns_any` |
| No prohibited diagnosis-language phrase appears | regex_absence | `global.prohibited_diagnosis_language.patterns_any` |
| Numeric urgency timeframe present (where required by `content_type`) | regex_match_any: `\b\d+\s+(week|day|hour|month)s?\b`, `≥\s*\d+°[FC]` | New: `cgp.urgency_timeline` |
| Indian context block present (where required) | regex_match_any: `(PMJAY\|Ayushman\|1800-22-1951\|108\|112)` | New: `cgp.indian_context` |
| Cancer-specific mandatory terms appear (where applicable) | regex_match_all per cancer type | Existing: `prompts/explain-mode.md` rules |
| All `related_pages` slugs resolve to existing articles | post-build cross-ref check | New: `cgp.cross_ref_resolution` |
| `provenance.source_chunks` is non-empty | schema validation | Schema |

### Soft pass (weighted)

| Check | Threshold | Rubric anchor |
|---|---|---|
| Citation density (medical-claim sentences ending in `[citation:doc_id:chunk_id]`) | ≥ 0.7 for `cancer_type`/`symptom`/`treatment`; ≥ 0.5 for `journey`/`meta`/`resource` | Existing: `citations_present`, `citation_confidence_acceptable` |
| Warning-signs coverage | ≥ 0.85 (where required) | Existing: `warning_signs_coverage` |
| Tests coverage | ≥ 0.80 (where required) | Existing: `tests_coverage` |
| Doctor-questions present (≥ 3 questions) | ≥ 0.80 | Existing: `doctor_questions` |
| RAG-backed content ratio | ≥ 0.85 | Existing: `rag_backed_content` |
| Reading level (Flesch-Kincaid) | ≤ Class 8 | New: `cgp.reading_level` |

**Overall pass:** all hard-fail checks pass at 1.0 AND weighted soft-pass score ≥ 0.88.

## 6. Citation Format

Citations appear inline at the end of medical-claim sentences:

```markdown
A biopsy may be recommended to confirm the diagnosis [citation:nci.oral-cancer-pdq:c042].
```

- `doc_id` references a document the RAG layer indexes (e.g., `nci.oral-cancer-pdq.symptoms`).
- `chunk_id` references a specific chunk within that document.
- Multiple citations on the same sentence are stacked: `[citation:a:c1] [citation:b:c2]`.
- Sentences about emotion, organization, or general advice DO NOT need citations. Examples:
  - ❌ "A family member can help. [citation:...]" — no citation needed
  - ✅ "Surgery may be used to remove the tumor [citation:nci.oral.treatment:c019]." — citation needed

A `Sources` section MAY be rendered at the bottom of the article by the publisher; the rendered list is derived from `provenance.source_chunks` plus inline `[citation:...]` markers, deduplicated by `doc_id`.

## 7. Worked Example — Frontmatter

Concrete frontmatter for a Stage-1 page:

```yaml
---
schema_version: "1.0"
page_id: oral-cancer
title: "Oral Cancer: Signs, Diagnosis, and Treatment Basics"
summary: >
  Oral cancer is a cancer that begins in the mouth or lip. Early signs include
  non-healing mouth ulcers, persistent red or white patches, or unusual lumps.
  This page explains warning signs, when to seek care, how it is diagnosed,
  and what treatment usually involves.
content_type: cancer_type

locale: en
geo_relevance: ["IN-pan", "IN-BR"]
audience: ["patient", "caregiver"]

last_reviewed: 2026-04-28
review_status: ai_draft
version_id: "v1.0.0-2026-04-28-cgp-001"

provenance:
  generator_model: gemini-2.5-flash
  generator_run_id: cgp-2026-04-28-001
  pipeline_version: "0.2"
  source_chunks:
    - doc_id: nci.oral-cancer-pdq.symptoms
      chunk_id: c042
      source: NCI
    - doc_id: nci.oral-cancer-pdq.diagnosis
      chunk_id: c019
      source: NCI
    - doc_id: kb.bihar-cancer-navigation-guide
      chunk_id: c003
      source: kb_local
  eval_scores:
    overall: 0.91
    safety: 1.00
    grounding: 0.93
    completeness: 0.88
    actionability: 0.85

related_pages:
  - persistent-mouth-ulcer
  - what-to-do-after-cancer-diagnosis
  - questions-to-ask-your-doctor

tags:
  cancer_types: ["oral"]
  situations: ["newly-diagnosed"]
  topics: ["symptoms", "diagnosis", "treatment"]
  clinical_category: head_and_neck

featured: false
---
```

## 8. URL Routing in Astro

Article URLs follow `/cancer-types/{slug}/`, `/symptoms/{slug}/`, etc., based on `content_type`. The mapping is in the dynamic route file:

```
apps/landing/src/pages/[content_type]/[slug].astro   # NEW — to be added
```

Implementation (illustrative):

> **Astro hoisting note:** `getStaticPaths()` is hoisted out of the component
> scope at build time, so it cannot reference module-scope helpers declared
> in the same file. Inline the `contentTypeToUrlSegment` map directly inside
> `getStaticPaths()` (and again in the page-body scope if needed for rendering
> related-page links). Or pull the helper into a separate `.ts` file and
> import it.

```typescript
// In the dynamic route file
import { getCollection } from 'astro:content';

export async function getStaticPaths() {
  const articles = await getCollection('articles');
  // Inline the map here — getStaticPaths is hoisted; can't reference
  // module-scope `contentTypeToUrlSegment` directly.
  const map = {
    cancer_type: 'cancer-types',
    symptom: 'symptoms',
    test: 'tests-treatment/diagnosis-tests',
    treatment: 'tests-treatment/treatments',
    side_effect: 'tests-treatment/side-effects',
    journey: 'living-with-cancer',
    find_care: 'find-care',
    meta: 'resources',
    resource: 'resources',
  };
  return articles.map(article => ({
    params: {
      content_type: map[article.data.content_type],
      slug: article.data.page_id,
    },
    props: { article },
  }));
}

// Module-scope helper (usable in the page body, NOT inside getStaticPaths)
function contentTypeToUrlSegment(t) {
  const map = {
    cancer_type: 'cancer-types',
    symptom: 'symptoms',
    test: 'tests-treatment/diagnosis-tests',
    treatment: 'tests-treatment/treatments',
    side_effect: 'tests-treatment/side-effects',
    journey: 'living-with-cancer',
    find_care: 'find-care',
    meta: 'resources',
    resource: 'resources',
  };
  return map[t];
}
```

## 9. Tag Taxonomy Sync

The `cancer_types[]` and `situations[]` enums in this schema MUST stay in sync with `apps/landing/src/content/videos.json`. Either file evolves; both must be updated in the same PR.

Today (v1.0):
- `cancer_types`: breast · oral · prostate · ovarian · lung · colorectal · pediatric · general · cervical (Phase 2) · leukemia (Phase 2) · lymphoma (Phase 2) · head-and-neck (Phase 2 — disambiguates from `oral`)
- `situations`: newly-diagnosed · treatment-choices · side-effects · caregiving · prevention

Adding a new tag id requires:
1. Append to `videos.json → cancerTypes[]` or `situations[]` with `{ id, label }`.
2. Append to the matching enum in `apps/landing/src/content/config.ts`.
3. Append to the constant array in this doc (Section 3).

## 10. Migration Notes

**Existing pages on the site (`/`, `/about/`, `/watch/...`)** are hardcoded `.astro` files and stay as-is. They are not part of this content collection.

**The dynamic route file** for article URLs is net-new; adding it does not break existing routes because the existing `/watch/[slug].astro` already follows the dynamic-route pattern and the new `[content_type]/[slug].astro` is at a different path.

**Header / Footer nav** in `apps/landing/src/components/Header.astro` and `Footer.astro` is hardcoded. Adding new top-level sections (Cancer Types, Symptoms, Tests & Treatment, etc.) requires manual edits in both files plus the mobile menu block. This is expected; nav is product-curated, not pipeline-generated.

## 11. Review Checklist

Before this schema is locked:

- [ ] Confirm `apps/landing/src/content/articles/` is the right path (vs e.g., `apps/landing/src/content/info/`)
- [ ] Confirm Astro version supports `z.coerce.date()` (yes — Astro 5 ships Zod that supports it)
- [ ] Decide whether `meta` and `resource` get separate sub-schemas or share `articleSchema`
- [ ] Decide whether `redirects_from` is enforced at build time (Astro doesn't ship this; would need an integration or manual `_redirects` file generation)
- [ ] Decide on `Sources` block rendering policy (always show / show on demand / hide)
- [ ] Lock the URL segment map in Section 8 (especially the `tests-treatment/diagnosis-tests` triple-segment)

Once locked, this schema can be committed to `apps/landing/src/content/config.ts` and the first page (`/cancer-types/oral-cancer/`) can be generated.
