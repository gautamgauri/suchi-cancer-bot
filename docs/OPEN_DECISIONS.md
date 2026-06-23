# Open Decisions

Unresolved product or technical decisions that are causing inconsistency, implementation risk, or repeated errors. Each entry has a current state, the problem, and a recommended resolution.

Review this doc before starting any significant new feature. Mark items **RESOLVED** and move the decision into the relevant requirements doc once closed.

---

## OD-001 — Article publish step is manual, not automated

**Status:** Partially resolved (Jun 2026)  
**Area:** Content pipeline

**Current state:** A daily Cloud Scheduler job calls `POST /v1/admin/content/notify-publish`, which checks for approved articles and emails the team with instructions. Full automation (git push + suchi-web deploy from the API) is deferred because it requires Cloud Build API permissions and git push access from within Cloud Run.

**Interim workflow (implemented):**
1. Cloud Scheduler fires daily → `POST /v1/admin/content/notify-publish`
2. API finds `status: approved` articles → emails Gautam + Divya with the list
3. Human runs `npx ts-node content/cli.ts publish` → commits → Cloud Build deploys suchi-web

**Remaining work (OD-001 not fully closed):** Full automation via Cloud Build API trigger from the approval endpoint. Blocked on: Cloud Build permissions for `suchi-api` service account + git push credentials. Revisit when the content pipeline volume justifies the complexity (currently 1–2 articles/month).

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

**Status:** Closed (Jun 2026)  
**Area:** Chat + content

**Decision:** Citations serve different purposes in different outputs. The canonical rule:

| Context | Rule | Implementation |
|---|---|---|
| Chat (web) | `[citation:docId:chunkId]` markers in API response are consumed by the frontend and rendered as a collapsible "Sources" section below the response — **never shown inline in prose** | `CitationService.extractCitations()` + frontend renderer |
| Chat (voice) | All citation markers and source blocks stripped before TTS | `stripForVoice()` in `voice-output-stripper.ts` |
| Articles (website) | `[citation:...]` in markdown is for provenance auditing only — **never rendered on the public website** | Astro content collection ignores unknown markdown tokens |
| Articles (audit) | `provenance.source_chunks` in YAML frontmatter is the authoritative audit trail | `CONTENT_PAGE_SCHEMA.md` schema |

**Why:** "Citations are for auditors, not users" applies to article prose. Chat citations are different — they ground real-time responses and the frontend renders them as a trust signal without cluttering the prose.

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

**Status:** Closed — accepted limitation (Jun 2026)  
**Area:** Security

**Decision:** HTTP Basic Auth over HTTPS is accepted for the current team size (3–4 people, internal only). The auth model is:

| Endpoint type | Auth | Rationale |
|---|---|---|
| Admin generate/research/review | Basic Auth (`ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS`) | Internal team only; credentials in Secret Manager |
| Approval/rejection links | HMAC token in URL (`?token=...`) | Single-use email links; no session required |
| Scheduler jobs | OIDC token (`SchedulerOidcGuard`) | Service account only; no human interaction |

**Review trigger:** Re-evaluate when (a) external contractors need admin access, or (b) the team grows beyond 6 people. At that point, migrate to Google Identity-Aware Proxy (IAP) or OAuth2 with role-based access.

**See also:** `FR-ADMIN-004` in `REQUIREMENTS.md`.

---

## OD-010 — Hospital eligibility criteria not formally defined

**Status:** Closed (Jun 2026)  
**Area:** Navigator pipeline

**Resolution:** Formal eligibility criteria, required fields, and disqualifying conditions documented in `docs/NAVIGATOR_PIPELINE.md` under "Inclusion criteria". Three hard gates: oncology department, 2+ modalities, trust signal. Required fields include name/city/address/phone/departments/type/last_verified. Disqualifying conditions listed explicitly.
