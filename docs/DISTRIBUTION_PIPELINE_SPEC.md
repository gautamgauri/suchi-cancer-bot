# Suchi Distribution & Social Publishing Pipelines

This document specifies the distribution and social publishing pipelines used by Suchi Cancer Bot. 

There are two co-existing publishing flows:
1. **Unified Social Post Pipeline** (Fully integrated into the NestJS API under `apps/api`)
2. **Standalone Distribution Pack Pipeline** (GCS-driven pipeline under `distribution/`)

---

## 1. Unified Social Post Pipeline (API-driven)

This pipeline triggers automatically when a website article is approved. It generates social media copy, runs safety checks, and sends an approval email to reviewers. Once approved, it publishes immediately to the native APIs of configured social platforms.

### Flow Architecture
```
[Article Approved]
       │
       ▼
[SocialPostService.generateAndQueue()]
  - Generates platform-specific copy (Gemini)
  - Runs Safety Gate (HARD_BLOCK_PATTERNS check)
  - Saves draft to GCS (social-queue.json)
  - Sends approval email to reviewers (Gautam, Divya, Nisha)
       │
       ▼
Reviewer clicks "Approve All" or platform-specific links
       │
       ▼
[GET /v1/admin/social/approve/:id?token=xxx]
  - Verifies HMAC token
  - Publishes directly to Facebook, Instagram, and LinkedIn APIs
  - Sends confirmation email to team
```

### Safety Gate & Hard Blocks
Before the review email is sent, the content is inspected for medical safety. Any post matching these patterns is flagged `safetyBlocked` and **cannot be approved**:
- Definitive diagnosis language ("you have/might have cancer")
- Guarantees of cure or survival outcomes ("will cure", "90% survival")
- Advice to start or stop clinical treatments ("stop chemo", "instead of radiation")
- Specific rupee costs of treatments or procedures

### native Posting APIs
On approval, the service posts directly to platforms:
- **Facebook**: Publishes message to `/v21.0/{page-id}/feed`
- **Instagram**: Creates media container with branded social card via `/v21.0/{ig-user-id}/media`, then publishes via `/media_publish`.
- **LinkedIn**: Share UGC post with article links to `/v2/ugcPosts`.

---

## 2. Standalone Distribution Pipeline (GCS-driven)

This pipeline processes generated content packs manually or nightly. It reads the article queue, parses content, generates channel variations, and emails reviewers.

### Flow Architecture
```
Nightly Cloud Run Job (daily-publisher)
           │
           ▼
     [cli.ts / run]
           │
           ▼
[Gemini Generator] ── Generates variants for 5 channels
           │
           ▼
[Safety Checker] ── Runs safety check on all variants
           │
           ▼
[Pack Writer]
  - Saves pack to GCS (dist-packs/<slug>.json)
  - Updates queue (dist-queue.json)
  - Emails reviewers with approval link
           │
           ▼
Reviewer clicks "Approve" link:
[GET /v1/distribution/approve/:slug?token=xxx]
  - Verifies HMAC token
  - Sets pack status to "approved" in GCS
           │
           ▼
Next run of daily-publisher posts approved packs to platforms (Instagram, Twitter, and LinkedIn via native APIs)
```

### Editorial Quality Gate & Regenerate-on-Fail Loop
Before a pack is written to GCS, each generated channel variant is evaluated by the [Editorial Quality Scorer](file:///c:/Users/gauta/suchi_repo/distribution/editorial-scorer.ts) on a 100-point scale across five core Suchi Editorial Principles:
1. **Human-First**: Avoids starting with a clinical definition; opens with a human observation.
2. **India-Grounded**: Focuses on local habits, regional tobacco types (e.g. gutka, khaini), or PM-JAY/Ayushman Bharat.
3. **Practical**: Provides clear, actionable timeframes and next steps.
4. **Calm Urgency**: Promotes swift action without causing alarm; balances urgent facts with reassuring guidance.
5. **Clinically Humble**: Uses uncertainty terms (e.g. "may", "often") and avoids diagnosing.

- **Threshold**: The minimum passing score is **75/100**.
- **Automated Feedback Loop**: If a channel scores below 75/100, the pipeline dynamically builds targeted corrective feedback and invokes Gemini to regenerate the content (preserving what worked and repairing only the flagged dimensions).
- **Retries**: The loop attempts up to **2 retries** per channel. If the score is still below 75 after retries, the variant is flagged in the logs but included in the pack anyway so the human reviewer can inspect the scores and make a final call.

### Verification Endpoints
- **Approve**: `GET /v1/distribution/approve/:slug?token=<hmac>`
- **Reject**: `GET /v1/distribution/reject/:slug?token=<hmac>`
- **Request Changes**: Handled via `mailto:` links directly to Gautam.

---

## 3. Channel Specifications

| Channel | Format / Word Count | Target Audience | Tone |
|---|---|---|---|
| **LinkedIn** | 150–250 words, opening hook, CTA | NGOs, health professionals, doctors | Authoritative, educational |
| **Twitter / X** | 5–7 tweet thread, CTA | Health-aware youth, general public | Direct, factual, shareable |
| **Instagram** | 6–8 slide captions, slide 1 is hook, CTA | Caregivers, general public | Warm, visual-first |
| **WhatsApp** | ≤300 characters, warning sign, CTA | Caregivers, patients | Actionable, caring |
| **YouTube Short** | 90–120 seconds spoken script, hook, CTA | Youth, general public | Conversational, educational |

---

## 4. Environment Variables

Both pipelines read configuration from Environment Variables (in Secret Manager or process env):

| Env Var | Purpose | Location |
|---|---|---|
| `META_PAGE_ID` | Facebook page ID for direct publishing | Unified Social |
| `META_IG_USER_ID` | Instagram User ID for direct publishing | Unified Social |
| `META_PAGE_ACCESS_TOKEN`| Meta Graph API token (Facebook & Instagram) | Unified Social |
| `LINKEDIN_ACCESS_TOKEN` | OAuth Bearer token (rotate monthly) | Unified Social |
| `LINKEDIN_AUTHOR_URN` | LinkedIn Organization or Person URN | Unified Social |
| `SUCHI_SOCIAL_CARD_URL` | Base branded social card image URL for IG | Unified Social |
| `SOCIAL_APPROVAL_SECRET`| HMAC signing secret for social posts | Unified Social |
| `DISTRIBUTION_APPROVAL_SECRET`| HMAC signing secret for standalone packs | Standalone |
| `QUEUE_GCS_BUCKET` | Google Cloud Storage bucket for queue and packs | Both |
| `DIST_QUEUE_GCS_OBJECT` | GCS queue file name (defaults to `dist-queue.json`) | Standalone |
| `DIST_PACKS_GCS_PREFIX` | GCS directory prefix for packs (defaults to `dist-packs`) | Standalone |
