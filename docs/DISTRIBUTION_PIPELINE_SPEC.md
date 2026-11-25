# Suchi social distribution

Social posting runs in the API, in `apps/api/src/modules/social/`. The runbook is `docs/OPERATIONS.md` section 12, which covers how a post goes out, the content lanes, the one switch that pauses everything, and what the owner must set up and renew for each platform.

## What replaced what

Until November 2026 there were two flows.

The article-triggered flow in `apps/api/src/modules/admin/social-post.service.ts` drafted Facebook, Instagram and LinkedIn copy after each article approval and emailed three reviewers one-click GET links. Between 21 May and 23 June 2026 it posted eight times to the SCCF Facebook Page, with one article posted twice. It never posted to Instagram or LinkedIn. Those posts were drafted from articles that no clinician had reviewed.

The standalone flow in `distribution/` generated packs for five channels and posted to Instagram and X by logging in through a browser. Nothing schedules it, and it has never posted.

Both are replaced by the social module.

| Then | Now |
|---|---|
| Article copy posted after any reviewer's click | Article posts are in the clinical lane, shut until the article is marked reviewed |
| One-click GET links, tokens that never expire, a built-in fallback secret | A review page. Only its POST button approves. Signed, content-bound, single-use links that expire after 72 hours. No fallback secret. |
| Emails to three named reviewers | One email to `DAILY_REPORT_EMAIL` |
| Copy shown as plain text without the image | Each platform's exact text and the Instagram card image |
| A safety check by a second model call | The voice gate, the source check and the editorial score, all in code. They filter obvious faults and cannot check a claim made in words. The owner reads each post against its source links. |
| An editorial score that rewarded question openers, "Did you know", regional names and timeframes | A score for plainness, overlap with the brief's facts, use to a family and calm, kept in the record and not shown as a mark of quality |
| Copy written by a model after each article approval | The first four weeks written by hand. The generator is off unless `SOCIAL_GENERATOR_ENABLED=true`. |
| Browser logins to Instagram and X | The official APIs. X behind `SOCIAL_X_ENABLED`. |
| No record beyond a queue file | A record per post with each platform's post id, link, time and every attempt |

## Channel formats

| Platform | Who reads it | Length | Next step |
|---|---|---|---|
| LinkedIn | Hospital staff, social workers, health workers, funders | 60 to 160 words, no emoji, no hashtags | Web chat or site page with `src=social-linkedin` |
| Facebook | Families and older relatives | 50 to 120 words | Web chat or site page with `src=social-facebook`. No raw `wa.me` links in posts. |
| Instagram | Families, younger caregivers | 30 to 80 words under a card image, two hashtags at most | Profile link with `src=social-instagram` |
| X | General public, journalists, health workers | One or two sentences, 280 characters with a link counted as 23 | Web chat or site page with `src=social-x` |

## Environment

| Variable | Purpose |
|---|---|
| `SOCIAL_PUBLISH_MODE` | `live`, `dry_run` (default) or `off` |
| `SOCIAL_X_ENABLED` | `true` to allow X. Default `false`. |
| `SOCIAL_GENERATOR_ENABLED` | `true` to let Gemini write posts that have no hand-written text. Default `false`. |
| `SOCIAL_APPROVAL_SECRET` | Signs approval links. Falls back to `CONTENT_APPROVAL_SECRET`. |
| `DAILY_REPORT_EMAIL` | The owner, who receives approval and warning emails |
| `QUEUE_GCS_BUCKET` | Holds `social/posts/`, `social/state/` and the `social/PAUSED` switch |
| `META_PAGE_ID`, `META_IG_USER_ID`, `META_PAGE_ACCESS_TOKEN` | Facebook and Instagram |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | LinkedIn |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | X. Optional env, kept out of the pipelines until the secrets exist. |
