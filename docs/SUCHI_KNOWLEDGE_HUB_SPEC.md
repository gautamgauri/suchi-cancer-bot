# Suchi Knowledge Hub -- Synthesized Specification

Working spec for the SCCF patient-facing cancer information website, powered by the Suchi Knowledge Base and chatbot infrastructure.

## 1. Executive Summary

The Suchi Knowledge Hub is a static-content cancer information website that converts NCI (National Cancer Institute) source material into structured, patient-friendly web pages. It serves two purposes: (a) SEO-discoverable cancer information targeting Indian patients, and (b) a funnel into the Suchi chatbot for personalized Q&A. All content is synthesized from the existing 581-article NCI corpus using Gemini, validated through the existing safety module and eval harness -- zero free generation.

## 2. Information Architecture

### Site Map

```
/                        Home (hero + top cancers + Ask Suchi CTA)
/cancer/{type}/          Cancer type guide (e.g. /cancer/breast/)
/symptoms/{symptom}/     Symptom page (e.g. /symptoms/persistent-mouth-ulcer/)
/treatment/{treatment}/  Treatment overview (e.g. /treatment/chemotherapy/)
/ask-suchi               Embedded chatbot (existing apps/web)
/about                   About SCCF + disclaimers
/urgent-help             Emergency numbers, PM-JAY, Indian Cancer Society
```

### URL Structure

- Slugs: kebab-case, English-first. Hindi pages at `/hi/cancer/{type}/` (Phase 2).
- Canonical URLs: `https://suchicancer.org/cancer/{type}/`
- Each page has a `?ask` param that deep-links into Ask Suchi with context pre-filled.

### Navigation

Top nav: Home | Cancer Types | Symptoms | Treatment | Ask Suchi | Urgent Help

## 3. Content Model

### Content Types

| Type | Source | Count (MVP) | Template |
|------|--------|-------------|----------|
| Cancer guide | NCI cancer-types | 20 | Full page template |
| Symptom page | NCI + `02_symptoms-next-steps` | 10 | Symptom template |
| Treatment overview | NCI treatment | 5 | Treatment template |

### Page Template (Cancer Guide)

1. Disclaimer banner
2. What is {cancer type}?
3. Common Warning Signs
4. Risk Factors
5. How is it diagnosed?
6. Treatment Options
7. Stages Explained Simply
8. When to Seek Medical Attention
9. Questions to Ask Your Doctor
10. Where to Get Help in India (helplines: 1800-22-1951, PM-JAY 14555, 112/108)
11. Sources (NCI citations with URLs)
12. Ask Suchi CTA

This template is already implemented in `scripts/content-generator/nci-to-website.ts` via `renderMarkdown()`.

### Taxonomy

- **Cancer type**: breast, oral, cervical, lung, colorectal, etc. (from `manifest.json` cancerTypes)
- **Audience**: patient (default), caregiver (Phase 2)
- **Geography**: India-specific helplines and navigation resources baked into every page
- **Language**: English (MVP), Hindi (Phase 2)

## 4. Content Generation Pipeline

The pipeline exists at `scripts/content-generator/nci-to-website.ts`. Flow:

```
manifest.json (topic registry)
  -> findDocsForCancerType() -- select NCI articles by cancer type
  -> classifyDocs() -- bucket into overview/symptoms/risk/diagnosis/treatment/staging/coping
  -> loadCategoryContent() -- read markdown, strip images, cap at 30K chars
  -> buildSynthesisPrompt() -- construct Gemini prompt with safety rules
  -> callGemini() -- Vertex AI, gemini-2.0-flash, temp=0.2, JSON output
  -> JSON.parse() -- StructuredPage schema
  -> renderMarkdown() -- patient-friendly markdown with template sections
  -> runSafetyChecks() -- regex scan for prognosis percentages, diagnostic language
  -> write to kb/en/website/{type}-guide.md
```

### Safety Rules (enforced in prompt + post-processing)

- Every fact must trace to provided NCI source material
- No survival rates, prognosis percentages, or life expectancy
- No diagnostic language ("you have cancer")
- Uncertainty language required ("may", "can", "some people experience")
- Missing evidence sections marked `{{MISSING_EVIDENCE}}` rather than fabricated
- Post-generation regex scan via `runSafetyChecks()` catches violations

### CLI Usage

```bash
# Inventory available cancer types from manifest
npx ts-node scripts/content-generator/nci-to-website.ts --inventory

# Dry run (no LLM call)
npx ts-node scripts/content-generator/nci-to-website.ts --cancer breast --dry-run

# Generate
npx ts-node scripts/content-generator/nci-to-website.ts --cancer breast --verbose
```

## 5. Page Template Schema

The `StructuredPage` interface (already in `nci-to-website.ts`):

```json
{
  "cancerType": "string (slug)",
  "displayName": "string (human-readable)",
  "whatIs": "string (2-3 sentences)",
  "warningSignsSigns": ["string"],
  "riskFactors": ["string"],
  "diagnosis": "string (paragraph)",
  "treatmentOptions": "string (paragraph)",
  "stagesExplained": "string (plain language)",
  "whenToSeekHelp": "string (specific symptoms + timeframes)",
  "questionsToAsk": ["string"],
  "sources": [{"title": "string", "url": "string"}]
}
```

Fields with no NCI evidence return `{{MISSING_EVIDENCE}}` (strings) or `[]` (arrays).

## 6. MVP Scope

### Cancer Type Pages (20)

Oral, breast, cervical, lung, colorectal, stomach, liver, esophageal, gallbladder, ovarian, prostate, leukemia, lymphoma, thyroid, bladder, kidney, pancreatic, brain, head-and-neck, blood.

Selection criteria: top Indian cancer incidence + existing NCI coverage in `kb/en/02_nci_core/cancer-types/` (581 articles).

### Symptom Pages (10)

Persistent mouth ulcer, lump in breast, blood in stool, unexplained weight loss, difficulty swallowing, persistent cough, unusual bleeding, skin changes, fatigue, swollen lymph nodes.

### Static Pages (3)

Home, About/Disclaimer, Urgent Help.

**Total MVP: 33 pages.**

## 7. Technical Integration

- **Content storage**: Generated pages land in `kb/en/website/` as markdown
- **KB manifest**: Each generated page gets a manifest entry (sourceType: `website`, status: `review`)
- **Embeddings**: Generated pages can be ingested into pgvector alongside NCI articles for RAG
- **Ask Suchi widget**: Embedded `apps/web` build on each page, pre-seeded with cancer type context
- **Hosting**: Static site generator (Astro or Next.js export) deployed to Cloud Run or Cloud Storage + CDN
- **Existing infra**: Same GCP project (`gen-lang-client-0202543132`), same Gemini credits

## 8. Quality Assurance

| Gate | Tool | Criteria |
|------|------|----------|
| Safety scan | `runSafetyChecks()` in pipeline | Zero prognosis percentages, zero diagnostic language |
| Missing evidence | `{{MISSING_EVIDENCE}}` markers | All marked sections require manual fill or removal before publish |
| Eval harness | `eval/` framework | Generated pages run through existing rubrics for factual accuracy |
| Human QA | Checklist | Medical advisor reviews each page before publish; sign-off logged |

### Human QA Checklist

- [ ] All facts traceable to NCI source
- [ ] No survival statistics or prognosis
- [ ] India helplines current and correct
- [ ] Reading level appropriate (6th grade)
- [ ] No `{{MISSING_EVIDENCE}}` markers remain
- [ ] Ask Suchi CTA functional

## 9. Multi-Format Strategy (Phase 2+)

Same `StructuredPage` JSON drives multiple outputs:

| Format | Use Case | Renderer |
|--------|----------|----------|
| Website markdown | SEO pages | `renderMarkdown()` (exists) |
| WhatsApp card | Screening camp follow-up | Template with whatIs + warningSignsSigns + helplines |
| PDF brochure | Print for clinics | LaTeX or Puppeteer from JSON |
| Voice script | Chirp 3 HD TTS | Simplified text from whatIs + whenToSeekHelp |
| Video script | YouTube shorts | whatIs + warningSignsSigns + questionsToAsk |

No new LLM calls needed -- all formats are deterministic renders of the same structured JSON.

## 10. SEO Strategy

**Target queries** (Indian cancer search patterns):
- "{cancer type} symptoms in Hindi/English"
- "mouth ulcer cancer signs"
- "{cancer type} treatment in India"
- "what to do after cancer diagnosis"
- "cancer hospital near me" (redirects to Find Care / Urgent Help)

**Technical SEO**: Schema.org MedicalCondition markup, hreflang for Hindi, sitemap.xml, meta descriptions from `whatIs` field.

**Content velocity**: 20 pages at launch captures long-tail cancer queries with low competition in Indian English search.

## 11. Phasing

| Phase | Timeline | Scope |
|-------|----------|-------|
| MVP | Weeks 1-3 | 20 cancer guides + 10 symptom pages + 3 static pages. Pipeline proven, safety gates working. |
| Phase 2 | Month 2-3 | 50 total cancer pages, treatment pages, Hindi translations, WhatsApp card format, PDF brochures. |
| Phase 3 | Month 4+ | 200+ pages, caregiver content, video scripts, regional languages (Tamil, Bengali), Find Care with geo-lookup. |

### MVP Milestones

1. Run `--inventory` to confirm NCI coverage for 20 target cancer types
2. Generate 20 cancer guide pages with pipeline
3. Safety scan: zero violations across all pages
4. Human QA: medical advisor sign-off on all 20
5. Static site deployed to Cloud Run
6. Ask Suchi widget integrated and functional
7. Google Search Console submitted

## 12. Cost Estimate

| Item | Cost | Notes |
|------|------|-------|
| Gemini API (generation) | Rs 0 | Within Rs 5000/mo Google Developer Program credits |
| Gemini API (embeddings) | Rs 0 | Already running for RAG |
| Cloud Run (static site) | Rs 0-200/mo | Minimal traffic initially, free tier covers it |
| Domain (suchicancer.org) | Rs 800/yr | If not already owned |
| Medical advisor time | Volunteer | SCCF network |
| **Total incremental** | **~Rs 0-200/mo** | |

All infrastructure already exists. The Knowledge Hub is a content layer on top of the existing stack, not a new system.

---

*Key code paths: `scripts/content-generator/nci-to-website.ts` (pipeline), `kb/en/02_nci_core/` (NCI corpus, 581 articles), `kb/manifest.json` (topic registry), `eval/` (quality gate), `apps/api/src/modules/safety/` (safety module).*
