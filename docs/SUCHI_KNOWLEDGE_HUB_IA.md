# Suchi Knowledge Hub — Information Architecture

**Version:** 1.0
**Status:** Draft for review
**Owner:** SCCF / Suchi product
**Related docs:** `CONTENT_PAGE_SCHEMA.md`, `CGP_v0.2_SCHEMAS.md`

## 1. Purpose

Turn Suchi's RAG-backed knowledge into a **public information platform** that:

1. lets ordinary users find answers fast (search-first, low menu friction)
2. feels trustworthy and calm (consistent disclaimers, no scare language, citations available)
3. supports Eastern India / low-resource users without sounding provincial
4. produces reusable content blocks for brochures, posters, WhatsApp, and short videos
5. keeps the Suchi chatbot as an "ask me" assistant layer, not the only entry point

The IA below is the contract between content authors, the Content Generation Pipeline (CGP), and the website renderer.

## 2. Core Principle: One Content Layer, Two Surfaces

Every information page exists once, as a markdown file with structured YAML frontmatter, in this repository's `kb/en/website/` directory. From that single source:

- The **website** renders public-facing pages (suchitracancercare.org)
- The **chatbot's RAG layer** retrieves the same content for in-conversation answers

This avoids duplication, lets the same eval rubrics gate both surfaces, and makes brochure / poster / WhatsApp / video derivations cheap (they consume the same content schema).

## 3. URL Structure

```
/                                     Home — search-first entry, quick pathways, featured content
/about/                               About SCCF (existing)
/about-suchi/                         What Suchi is, methodology, safety boundaries
/about-suchi/how-it-works             How content is generated and reviewed
/about-suchi/safety                   Safety principles, what Suchi cannot do

/cancer-types/                        Disease library landing
/cancer-types/{slug}                  Per-cancer pages (e.g., /cancer-types/oral-cancer)

/symptoms/                            Symptom library landing
/symptoms/{slug}                      Per-symptom pages (e.g., /symptoms/persistent-mouth-ulcer)

/tests-treatment/                     Tests + treatment landing
/tests-treatment/diagnosis-tests/{slug}    Per-test pages (e.g., /tests-treatment/diagnosis-tests/biopsy)
/tests-treatment/treatments/{slug}         Per-treatment pages (e.g., /tests-treatment/treatments/chemotherapy)
/tests-treatment/side-effects/{slug}       Per-side-effect pages

/living-with-cancer/                  Journey-led hub
/living-with-cancer/just-diagnosed
/living-with-cancer/during-treatment
/living-with-cancer/after-treatment
/living-with-cancer/caregiver-support
/living-with-cancer/emotional-support

/find-care/                           (Phase 1 light, Phase 2 deep) Hospital + provider navigation
/find-care/hospitals/{state}          State-level overview
/find-care/hospitals/{state}/{city}   City-level provider list
/find-care/how-to-choose
/find-care/cost-and-access

/resources/                           Library
/resources/faq
/resources/glossary
/resources/downloadables              (Phase 2)
/resources/videos                     (existing /watch/ structure remains)

/ask-suchi/                           Chatbot launcher / explainer
/urgent-help/                         Safety-critical routing (always linked from every page footer)
```

### URL conventions

- All slugs lowercase, hyphenated (`oral-cancer`, not `OralCancer`).
- No trailing-slash inconsistency: every URL ends with a trailing slash.
- Reserved slugs that must never be used as content slugs: `index`, `_assets`, `api`, `admin`, `chat`, `search`.
- Redirects from any prior URL must be specified in the page frontmatter (`redirects_from: [...]`); the build step writes the redirect map.

## 4. Content Type Taxonomy

Every page declares exactly one `content_type` in its frontmatter. The CGP uses this to pick the section template, retrieval queries, and eval rubric.

| `content_type` | Description | URL pattern | Required sections |
|---|---|---|---|
| `cancer_type` | Per-cancer disease pages | `/cancer-types/{slug}` | what_is, warning_signs, risk_factors, when_to_seek_care, diagnosis, treatment_basics, questions_to_ask, urgent_signs, ask_suchi |
| `symptom` | Per-symptom decision pages | `/symptoms/{slug}` | what_it_means, common_non_cancer_causes, when_to_seek_care, red_flags, what_doctor_will_do, questions_to_ask, urgent_signs, ask_suchi |
| `test` | Diagnostic test explainers | `/tests-treatment/diagnosis-tests/{slug}` | what_it_is, why_used, how_done, what_to_expect, results_meaning, questions_to_ask, ask_suchi |
| `treatment` | Treatment-type explainers | `/tests-treatment/treatments/{slug}` | what_it_is, why_used, how_given, common_side_effects, urgent_signs_during_treatment, prep_tips, questions_to_ask, ask_suchi |
| `side_effect` | Per-side-effect management | `/tests-treatment/side-effects/{slug}` | what_it_is, why_it_happens, severity_levels, when_to_call_doctor, self_care, questions_to_ask, ask_suchi |
| `journey` | Patient/caregiver scenario pages | `/living-with-cancer/{slug}` | situation, first_practical_steps, common_questions, india_context, when_to_seek_help, questions_to_ask, ask_suchi |
| `find_care` | Hospital / provider navigation | `/find-care/...` | overview, what_to_check_before_visiting, payment_options, urgent_signs, questions_to_ask, ask_suchi |
| `meta` | Cross-cutting helper pages | various | core_questions, treatment_questions, day_to_day, reports_planning, caregiver_questions, urgent_help, ask_suchi |
| `resource` | Glossary, FAQ, downloads | `/resources/...` | varies by sub-type |

The CGP has hard rules per `content_type`:

- `cancer_type` and `journey` MUST include Indian context (PMJAY / Indian Cancer Society 1800-22-1951 / 108 / 112).
- `cancer_type` and `treatment` MUST include numeric urgency timelines (e.g., "fever ≥100.4°F", "lasts more than 2 weeks").
- `meta` and `resource` have lighter citation density requirements (≥0.4) than `cancer_type` / `symptom` / `treatment` (≥0.7).

## 5. Cross-Reference Policy (Orthogonality)

The IA's biggest risk: Symptoms / Cancer Types / Tests / Treatment / Living With all touch the same underlying knowledge. Without an explicit canonical-home rule, content fragments into near-duplicates.

**Canonical home rule:** every fact has exactly one canonical home page. Other pages REFERENCE it, never duplicate it.

| Topic | Canonical home | Surfaced from |
|---|---|---|
| Treatment of oral cancer | `/cancer-types/oral-cancer` (treatment_basics section) | `/tests-treatment/treatments/...` references it |
| What a biopsy involves | `/tests-treatment/diagnosis-tests/biopsy` | All cancer_type pages link to it from their diagnosis section |
| Indian emergency numbers (108/112) | One-line snippet in shared frontmatter | Every page footer; never re-explained in body |
| PMJAY eligibility + use | `/find-care/cost-and-access/pmjay` | Referenced from every cancer_type page's "what to do next" block |
| Mouth ulcer red flags | `/symptoms/persistent-mouth-ulcer` | `/cancer-types/oral-cancer` warning_signs section links to it |

The CGP enforces this at generation time: when a section's evidence overlaps with another canonical home, the generator inserts a `[see also](/path/)` reference instead of repeating the content.

## 6. Stage-Based Sequencing

### Stage 1 (MVP — first 4-6 weeks of content production)

Ship pages that the **existing KB content** can back today. No new authoritative-source ingestion needed.

| Section | Pages |
|---|---|
| Home | 1 |
| About Suchi | 3 (`/about-suchi/`, `/how-it-works`, `/safety`) |
| Cancer Types | 5 (oral, breast, cervical, lung, colorectal — KB has NCI content for these) |
| Symptoms | 6 (persistent mouth ulcer, lump in breast, persistent cough, unusual bleeding, weight loss, difficulty swallowing) |
| Tests + Treatment | 4 (biopsy, CT scan, chemotherapy, radiation therapy) |
| Living With Cancer | 5 (just diagnosed, during treatment, caregiver support, emotional support, after treatment) |
| Find Care | 2 (overview + Bihar landing) — light at this stage |
| Resources | 2 (FAQ stub, glossary stub) |
| Urgent Help | 1 |
| Ask Suchi | 1 |
| **Total** | **~30 pages** |

### Stage 2 (months 2-3)

Add depth where Stage 1 traffic shows demand:

- Cancer Types → 10 total (add ovarian, prostate, leukemia, lymphoma, childhood cancers, head-and-neck)
- Symptoms → 15 total (add 9 from the first-50 list)
- Tests → 6 (add FNAC, MRI, PET, blood tests, endoscopy, pathology basics)
- Treatments → 7 (add surgery, immunotherapy, targeted, hormone, palliative)
- Side effects → 5 (nausea, hair loss, fatigue, mouth sores, infection precautions)
- Living With → 8 (add nutrition, infection prevention, follow-up after treatment)
- Find Care → expand to 8 pages (Jharkhand, Eastern UP, hospital choosing guide, cost block)
- Resources → expand FAQ + glossary

Total at end of Stage 2: ~80 pages.

### Stage 3 (month 4+)

Region-specific hospital pages (Find Care depth), downloadables, video library expansion, multilingual rollout (Hindi, Hinglish).

### Sequencing rationale

The ChatGPT-proposed order put Find Care in Stage 3. Given the Bodhgaya conference signal that hospital lists are what stakeholders actually want, **a Find Care landing page + Bihar overview ships in Stage 1**, even if the deeper city-level content waits for Stage 2. This validates the public-facing demand for navigation content without committing to verified provider data we don't yet have.

## 7. First-50 Page Roster

These 50 pages form the publishable knowledge spine. The CGP Topic Registry seeds with these.

### Cancer Types (10)

1. Oral cancer
2. Breast cancer
3. Cervical cancer
4. Lung cancer
5. Colorectal cancer
6. Ovarian cancer
7. Prostate cancer
8. Leukemia
9. Lymphoma
10. Childhood cancers (overview)

### Symptoms (15)

11. Persistent mouth ulcer
12. Lump in breast
13. Persistent cough
14. Blood in sputum
15. Unusual vaginal bleeding
16. Difficulty swallowing
17. Unexplained weight loss
18. Persistent hoarseness
19. Swelling in neck
20. Non-healing wound
21. Persistent stomach pain
22. Blood in stool
23. Persistent fatigue
24. New skin lesion
25. Headache patterns to watch

### Tests & Treatment (10)

26. Biopsy
27. FNAC
28. CT scan
29. PET scan
30. MRI
31. Chemotherapy
32. Radiation therapy
33. Surgery (cancer)
34. Immunotherapy
35. Side effects of chemotherapy

### Living With Cancer (10)

36. Just diagnosed: what to do first
37. Questions to ask your doctor
38. How to organize medical reports
39. What to expect during treatment
40. Caregiver checklist
41. Emotional support after diagnosis
42. Follow-up after treatment
43. What to carry to hospital
44. Understanding a pathology report
45. Getting a second opinion

### Find Care / Navigation (5)

46. How to choose a cancer hospital
47. Government vs private cancer care in India
48. PMJAY for cancer treatment
49. Cancer care in Bihar — overview
50. Questions to ask a hospital before treatment

## 8. Existing KB → IA Mapping

The `kb/en/` directory (used by the chatbot RAG today) has its own structure that doesn't align 1:1 with website URLs. Mapping policy:

| Existing KB folder | Maps to website URL prefix | Notes |
|---|---|---|
| `kb/en/01_basics/` | Background source for `/cancer-types/{slug}` `what_is` sections | RAG retrieval, not a public URL |
| `kb/en/02_nci_core/` | Background source for `cancer_type`, `symptom`, `test`, `treatment` pages | Primary tier-1 source |
| `kb/en/02_symptoms-next-steps/` | Background source for `/symptoms/{slug}` | |
| `kb/en/05_india_ncg/` | Background source for `/cancer-types/{slug}` Indian-context blocks + `/find-care/` | India-specific |
| `kb/en/06_caregiver/` | Background source for `/living-with-cancer/caregiver-*` | |
| `kb/en/99_local_navigation/` | Background source for `/find-care/...` | Existing Bihar hospital data |
| `kb/en/website/` | **The published page files themselves** | New: this is where CGP outputs land |
| `kb/en/01_suchi_oncotalks/` | Background source for `/resources/videos/` (existing /watch/ pages) | Video transcripts |

The CGP retrieves from any of the `kb/en/0[1-6]_*/` and `kb/en/99_*/` folders as evidence; it WRITES TO `kb/en/website/` only.

## 9. Search and Discovery Model

Search is as important as menu structure. At Stage 1 scale (30 pages) the existing site search may suffice. At Stage 2+ (80+ pages) consider:

- **Algolia / Typesense** — hosted search-as-a-service, supports typo tolerance, faceting
- **Pagefind** — static-site-friendly, no service dependency, WASM-based
- **Suchi-as-search** — the chatbot itself answers search queries (already built; just needs UI integration)

Pagefind is the lowest-tax option for a Vite static site. Worth a Stage 2 evaluation.

### Search result grouping

Group results into typed bins so the site feels like a knowledge system:

```
[Symptoms]      Persistent mouth ulcer
                Lump in breast
[Cancer Types]  Oral cancer
                Breast cancer
[Treatments]    Chemotherapy
[Tests]         Biopsy
[Hospitals]     Mahavir Cancer Sansthan, Patna
[Ask Suchi]     "What does ASCUS mean?" → opens chat with seeded query
```

## 10. Homepage User Flows

Validated via the IA structure — every primary user journey reaches an actionable page within 2 clicks:

| User type | Path |
|---|---|
| Symptom-led | Home → Symptoms → Mouth Ulcer → Red Flags → Find Care or Ask Suchi |
| Newly diagnosed | Home → "Just Diagnosed" pathway → First Steps → Questions for Doctor → Ask Suchi |
| Caregiver | Home → Living With Cancer → Caregiver Support → Caregiver Checklist (download in Phase 2) |
| Hospital-seeking | Home → Find Care → Bihar → Patna → How to Choose |
| Anxious general | Home → Hero search → Ask Suchi |

## 11. Open Questions (Decide Before Building)

These are deliberately unresolved and need explicit calls before the first page lands:

1. **Locale/language launch order.** English first; when does Hindi land — Stage 2 or Stage 3? Affects translation pipeline planning.
2. **Comments / feedback widget.** Per-page thumbs up/down (matches existing chatbot feedback pattern) or none in Stage 1?
3. **Author byline / review credit.** Pages display "Reviewed by Dr. X" or "Generated by Suchi, reviewed by SCCF team"? Affects trust and legal stance.
4. **Last-reviewed-date display policy.** Show on every page (transparent) vs hide (cleaner UI) vs show only if older than 12 months (red-flag)?
5. **PMJAY page positioning.** Standalone canonical page at `/find-care/cost-and-access/pmjay` (per Section 5 cross-reference policy), or a section on `/find-care/cost-and-access` directly?

## 12. Governance Metadata

Every page's YAML frontmatter MUST include the fields below. These are not optional. The page schema doc (`CONTENT_PAGE_SCHEMA.md`) specifies the exact JSON Schema; here's the human-readable mapping.

| Field | Why it matters |
|---|---|
| `schema_version` | Migration safety as the schema evolves |
| `page_id` | Stable identifier; URL can change, page_id can't |
| `content_type` | Picks section template, eval rubric, retrieval queries |
| `locale` / `geo_relevance` | Filters for multilingual + region rollout |
| `audience` | Filters for "for caregivers" / "for patients" lists |
| `last_reviewed` | Compliance + freshness signaling |
| `review_status` | `ai_draft` / `reviewed` / `published` / `flagged` — gates publish step |
| `version_id` | Audit trail when content is questioned |
| `provenance.generator_model` | Which model produced this draft (for rollback if a model regresses) |
| `provenance.source_chunks` | Every claim traces to a chunk_id → reproducibility |
| `provenance.eval_scores` | What the eval gate scored at publish time |
| `related_pages` | Cross-reference graph |
| `tags` | Faceting + future taxonomy expansion |

## 13. What This IA is NOT

- **Not the website's visual design.** Wireframes / page layouts are a separate doc.
- **Not the marketing copy.** Hero copy, taglines, About-Suchi narrative are authored, not pipeline-generated.
- **Not the chatbot's prompt.** The bot's behavior is governed by `repairable/prompts/*.md`; the IA is the public-content shape.
- **Not a database schema.** Content lives as markdown files in git. The IA describes URL/section/taxonomy structure, not storage.

## 14. Validation Checklist

Before any page goes live, the CGP eval gate (Module 7) checks:

- [ ] `content_type` value is in the allowed enum
- [ ] All required sections per `content_type` template exist and have content
- [ ] Disclaimer at top matches one of the eval rubric's regex patterns
- [ ] No prohibited diagnosis-language phrase appears
- [ ] At least one numeric urgency timeframe is present (where required)
- [ ] Indian context block is present (where required)
- [ ] Cancer-specific mandatory terms appear (where applicable)
- [ ] Citation density meets the threshold for the content_type
- [ ] All `related_pages` slugs resolve to existing pages
- [ ] `provenance.source_chunks` is non-empty
- [ ] Word counts per section meet minimums
- [ ] Reading level ≤ Class 8 (Flesch-Kincaid grade)

A failing page is sent back to the auto-repair loop (max 2 retries) before being routed to human review.
