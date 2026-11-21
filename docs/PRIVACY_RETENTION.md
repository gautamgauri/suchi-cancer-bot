# Privacy and Data Retention Policy

**Version:** 1.0  
**Date:** Jun 2026  
**Owner:** SCCF / Suchi product  
**Status:** Adopted — implementation partially complete (see gaps below)  
**Last corrected:** 21 Nov 2026 (location, WhatsApp, analytics events, retention schedule)

---

## What data Suchi collects

| Data | Where stored | Who can access |
|---|---|---|
| Conversation messages (user queries + assistant responses) | PostgreSQL `message` table | Gautam (DB access), future: admin panel read-only |
| Session metadata (channel, locale, cancerType, emotionalState, and the city, region and country code derived from the client IP address) | PostgreSQL `session` table | The maintainer |
| Safety events (classification, rule fired, session/message ID) | PostgreSQL `safetyEvent` table | Gautam |
| Feedback (thumbs up/down, free-text) | PostgreSQL `feedback` table | Gautam |
| Voice audio (STT input) | **Not persisted** — transcribed and discarded | N/A |
| Voice transcripts (STT transcript text) | PostgreSQL `voiceInteraction` table | Gautam |
| WhatsApp contacts (E.164 phone numbers mapped to session) | PostgreSQL `whatsAppContact` table | Gautam |
| TTS audio output | GCS `suchi-tts-audio` bucket, signed URLs (60 min TTL) | Expiry: 7 days (see below) |
| Article drafts + queue | GCS `suchi-navigator-state` bucket | Gautam, Divya |
| Hospital directory | GCS + committed to git (`hospitals.json`) | Gautam, Divya, Nisha |
| Analytics events (event name and a JSON payload). This includes the WhatsApp inbound ledger, which holds the message ID, a status, the time received and the text length. The ledger holds no message text. It has no phone number field, but the row key and payload both carry Meta's message ID, and that ID may be decodable to the sender's phone number. This is confirmed only on the sample ID format in Meta's documentation, which base64-decodes to a string containing the sender's number. Treat ledger rows as personal data until shown otherwise. | PostgreSQL `AnalyticsEvent` table | The maintainer |
| Session source code, once PR #251 is merged and the API is deployed. A web chat session may carry a short source code (`src`, for example `site-article`) and a `utm_source` value as query parameters on `POST /v1/sessions`. Each is kept only if it is 1 to 32 characters of lower-case letters, digits, hyphen or underscore. Any other value is dropped and the session is still created. Kept values are stored as `src` and `utmSource` in the payload of the `session_created` analytics event. Nothing is added to the `Session` row, and no referrer URL or free text is stored. These values follow the retention of analytics events below. | PostgreSQL `AnalyticsEvent` table | The maintainer |
| Langfuse traces | Langfuse US cloud (third-party) | Gautam |

---

## What data Suchi does NOT collect

- No names or Aadhaar/ID numbers from users. Note: E.164 phone numbers are collected only for WhatsApp users to map inbound messages to conversation sessions.
- No precise location. Suchi does store an approximate location. When a session is created, the API looks up the client IP address in a local GeoIP database and stores the city, region and country code on the session (`apps/api/src/modules/sessions/sessions.controller.ts`). The lookup makes no external call. The session record has no field for the IP address itself.
- No cookies or persistent browser identifiers (web session ID is ephemeral per conversation)
- No payment information

---

## Retention periods

| Data | Retention period | Rationale |
|---|---|---|
| Conversation messages | **90 days** | Sufficient for quality review; minimises patient-adjacent data at rest |
| Session metadata | **1 year** | Retained with feedback and safety events to respect database foreign key constraints; conversation message content is purged at 90 days |
| Voice transcripts | **90 days** | Purged along with conversation messages |
| WhatsApp contacts | **90 days** | Purged when inactive for 90 days to protect phone number privacy |
| Safety events | **1 year** | Required for audit; safety events are not message content |
| Feedback | **1 year** | Used for quality improvement |
| Analytics events | **No limit at present** | The table sits outside the 90 day purge. `RetentionService` deletes no analytics rows. When a session is deleted, its analytics rows stay and lose their link to the session. This includes the WhatsApp ledger rows, whose message IDs may decode to a phone number. |
| TTS audio (GCS) | **7 days** | Signed URLs expire in 60 min; raw files cleaned by GCS lifecycle rule |
| Langfuse traces | **30 days** (Langfuse default) | Observability only |
| Article drafts (GCS) | Until published or archived | Content pipeline operational data |

**Implementation status:**
- 90-day message/voice/WhatsApp deletion and 1-year session metadata/feedback/safety deletion: **implemented** — `RetentionService` + `POST /v1/admin/housekeeping/run-retention`. The code is in place. **It is not scheduled in production.** See the open item below.
- TTS GCS lifecycle rule: **implemented** — 7-day delete lifecycle rule applied to `suchi-tts-audio` bucket (Jun 2026)
- Safety event / feedback 1-year retention: **implemented** (with message content purged at 90 days)
- WhatsApp contact purging: **implemented** (purged after 90 days of inactivity)

---

## Access controls

| Who | What they can access | How |
|---|---|---|
| Gautam (admin) | All data | Direct DB access + admin panel |
| Divya, Nisha | Content queue, hospital directory | Admin panel (Basic Auth) |
| Cloud Run service account | Reads/writes operational data | Service account ADC |
| Suchi scheduler SA | Calls scheduler endpoints | OIDC token |
| External users | Nothing — no public data access | N/A |

No external contractors have access to conversation or patient-adjacent data. If this changes, re-evaluate auth model (see OD-009).

---

## Log redaction

Application logs (Cloud Logging) may contain user query text from `this.logger.log()` calls. Current state:
- Query text is truncated to 200 characters in most log statements
- No PII is explicitly logged (names, phone numbers, Aadhaar)
- Safety event logs include rule names and session IDs but not user text

**Gap:** A log scrubbing policy (regex-based redaction of phone numbers, Aadhaar patterns) is not implemented. Low priority until the platform handles genuinely identifiable data.

---

## User rights

Suchi has no user account system.

Web chat sessions are not linked to an identity. A web user cannot be identified across sessions from the stored data, apart from the approximate location described above.

The WhatsApp channel is live. For each WhatsApp user the `whatsAppContact` table stores the phone number in E.164 form and maps it to the current session. A WhatsApp user can therefore be identified by phone number until the contact record is purged. The WhatsApp ledger in `AnalyticsEvent` may keep a decodable form of the number after that purge, as described in the data table above.

There is no automated workflow for a deletion or access request. If a WhatsApp user asks for deletion, the session can be located by phone number and the associated records deleted by hand. A workflow for such requests has not been designed. It needs a decision from the maintainer and SCCF.

---

## Implementation backlog

| Item | Priority | Owner |
|---|---|---|
| PostgreSQL 90-day retention job (messages + sessions) | ~~P1~~ **Done** | — |
| GCS lifecycle rule for TTS audio bucket (7-day delete) | ~~P1~~ **Done** | — |
| Cloud Scheduler job for run-retention (weekly) | P1, **open** | The maintainer. See the open item below. |
| Retention period for the `AnalyticsEvent` table | **Urgent, open.** The WhatsApp ledger rows carry Meta message IDs that may decode to the sender's phone number, and the table has no retention limit. These rows outlive the 90 day contact purge. | The maintainer and SCCF |
| PostgreSQL 1-year retention for safety events + feedback | ~~P2~~ **Done** | — |
| PostgreSQL 90-day WhatsApp contact purging | ~~P2~~ **Done** | — |
| Log redaction for phone/Aadhaar patterns | P3 | Gautam |

---

## Open item: the retention purge is not scheduled

**Status on 21 November 2026: open.**

No Cloud Scheduler job for the retention purge exists in production. The jobs in `us-central1` were listed on that date and none calls `POST /v1/admin/housekeeping/run-retention`.

The retention periods in this document are therefore implemented in code and are not being applied on a schedule. Data older than the stated periods may still be held. Whether the purge has ever been run by hand in production is TO CONFIRM.

The maintainer must create the job. The list of scheduled jobs is in `docs/OPERATIONS.md` section 10. This document should be updated once the job exists and its first run has been checked.
