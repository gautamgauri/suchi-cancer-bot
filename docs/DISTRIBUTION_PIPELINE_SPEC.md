# Suchi Distribution Pipeline — Spec v0.1

**Status:** Draft
**Owner:** SCCF / Suchi product
**Date:** 2026-05-08
**Related docs:** `CGP_v0.2_SCHEMAS.md` (upstream — generates the articles this pipeline distributes)

---

## 1. Problem

Suchi has cancer information content — symptom articles, KB pages, navigator entries — but no systematic way to distribute it. Publishing requires manual effort per channel, so it doesn't happen consistently. This spec defines an automated pipeline that takes a published article and produces review-ready social content for all distribution channels.

**This pipeline is downstream of CGP.** CGP generates the article. This pipeline distributes it.

---

## 2. Goals

- One article in → distribution pack out (all channel variants in a single run)
- Human review before any content goes live (medical content liability)
- English only — quality is easier to assess and correct before adding Hindi
- Email-based review queue — distribution pack sent to both reviewers, either can approve
- Work with existing stack (Gemini, TypeScript, SMTP already configured)
- MVP operable by one non-technical person after setup

## Non-Goals (v1)

- Hindi variants of any channel (Phase 2, after English quality is validated)
- Auto-posting without human approval
- Video generation or rendering (YouTube Shorts script only — no video)
- Image generation (carousel copy only — no image rendering)
- WhatsApp API integration (message copy only — manual send in v1)
- Buffer / scheduling API (manual copy-paste from approval email in v1)
- Analytics / performance tracking across channels

---

## 3. Input

Two source types: **articles** and **video transcripts**. Both are markdown files with frontmatter. The pipeline detects which type it's processing and adjusts the generator prompts accordingly.

### Source A — Articles

All articles live in `apps/landing/src/content/articles/`. The `content_type` frontmatter field identifies the type.

| content_type | Count today | Examples |
|-------------|-------------|---------|
| `cancer_type` | 10 | breast-cancer, cervical-cancer, oral-cancer, lung-cancer, ... |
| `symptom` | 7 | blood-in-stool, lump-in-breast, persistent-cough, ... |
| `find_care` | 2 | cancer-care-in-bihar, pmjay-cancer-coverage |
| **Total** | **19** | |

### Source B — Video Transcripts

| Source | Path | Volume today | Notes |
|--------|------|-------------|-------|
| Onco Talks | `kb/en/01_suchi_oncotalks/*.md` | 0 (not yet ingested) | 8 episodes to ingest |
| Breast Cancer Awareness | `kb/en/03_suchi_awareness/*.md` | 0 (not yet ingested) | 10 episodes to ingest |

**Prerequisite:** Transcripts must be ingested before video entries can be queued. Run `scripts/youtube-transcripts/extract_transcripts.py` following `scripts/YOUTUBE_INGESTION_GUIDE.md`.

**Excluded video types** (never queued):
- Panel Discussions — clinician-facing research content, not suitable for social distribution
- Conference Content — same reason

### Required frontmatter fields

**Articles** (existing fields — no new fields needed):
```yaml
---
title: string           # Article title
summary: string         # One-line summary (existing field name is "summary")
content_type: string    # "cancer_type" | "symptom" | "find_care"
page_id: string         # Used as URL slug e.g. "breast-cancer"
locale: "en"
# canonical URL derived: https://suchitracancercare.org/<content_type>/<page_id>/
---
```

**Video transcripts:**
```yaml
---
title: string           # Video title
description: string     # One-line summary
topic: string           # e.g. "oral-cancer", "breast-cancer"
intent: string          # "awareness" | "treatment" | "patient-story"
url: string             # Watch page URL e.g. /watch/onco-talks-episode-1-oral-cancer/
videoUrl: string        # YouTube URL for direct link in social posts
sourceType: "video"
series: string          # "onco-talks" | "breast-cancer-awareness"
episode: number         # Episode number within series
---
```

---

## 4. Outputs (Distribution Pack)

One JSON file per article run, saved to `distribution/packs/<slug>-<date>.json`.

```jsonc
{
  "articleSlug": "blood-in-stool",
  "articleTitle": "Blood in Stool: When to See a Doctor",
  "generatedAt": "2026-05-08T10:00:00Z",
  "channels": {
    "linkedin": { ... },
    "twitter": { ... },
    "instagram": { ... },
    "whatsapp": { ... },
    "youtube_short": { ... }
  },
  "reviewStatus": "pending",
  "reviewedBy": null,
  "approvedAt": null
}
```

---

## 5. Channel Specifications

### 5.1 LinkedIn

- **Audience:** NGOs, CSR teams, oncologists, health professionals
- **Tone:** Authoritative, educational, credibility-forward
- **Format:** 150–250 words. Opening hook (one punchy line). 3–4 short paragraphs. 3–5 hashtags. CTA linking to full article.
- **Hindi:** No (English only on LinkedIn)
- **Example opening:** "Most people ignore blood in stool. That delay costs lives."

### 5.2 Twitter / X Thread

- **Audience:** Health-aware youth, doctors, journalists
- **Tone:** Direct, factual, shareable
- **Format:** 5–7 tweets. Tweet 1 = hook. Tweets 2–5 = key facts (one per tweet, ≤280 chars). Final tweet = CTA + link.
- **Hindi:** No

### 5.3 Instagram (Carousel Copy)

- **Audience:** Youth, family caregivers
- **Tone:** Warm, clear, visual-first
- **Format:** 6–8 slide captions. Slide 1 = title/hook. Slides 2–7 = one fact each (≤80 chars per slide — designed for overlaid text). Slide 8 = CTA.
- **Language:** English only (v1)
- **Note:** Copy only. Image design is manual (Canva).

### 5.4 WhatsApp Message

- **Audience:** Caregivers and patients
- **Tone:** Conversational, caring, actionable
- **Format:** ≤300 chars. One key warning sign or fact. One concrete action. Article link.
- **Language:** English only (v1)
- **Example:** "Blood in stool for more than 3 days needs a doctor's attention — it could be colorectal cancer. Read more: suchitracancercare.org/symptoms/blood-in-stool/"

### 5.5 YouTube Short Script

- **Audience:** General awareness seekers, youth
- **Tone:** Conversational, calm, educational (not alarming)
- **Format:** 90–120 seconds spoken (≈180–240 words). Hook (5 sec). 3 key facts (60 sec). What to do (20 sec). CTA (5 sec). No jargon.
- **Language:** English only (v1)

---

## 6. Architecture

```
Nightly Cloud Scheduler (10pm IST)
           │
           ▼
   [Backlog Manager]
   - reads distribution/queue.json
   - picks next unprocessed article
   - skips if queue empty or all processed
           │
           ▼
   [Article Parser]
   - extracts title, body, frontmatter
   - resolves canonical URL (suchitracancercare.org/<section>/<slug>/)
   - identifies key facts, warning signs, CTAs
           │
           ▼
   [Gemini Generator] ── 5 prompts in parallel (one per channel)
           │
           ▼
   [Safety Checker]
   - no definitive diagnosis language
   - no dosage or treatment advice
   - no unsupported claims
   - must include "consult a doctor" nudge in medical content
           │
           ▼
   [Credential Checker]
   - checks which posting credentials are configured
   - produces setup_needed[] list for any missing
           │
           ▼
   [Pack Writer]
   - saves distribution/packs/<slug>-<date>.json
   - sends HTML review email to both reviewers
     → if credentials missing: email includes "Automate posting" setup prompts
     → if all credentials present: email is approval-only
           │
           ▼
   [Review Email] ── Gmail (gautamgauri@ + divya.vats@)
   Either reviewer clicks Approve
           │
           ▼
   [Approval Endpoint] ── GET /v1/admin/distribution/approve/:packId
           │
     ┌─────┴─────┐
     ▼           ▼
[Buffer API]  [Post-ready email]
 auto-schedule  copy-paste fallback
 (if configured) (if not configured)
```

---

## 7. Safety Rules (applied before any output is saved)

Medical content requires a hard safety pass before the pack is written. The checker rejects any variant that:

1. States or implies a definitive diagnosis ("you have cancer")
2. Gives dosage, treatment duration, or drug-specific advice
3. Makes a claim not supported by the source article
4. Omits a "consult a doctor" nudge where medically relevant
5. Uses alarming language without a calming action step

On failure: the variant is flagged `safety_failed` with reason. The pack is still written (other channels may pass), but the failed channel is excluded from the review queue row.

---

## 8. Credential Bootstrapping

The pipeline is designed to work on day 1 with zero credentials and progressively automate itself as credentials are added. It never silently falls back — it always tells the reviewers what's missing and how to fix it.

### Credential states

| Credential | Secret Manager key | What it unlocks |
|------------|-------------------|-----------------|
| `BUFFER_ACCESS_TOKEN` | `distribution-buffer-token` | Auto-scheduling on all connected Buffer channels |
| _(future)_ LinkedIn direct API | `distribution-linkedin-token` | LinkedIn without Buffer |
| _(future)_ Twitter/X API | `distribution-twitter-token` | Twitter without Buffer |

### Bootstrapping flow

On every nightly run, the pipeline checks which credentials are present. For each missing credential, it adds a setup prompt to the review email:

```
┌─────────────────────────────────────────────────────┐
│ ⚡ Automate your posting                             │
│                                                     │
│ Right now, approved posts are emailed to you for    │
│ manual copy-paste. Connect Buffer to post           │
│ automatically on approval.                          │
│                                                     │
│ [Connect Buffer →]  (links to /admin/distribution/setup) │
│                                                     │
│ Setup takes 2 minutes. You'll only see this once    │
│ Buffer is connected.                                │
└─────────────────────────────────────────────────────┘
```

Once the credential is saved, the prompt disappears from future emails.

### Setup endpoint

`GET /admin/distribution/setup` — a simple admin page (Basic Auth protected, same credentials as `/admin/metrics`) with one field per credential. On save, the value is written to GCP Secret Manager. No restart needed — the pipeline reads from Secret Manager at runtime.

---

## 8. Review Queue (Email-based)

The pipeline sends one HTML email per article to both reviewers:
- `gautamgauri@dikshafoundation.org`
- `divya.vats@dikshafoundation.org`

Either reviewer can approve. First approval wins.

### Email structure — Mode A (credentials missing)

```
Subject: [Suchi Review] Blood in Stool — Distribution Pack Ready

── LinkedIn Post ──────────────────────────────────────
<full post text>

── Twitter Thread ─────────────────────────────────────
Tweet 1: ...  Tweet 2: ...  ...

── Instagram Captions ─────────────────────────────────
Slide 1: ...  Slide 2: ...  ...

── WhatsApp Message ───────────────────────────────────
<message copy>

── YouTube Short Script ───────────────────────────────
<script>

──────────────────────────────────────────────────────
[APPROVE — I'll post manually]   [REQUEST CHANGES]

⚡ Automate this: [Connect Buffer →]
   Approved posts will schedule automatically once connected.
```

### Email structure — Mode B (Buffer connected)

```
Subject: [Suchi Review] Blood in Stool — Ready to schedule

Content looks good? One click approves and schedules all 5 posts
for tomorrow 9am IST.

── LinkedIn Post ──────────────────────────────────────
<full post text>
[Edit this post]

── Twitter Thread ─────────────────────────────────────
Tweet 1: ...  Tweet 2: ...  ...
[Edit thread]

── Instagram Captions ─────────────────────────────────
<captions>
[Edit captions]

── WhatsApp Message ───────────────────────────────────
<message>
[Edit message]

── YouTube Short Script ───────────────────────────────
<script>
[Edit script]

──────────────────────────────────────────────────────
[APPROVE & SCHEDULE]   [REQUEST CHANGES]
```

### Approval mechanism

Each email contains two links:
- **Approve** → `GET /v1/admin/distribution/approve/:packId?token=<signed-token>`
- **Request Changes** → `mailto:` reply link with pack ID in subject

The `token` is an HMAC-signed string (packId + secret) valid for 7 days. No login required. On approval the pack is marked `approved` in the local JSON file and a confirmation email is sent to both reviewers.

### Pack status lifecycle

```
generated → email_sent → approved / changes_requested
```

Approved packs: content is ready to copy-paste to each channel manually (v1).
Changes requested: reviewer replies with notes → human edits the pack JSON → re-sends email.

---

## 9. Prompt Design Principles

Each channel prompt follows this structure:

```
ROLE: You are a medical content writer for Suchi, a cancer information platform
      serving patients and caregivers in Bihar and Eastern India.

SOURCE ARTICLE:
<article body>

CHANNEL: <channel name>
FORMAT: <exact format spec from Section 5>
TONE: <tone from Section 5>
LANGUAGE: <en / hi>

RULES:
- Use only facts from the source article — do not add information
- Never state a definitive diagnosis
- Always include a "consult a doctor" nudge
- Keep language accessible — no jargon
- Hindi output must use simple conversational Hindi, not clinical Sanskrit terms
- End with CTA linking to: <article URL>

OUTPUT: Return only the formatted content, no explanation.
```

Each channel gets its own prompt file: `distribution/prompts/<channel>.md`

---

## 10. Technical Design

### Location in repo

```
distribution/
  cli.ts              ← Entry point: npx ts-node cli.ts <article-path>
  pipeline.ts         ← Orchestrator
  parser.ts           ← Markdown + frontmatter extractor
  generator.ts        ← Gemini calls (parallel per channel)
  safety-checker.ts   ← Post-generation safety pass
  pack-writer.ts      ← Saves JSON + writes to Google Sheet
  scheduler.ts        ← Buffer API integration (Phase 2)
  prompts/
    linkedin.md
    twitter.md
    instagram.md
    whatsapp.md
    youtube-short.md
  packs/              ← Generated distribution packs (gitignored)
```

### Runtime

- TypeScript, same runtime as `eval/`
- Gemini via `@google/generative-ai` (same as API)
- Google Sheets via `googleapis` (new dependency)
- Buffer API via REST (Phase 2)

### CLI usage

```bash
# Single article
npx ts-node distribution/cli.ts apps/landing/src/content/articles/blood-in-stool.md

# All articles in a directory
npx ts-node distribution/cli.ts --dir apps/landing/src/content/articles/

# Dry run (no Sheet write)
npx ts-node distribution/cli.ts <path> --dry-run

# Specific channels only
npx ts-node distribution/cli.ts <path> --channels linkedin,whatsapp_hi
```

### Environment variables (new)

```
DISTRIBUTION_BASE_URL          # https://suchitracancercare.org
DISTRIBUTION_REVIEW_EMAILS     # gautamgauri@dikshafoundation.org,divya.vats@dikshafoundation.org
DISTRIBUTION_APPROVAL_SECRET   # HMAC secret for signing approval tokens
DISTRIBUTION_POST_TIME         # Scheduled post time e.g. "09:00" IST (used with Buffer)
# SMTP vars already configured in existing stack (SMTP_HOST, SMTP_USER, SMTP_PASS)
# BUFFER_ACCESS_TOKEN stored in Secret Manager as 'distribution-buffer-token' (added via setup page)
```

---

## 11. Content Backlog Queue

`distribution/queue.json` — tracks all articles and their processing status.

```json
{
  "articles": [
    {
      "slug": "breast-cancer",
      "contentType": "cancer_type",
      "sourcePath": "apps/landing/src/content/articles/breast-cancer.md",
      "url": "https://suchitracancercare.org/cancer-type/breast-cancer/",
      "title": "Breast Cancer: Signs, Diagnosis, and Treatment Basics",
      "status": "approved",
      "packId": "breast-cancer-2026-05-09",
      "processedAt": "2026-05-09T16:30:00Z",
      "approvedBy": "gautamgauri@dikshafoundation.org",
      "approvedAt": "2026-05-09T08:12:00Z"
    },
    {
      "slug": "cervical-cancer",
      "contentType": "cancer_type",
      "sourcePath": "apps/landing/src/content/articles/cervical-cancer.md",
      "url": "https://suchitracancercare.org/cancer-type/cervical-cancer/",
      "title": "Cervical Cancer",
      "status": "pending"
    }
  ]
}
```

Statuses: `pending` → `generated` → `email_sent` → `approved` / `changes_requested`

The nightly job picks the oldest `pending` article. If none remain, it sends a "queue empty" email prompting reviewers to add more articles.

---

## 12. Build Order (MVP)

| Phase | What | Outcome |
|-------|------|---------|
| 1 | `parser.ts` + `queue.json` + prompt files | Can extract article content, render prompts, manage backlog |
| 2 | `generator.ts` | Gemini generates all 5 channel variants |
| 3 | `safety-checker.ts` | Hard safety gate on all outputs |
| 4 | `pack-writer.ts` + review email (Mode A) | Pack saved, email sent with copy-paste content + Buffer setup prompt |
| 5 | Approval endpoint + confirmation email | One-click approve flow works end to end |
| 6 | Cloud Scheduler nightly trigger | Pipeline runs automatically every night at 10pm IST |
| 7 | Setup page + Secret Manager write | Buffer credentials collected via email prompt → stored securely |
| 8 | Buffer API integration (Mode B email) | On approval, posts auto-scheduled for 9am next day |

---

## 13. Open Questions

| Question | Status |
|----------|--------|
| Canonical URL base | ✅ `https://suchitracancercare.org` |
| Review mechanism | ✅ Email to both reviewers, approval link |
| Hindi variants | ✅ Phase 2 only — English first |
| Google Sheets dependency | ✅ Removed |
| Buffer / scheduling | ✅ Self-bootstrapping — email fallback until credentials added via setup page |
| Nightly trigger | ✅ 10pm IST, 1 article per night |
| Post time (Buffer) | ✅ 5pm IST |
| Watch/video entries | ✅ Included as Source B — deferred until transcripts are ingested (prerequisite: run YouTube ingestion script) |
| Initial queue population | ✅ Start with 10 cancer type articles (`content_type: cancer_type`) — then add 7 symptom articles, then 2 find-care guides |

---

## 14. What This Does Not Replace

The distribution pipeline repurposes existing articles. It does not:
- Generate new articles (that is CGP's job — `CGP_v0.2_SCHEMAS.md`)
- Replace a medical content editor's judgment
- Guarantee SEO or AEO performance (Schema.org markup is a separate workstream)
- Handle YouTube video production (script only)
