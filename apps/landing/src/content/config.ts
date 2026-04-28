import { defineCollection, z } from 'astro:content';

const CONTENT_TYPES = [
  'cancer_type', 'symptom', 'test', 'treatment', 'side_effect',
  'journey', 'find_care', 'meta', 'resource',
] as const;

const REVIEW_STATUSES = [
  'ai_draft', 'reviewed', 'published', 'flagged',
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
    // Sections where Module 3 (RAG retrieval) returned insufficient evidence
    // and the generator left a {{MISSING_EVIDENCE}} placeholder. Inline
    // placeholders are stripped from public render by the remark plugin;
    // this structured list is what review tools and human QA consume.
    gaps: z.array(z.object({
      section: z.string(),
      description: z.string(),
    })).optional(),
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
