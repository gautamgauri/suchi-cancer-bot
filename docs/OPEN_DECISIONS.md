# Open Decisions

Unresolved product or technical decisions that are causing inconsistency, implementation risk, or repeated errors. Each entry has a current state, the problem, and a recommended resolution.

Review this doc before starting any significant new feature. Mark items **RESOLVED** and move the decision into the relevant requirements doc once closed.

---

## OD-001 — Article publish step is manual, not automated

**Status:** Open  
**Area:** Content pipeline

**Current state:** Clicking "Approve" in the article email only sets `status: approved` in `content-queue.json` on GCS. Nothing else happens. A human must then run `npx ts-node content/cli.ts publish`, commit the output to git, and deploy `suchi-web` to make the article live.

**Problem:** The reviewer guide says "the website picks it up on the next deploy" — implying automation. There is no automation. If no one runs the publish command, approved articles never reach the website. There is no notification, no deadline, no scheduled job.

**Options:**
1. Automate: API approval triggers a Cloud Build job that runs publish + deploys `suchi-web`
2. Scheduled: a daily Cloud Scheduler job runs publish + deploys
3. Document as manual: make the manual step explicit and assign ownership

**Recommendation:** Option 2 (daily scheduled publish). Keeps deployment predictable, avoids partial deploys if multiple articles are approved the same day.

---

## OD-002 — Three separate article lifecycles with inconsistent status names

**Status:** Closed (Jun 2026)  
**Area:** Content pipeline

**Resolution:** Article pipeline aligned to canonical lifecycle in `content/types.ts`, `content/cli.ts`, `apps/api/src/modules/admin/content-research.service.ts`, and `docs/CONTENT_PAGE_SCHEMA.md` (FR-CONTENT-012).

| Location | Status values (after fix) |
|---|---|
| `content-queue.json` (content pipeline) | `ai_draft`, `sent_for_review`, `approved`, `rejected`, `published`, `archived` |
| Article frontmatter `review_status` | same canonical set (updated in `CONTENT_PAGE_SCHEMA.md`) |
| Social queue | `sent_for_approval`, `approved`, `rejected`, `published`, `failed` (unchanged — different object type) |
| Navigator queue | `pending`, `researched`, `email_sent`, `approved`, `rejected` (unchanged — different object type) |

`safety_checked` step omitted from article type — no discrete safety gate in the article pipeline.

---

## OD-003 — Citation rendering: visible to users or auditor-only?

**Status:** Open  
**Area:** Chat + content

**Current state:** Three different behaviours exist and none is documented as canonical:

| Context | Current behaviour |
|---|---|
| Chat responses | LLM generates `[1]`, `[2]` markers; citation repair ensures minimum 2 citations; voice channel strips them |
| Article content | Frontmatter requires `[citation:doc_id:chunk_id]` inline markers for provenance |
| Content guide | States "citation markers should not appear in body text — citations are for auditors, not readers" |

**Problem:** These are actually for different outputs (real-time chat vs. authored articles), but the distinction is not documented anywhere, creating confusion about what the rule is.

**Recommendation:** Document explicitly:
- Chat: `[1]` markers in API response are consumed by the frontend and rendered as a collapsible sources section — never shown inline in prose
- Articles: `[citation:...]` in markdown frontmatter/body is for provenance auditing; never rendered on the public website
- Voice: all citation markers stripped before TTS

---

## OD-004 — Safety banner on social posts is advisory, not a hard block

**Status:** Open  
**Area:** Social post pipeline / safety

**Current state:** The social post safety gate flags content with a yellow banner in the approval email. The reviewer guide states: "This is not a hard block — you can still approve."

**Problem:** For a health-information service, some social post content should never be approved regardless of reviewer discretion. Currently, a reviewer could click Approve on a post that claims a treatment will cure cancer.

**Recommendation:** Define hard-block categories that prevent approval regardless of reviewer action:

| Category | Action |
|---|---|
| Diagnosis language ("you may have cancer") | Hard block |
| Cure/guarantee language | Hard block |
| Stop treatment / self-medication advice | Hard block |
| Survival rate claim without context | Hard block |
| Specific cost claims without source | Hard block |
| Missing "consult doctor" line | Warn only (soft) |

Implementation: safety gate returns a `severity` field; `critical` severity prevents the approval endpoint from publishing (returns 403).

---

## OD-005 — Article structure: content guide vs. schema doc have different section templates

**Status:** Closed (Jun 2026)  
**Area:** Content

**Resolution:** `CONTENT_PAGE_SCHEMA.md` section 4 now references `CONTENT_GUIDE.md` rather than maintaining a duplicate section template. `FR-CONTENT-001` marked non-provisional in `REQUIREMENTS.md`.

**Current state:**

`CONTENT_GUIDE.md` (7 sections):
1. What is it
2. Why it is used
3. The treatment process
4. Side effects and management
5. When to call your team
6. Cost and financial support in India
7. Questions to ask your oncologist

`CONTENT_PAGE_SCHEMA.md` (9 sections):
1. What this treatment is
2. Why it is used
3. How it is given
4. Common side effects
5. Important safety signs during treatment
6. What to ask before starting
7. Practical preparation tips
8. Related pages
9. Ask Suchi

**Problem:** Articles generated by the AI and articles reviewed by humans follow different structures depending on which doc was consulted.

**Recommendation:** Declare `CONTENT_GUIDE.md` as canonical for treatment articles (it is more Bihar-appropriate and patient-first). Update `CONTENT_PAGE_SCHEMA.md` to reference `CONTENT_GUIDE.md` rather than defining a separate template.

---

## OD-006 — Article approval does not capture reviewer name

**Status:** Closed (Jun 2026)  
**Area:** Audit / content pipeline

**Resolution:** `?approver=Name` pattern applied to article approval/rejection emails (`content-research.service.ts`) and to approval endpoints (`content-approve.service.ts`). `approvedBy`/`rejectedBy` now store actual reviewer name. Navigator approvals already captured reviewer name (FR-HOSP-007). See P0 sprint commit.

---

## OD-007 — Pending drafts have no expiry

**Status:** Open  
**Area:** Content + social pipelines

**Current state:** Articles, social posts, and navigator batches remain in `sent_for_review` / `sent_for_approval` indefinitely. There is no staleness detection, no reminder, and no automatic expiry.

**Problem:** Stale drafts accumulate. A social post about a newly published article that was never approved becomes misleading if approved weeks later.

**Recommendation:**
- Social posts: expire after 7 days; send a reminder at day 3
- Article drafts: send a reminder after 48h; expire after 30 days
- Navigator batches: no expiry (hospital data is not time-sensitive in the same way)

---

## OD-008 — Social post platform buttons shown even when platform is not configured

**Status:** Open  
**Area:** Social post pipeline / UX

**Current state:** The approval email shows "Instagram only" and "LinkedIn only" buttons even when those platforms are not configured. Clicking them returns `not_configured` and the reviewer gets a confirmation email saying "Failed: instagram, linkedin."

**Problem:** Creates confusion and support burden. Reviewers don't know whether the failure is expected or a bug.

**Recommendation:** Generate the approval email dynamically based on which platforms are configured. If `META_IG_USER_ID` is not set, omit the Instagram button and add a note: "Instagram not yet configured (see issue #28)."

---

## OD-009 — Admin endpoints protected only by HTTP Basic Auth

**Status:** Open  
**Area:** Security

**Current state:** All `/v1/admin/*` endpoints use HTTP Basic Auth (`ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS`). Approval endpoints (`/approve/:id`, `/reject/:id`) use HMAC token only, no Basic Auth — which is correct for one-click email links. But the generate, research, and review endpoints require only Basic Auth.

**Problem:** Basic Auth over HTTPS is acceptable for low-risk internal tools. For a health-information service with real patient-adjacent data (conversation logs, hospital details), this should be reviewed before the team grows beyond 3–4 people.

**Recommendation:** Document the current auth model as an accepted limitation with a review trigger (e.g., "re-evaluate when external contractors access admin endpoints").

---

## OD-010 — Hospital eligibility criteria not formally defined

**Status:** Open  
**Area:** Navigator pipeline

**Current state:** The research agent targets "NCG members, AIIMS, NABH-accredited with oncology" but there is no formal document defining what qualifies a hospital for the Suchi directory.

**Problem:** Different research runs may apply different standards. Reviewers don't have a clear checklist.

**Recommendation:** Define formal hospital eligibility criteria in `docs/NAVIGATOR_PIPELINE.md`:
- Minimum: dedicated oncology department + at least one of: medical oncology, surgical oncology, radiation oncology
- Preferred: NCG member, NABH accredited, PM-JAY empanelled
- Required fields: name, city, address, phone, speciality, government/private, `last_verified` date
- Disqualifying: no oncology department, only palliative/hospice, not contactable for verification
