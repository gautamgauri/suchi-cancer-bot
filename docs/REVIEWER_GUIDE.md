# Suchi Content Pipeline — Reviewer Guide

This guide is for Gautam, Divya, and Nisha. It explains every approval email you receive, what each button does, and the rules that prevent mistakes.

---

## Overview: Three Pipelines

| Pipeline | What it produces | Who triggers it | Who approves |
|---|---|---|---|
| **Article** | New webpage on suchicancercare.org | Automated scheduler (daily) | Gautam, Divya, Nisha |
| **Social post** | Facebook / Instagram / LinkedIn post | Auto-triggered after article approval | Gautam, Divya, Nisha |
| **Hospital directory** | New hospitals in Find Care directory | Research agent (manual trigger) | Gautam, Divya |

All three use the same pattern: **one-click approval in email → publishes immediately**.

---

## Pipeline 1: Article Approval

### How it starts
The bot researches a cancer topic, drafts a full article using NHS/NCI sources, and emails all three reviewers for approval. This happens on a scheduled basis or when triggered manually.

### The email
You receive a single shared email with:
- Full article text to review
- **Approve** button — publishes the article to the website
- **Reject** button — discards it

### Rules
- **First click wins.** The article is published the moment anyone clicks Approve. Others do not need to click — clicking again after the first approval does nothing (it's already approved).
- **Clicking Reject** marks the article as rejected and discards it. It won't appear on the website.
- **Not clicking** leaves the article in "pending" state indefinitely. It won't appear on the website until someone approves it.
- After you approve an article, **social post generation starts automatically** — you don't need to do anything. You'll receive a separate social post approval email within ~1 minute.

### What happens after approval
1. Article status set to `approved` in queue
2. Website picks up the article on next deploy
3. Social post generation triggers automatically (fire-and-forget)

---

## Pipeline 2: Social Post Approval

### How it starts
Triggered automatically ~1 minute after an article is approved. Gemini generates platform-specific copy for Facebook, Instagram, and LinkedIn, runs a safety check, then emails all three reviewers.

### The email
Unlike the article email, **each reviewer gets their own personalised copy** of the email. The other two are CC'd so everyone can see it arrived, but your email has buttons tied to your name.

The email contains:
- The generated copy for each platform
- Safety warning banner (if any content was flagged)
- Platform approval buttons:
  - **Approve all three** — publishes to Facebook, Instagram, and LinkedIn simultaneously
  - **Facebook only** / **Instagram only** / **LinkedIn only** — publish to one platform
  - **Reject — do not post** — discards the draft

### Rules
- **First click wins.** The post publishes the moment anyone clicks an Approve button. Subsequent clicks from other reviewers are silently ignored — the post won't be published twice.
- **Platform buttons are independent.** If you click "Facebook only", it publishes to Facebook only. Instagram and LinkedIn remain unpublished (unless someone clicks their buttons separately).
- **Not clicking** means the post is never published. There is no automatic expiry — drafts stay pending until someone acts.
- **Reject** permanently discards the draft. The article is already live on the website — rejection only prevents the social post, not the article.

### Platforms currently active
| Platform | Status |
|---|---|
| Facebook | ✅ Live — posts immediately on approval |
| Instagram | ⏳ Not configured — skipped until `META_IG_USER_ID` is set |
| LinkedIn | ⏳ Not configured — skipped until an org page token is set |

When a platform is not configured, clicking its button returns "not_configured" — it won't error, it just skips.

### Confirmation email
After the post publishes, everyone receives a confirmation email showing:
- Which platforms published successfully
- Which failed (with error reason)
- Who approved it (the name of whoever clicked first)

### Safety warnings
If the safety reviewer flagged anything, a yellow banner appears at the top of the approval email. This is not a hard block — you can still approve. It means: read the copy carefully before clicking.

---

## Pipeline 3: Hospital Directory Approval

### How it starts
The hospital research agent finds and verifies oncology hospitals (NCG members, AIIMS, NABH-accredited). When a research batch is ready, a review email is sent to Gautam and Divya.

### The email
Contains:
- List of hospitals in the batch with key details (name, city, type, contact)
- Link to the **review portal** — an inline editor where you can correct details before approving
- **Approve All** button

### Rules
- Use the review portal to fix any errors (wrong address, missing phone number, etc.) before approving.
- **Approve All** is idempotent — clicking it twice does nothing the second time.
- Approved hospitals appear in the Find Care directory immediately (no deploy needed).
- There is no "reject individual hospital" option — if one hospital is wrong, fix it in the portal, then approve.

---

## Common Questions

**I clicked Approve but didn't receive a confirmation. Did it work?**
Check the Cloud Run logs or ask Gautam to verify. The confirmation email is fire-and-forget — if SMTP is down, the approval still went through.

**I accidentally approved something. Can it be undone?**
- Article: The article won't appear until the next deploy. Contact Gautam to manually set the status back to `pending` in `content-queue.json` on GCS before the deploy runs.
- Social post: The post is already live on the platform. Delete it directly from Facebook/Instagram/LinkedIn.
- Hospital: Edit `hospitals.json` directly in the repo and redeploy `suchi-web`.

**Can I approve from my phone?**
Yes — the approval links work in any browser. Clicking the link in Gmail on mobile works the same as on desktop.

**The safety banner appeared. Should I still approve?**
Read the flagged content carefully. The safety gate flags things like survival rate claims, "will cure" language, or treatment cost figures. If the copy is fine, approve normally. If it's genuinely problematic, click Reject and re-generate (ask Gautam to trigger a new draft).

**Two of us clicked Approve at the same time — was it published twice?**
No. The service is idempotent: once a post is marked as published, all subsequent approval clicks are ignored and logged as warnings.

---

## Contact

Pipeline issues → Gautam (`gautam@dikshafoundation.org`)  
LinkedIn / Instagram setup → Ananya (GitHub issues #27, #28)
