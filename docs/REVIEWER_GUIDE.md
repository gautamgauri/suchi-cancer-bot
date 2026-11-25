# Suchi Content Pipeline Reviewer Guide

This guide is for Gautam, Divya, and Nisha. It explains every approval email you receive, what each button does, and the rules that prevent mistakes.

---

## Overview: Three Pipelines

| Pipeline | What it produces | Who triggers it | Who approves |
|---|---|---|---|
| **Article** | New webpage on suchitracancercare.org | Automated scheduler (daily) | Gautam, Divya, Nisha |
| **Social post** | LinkedIn, Facebook, Instagram and X posts | Daily calendar job, and articles once a clinician has reviewed them | The owner |
| **Hospital directory** | New hospitals in Find Care directory | Research agent (manual trigger) | Gautam, Divya |

Articles and hospitals use one-click approval in email. Social posts use a review page with a publish button.

---

## Pipeline 1: Article Approval

### How it starts
The bot researches a cancer topic, drafts a full article using NHS/NCI sources, and emails all three reviewers for approval. This happens on a scheduled basis or when triggered manually.

### The email
You receive a single shared email with:
- Full article text to review
- **Approve** button, which publishes the article to the website
- **Reject** button, which discards it

### Rules
- **First click wins.** The article is published the moment anyone clicks Approve. Others do not need to click. Clicking again after the first approval does nothing (it's already approved).
- **Clicking Reject** marks the article as rejected and discards it. It won't appear on the website.
- **Not clicking** leaves the article in "pending" state indefinitely. It won't appear on the website until someone approves it.
- After you approve an article, **the article waits for clinical review before any social post is drafted from it**. You don't need to do anything.

### What happens after approval
1. Article status set to `approved` in queue
2. Website picks up the article on next deploy
3. The article joins the list that the daily social job checks. A social post is drafted from it only once its `review_status` says it has been reviewed.

---

## Pipeline 2: Social Post Approval

Social posts are approved by the owner alone. The full description is in `docs/OPERATIONS.md` section 12.

### How it starts
A daily job prepares the post planned for that day. Each platform gets its own text, and every draft passes an automatic check of the owner's style rules and its sources before anyone sees it. Article posts wait until a clinician has reviewed the article.

### The email
One email goes to the owner. It shows the text for LinkedIn, Facebook, Instagram and X exactly as it will appear, with the Instagram card image and the sources. Facts are not checked automatically, so please open the source links before approving. Nothing is posted from the email. Its button opens a review page.

### The review page
Opening the page changes nothing, so a mail scanner that follows the link cannot post. No platform is ticked to begin with. Tick each one you want and press publish, or press do not post. The link works once and expires after 72 hours. If you do nothing, nothing is posted.

### After you press publish
Each ticked platform is posted on its own, and a failure on one does not stop the others. A result email lists each platform with a link to the post. A platform marked "outcome unknown" is never posted again by the system. Check the page and post it by hand if it is missing.

---

## Pipeline 3: Hospital Directory Approval

### How it starts
The hospital research agent finds and verifies oncology hospitals (NCG members, AIIMS, NABH-accredited). When a research batch is ready, a review email is sent to Gautam and Divya.

### The email
Contains:
- List of hospitals in the batch with key details (name, city, type, contact)
- Link to the **review portal**, an inline editor where you can correct details before approving
- **Approve All** button

### Rules
- Use the review portal to fix any errors (wrong address, missing phone number, etc.) before approving.
- **Approve All** is idempotent. Clicking it twice does nothing the second time.
- Approved hospitals appear in the Find Care directory immediately (no deploy needed).
- There is no "reject individual hospital" option. If one hospital is wrong, fix it in the portal, then approve.

---

## Common Questions

**I clicked Approve but didn't receive a confirmation. Did it work?**
Check the Cloud Run logs or ask Gautam to verify. The confirmation email is fire-and-forget. If SMTP is down, the approval still went through.

**I accidentally approved something. Can it be undone?**
- Article: The article won't appear until the next deploy. Contact Gautam to manually set the status back to `pending` in `content-queue.json` on GCS before the deploy runs.
- Social post: The post is already live on the platform. Delete it directly from Facebook/Instagram/LinkedIn.
- Hospital: Edit `hospitals.json` directly in the repo and redeploy `suchi-web`.

**Can I approve from my phone?**
Yes. The approval links work in any browser. Clicking the link in Gmail on mobile works the same as on desktop.

**The safety banner appeared. Should I still approve?**
- If it is a **yellow warning banner**, read the flagged content carefully. If the copy is medically safe, you can approve normally. If not, click Reject.
- If it is a **red "HARD BLOCK" banner**, you cannot approve the post. The Approve buttons will be hidden, and the system will block any approval requests. You must click Reject and either edit the source article to fix the violations or ask Gautam to trigger a new draft.

**Can a social post go out twice?**
No. Each platform is claimed before anything is sent, so a second press, a resent email or two runs at once cannot post again.

---

## Contact

Pipeline issues → Gautam (`gautam@dikshafoundation.org`)  
LinkedIn / Instagram setup → Ananya (GitHub issues #27, #28)
