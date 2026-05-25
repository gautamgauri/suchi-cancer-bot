# Suchi Social Publishing Pipeline

Production runbook for social posts generated from approved Suchi website articles.

This document covers the API-backed flow in `SocialPostService`. It is separate from
the older `distribution/` CLI described in `DISTRIBUTION_PIPELINE_SPEC.md`.

## Overview

```
Cloud Scheduler
  -> POST /v1/admin/article-research
    -> ContentResearchService drafts one article and emails reviewers
      -> reviewer clicks GET /v1/admin/content/approve/:slug?token=<hmac>
        -> ContentApproveService marks the article approved
          -> SocialPostService.generateAndQueue() runs in the background
            -> Gemini generates Facebook, Instagram, and LinkedIn copy
            -> lightweight safety gate adds warnings
            -> draft is appended to social-queue.json in GCS
            -> reviewers receive social approval email
              -> reviewer approves or rejects by email link
                -> approval publishes immediately to configured platforms
```

Social publishing is not a standalone scheduler job. It starts after a website
article is approved.

## Public Interfaces

All routes are served by `AdminController` under the global `/v1` API prefix.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/admin/social/approve/:id?token=<hmac>` | HMAC query token | Publish a queued draft to all configured platforms |
| `GET` | `/v1/admin/social/approve/:id?token=<hmac>&platforms=facebook,instagram,linkedin` | HMAC query token | Publish only selected platforms |
| `GET` | `/v1/admin/social/reject/:id?token=<hmac>` | HMAC query token | Mark a queued draft rejected |
| `POST` | `/v1/admin/social/generate` | Basic Auth | Manually generate a social draft for an existing article slug |

Manual generation body:

```json
{ "slug": "chemotherapy" }
```

The manual endpoint looks up the slug in `content-queue.json`, creates a new
draft in `social-queue.json`, and sends a fresh approval email. It does not
publish anything until an approval link is clicked.

## State and Storage

State is stored in the GCS bucket named by `QUEUE_GCS_BUCKET`.

| Object | Owner | Purpose |
|---|---|---|
| `content-queue.json` | Content approval pipeline | Source of approved article metadata and slug lookup for manual social generation |
| `content-drafts/{slug}.md` | Content research pipeline | Draft frontmatter; `summary` is used as social prompt context |
| `social-queue.json` | Social publishing pipeline | Social draft queue and publish results |

`social-queue.json` has this shape:

```json
{
  "posts": [
    {
      "id": "uuid",
      "slug": "chemotherapy",
      "title": "Chemotherapy",
      "contentType": "treatment",
      "articleUrl": "https://suchicancercare.org/tests-treatment/treatments/chemotherapy",
      "copy": {
        "facebook": "...",
        "instagram": "...",
        "linkedin": "..."
      },
      "status": "sent_for_approval",
      "approvalToken": "hmac",
      "createdAt": "2026-05-25T16:00:00.000Z",
      "safetyWarnings": []
    }
  ]
}
```

Possible statuses are `sent_for_approval`, `approved`, `rejected`, `published`,
and `failed`. Current approval code writes `published` after an approve click and
stores per-platform results in `publishResults`.

## Approval and Safety

Approval links use an HMAC token over the social draft `id`.

Secret precedence:

1. `SOCIAL_APPROVAL_SECRET`
2. `CONTENT_APPROVAL_SECRET`
3. Development fallback `suchi-social-dev-secret`

There is no login session for approval links and no token expiry in code. Treat
approval links as sensitive, single-use operational links; clicking an approval
link publishes immediately to the requested platforms.

Before the email is sent, `SocialPostService` asks the LLM safety gate to flag:

- definitive survival rates
- cure claims
- instructions to start or stop treatment
- diagnostic statements
- specific rupee costs

Warnings appear in the approval email. They do not block approval.

## Platform Publishing

Platforms without required configuration return `not_configured` and are skipped.
Approval can still succeed for other platforms.

| Platform | Required configuration | Behavior |
|---|---|---|
| Facebook | `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` | Posts to Graph API `v21.0/{META_PAGE_ID}/feed` |
| Instagram | `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN`, `SUCHI_SOCIAL_CARD_URL` | Creates a media container with the configured image URL, then publishes it |
| LinkedIn | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | Posts through LinkedIn UGC Posts API as an `ARTICLE` pointing at the Suchi article URL |

LinkedIn access tokens expire periodically; rotate `LINKEDIN_ACCESS_TOKEN` before
approval emails start reporting `HTTP 401` or `HTTP 403` failures.

## Environment Variables

| Variable | Required for | Notes |
|---|---|---|
| `QUEUE_GCS_BUCKET` | Queue persistence | Also used by Navigator and content approval queues |
| `GOOGLE_CLOUD_PROJECT` | GCS client | Defaults to `gen-lang-client-0202543132` |
| `SUCHI_SITE_URL` | Article links | Defaults to `https://suchicancercare.org` |
| `SOCIAL_APPROVAL_SECRET` | Social HMAC tokens | Optional; falls back to `CONTENT_APPROVAL_SECRET` |
| `CONTENT_APPROVAL_SECRET` | Content approval and social fallback | Mounted in current Cloud Build deploy |
| `META_PAGE_ID` | Facebook publishing | Mounted in current Cloud Build deploy |
| `META_PAGE_ACCESS_TOKEN` | Facebook and Instagram publishing | Mounted in current Cloud Build deploy |
| `META_IG_USER_ID` | Instagram publishing | Must be present for Instagram to publish |
| `SUCHI_SOCIAL_CARD_URL` | Instagram publishing | Public image URL reused for social card posts |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn publishing | Mounted in current Cloud Build deploy |
| `LINKEDIN_AUTHOR_URN` | LinkedIn publishing | Mounted in current Cloud Build deploy |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Approval and confirmation email | Same mailer used by reports and Navigator |
| `DAILY_REPORT_EMAIL` | Primary reviewer | Additional reviewers are hard-coded in `SocialPostService` |

## Operational Checks

### Generate a Test Draft

```bash
curl -u "$ADMIN_BASIC_USER:$ADMIN_BASIC_PASS" \
  -H "Content-Type: application/json" \
  -d '{"slug":"chemotherapy"}' \
  https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/social/generate
```

Expected result: JSON response with `ok: true`, plus an approval email to the
reviewers.

### Approve One Platform

Use the platform-specific button in the email, or add the query parameter
manually:

```text
https://suchi-api-lxiveognla-uc.a.run.app/v1/admin/social/approve/{id}?token={token}&platforms=linkedin
```

### Troubleshooting

| Symptom | Check |
|---|---|
| No approval email after article approval | Cloud Run logs for `SocialPostService`; confirm `QUEUE_GCS_BUCKET`, `SMTP_*`, and `content-drafts/{slug}.md` access |
| Approval page says no platforms published | Required platform secrets are missing or not mounted |
| Instagram skipped | Confirm `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN`, and public `SUCHI_SOCIAL_CARD_URL` |
| LinkedIn failures | Rotate `LINKEDIN_ACCESS_TOKEN`; confirm `LINKEDIN_AUTHOR_URN` matches the organization or person being used |
| Duplicate post risk | Do not re-click approval links; the route publishes requested platforms each time it is called |

## Related Code

| File | Purpose |
|---|---|
| `apps/api/src/modules/admin/social-post.service.ts` | Production social draft generation, approval email, queue persistence, direct Meta/LinkedIn publishing |
| `apps/api/src/modules/admin/content-approve.service.ts` | Triggers social generation after article approval |
| `apps/api/src/modules/admin/admin.controller.ts` | Social approve, reject, and manual generate routes |
| `apps/api/src/config/env.validation.ts` | Social env var validation/defaults |
| `cloudbuild.yaml` | Cloud Run secret mounting for current production deploy |
| `apps/api/src/modules/admin/social-distribution.service.ts` | Legacy/unwired Zapier email-parser implementation |
| `distribution/` | Standalone distribution CLI with a different channel set and storage model |
