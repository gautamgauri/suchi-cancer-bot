# Privacy and Data Retention Policy

**Version:** 1.0  
**Date:** Jun 2026  
**Owner:** SCCF / Suchi product  
**Status:** Adopted — implementation partially complete (see gaps below)

---

## What data Suchi collects

| Data | Where stored | Who can access |
|---|---|---|
| Conversation messages (user queries + assistant responses) | PostgreSQL `message` table | Gautam (DB access), future: admin panel read-only |
| Session metadata (channel, locale, cancerType, emotionalState) | PostgreSQL `session` table | Gautam |
| Safety events (classification, rule fired, session/message ID) | PostgreSQL `safetyEvent` table | Gautam |
| Feedback (thumbs up/down, free-text) | PostgreSQL `feedback` table | Gautam |
| Voice audio (STT input) | **Not persisted** — transcribed and discarded | N/A |
| Voice transcripts (STT transcript text) | PostgreSQL `voiceInteraction` table | Gautam |
| WhatsApp contacts (E.164 phone numbers mapped to session) | PostgreSQL `whatsAppContact` table | Gautam |
| TTS audio output | GCS `suchi-tts-audio` bucket, signed URLs (60 min TTL) | Expiry: 7 days (see below) |
| Article drafts + queue | GCS `suchi-navigator-state` bucket | Gautam, Divya |
| Hospital directory | GCS + committed to git (`hospitals.json`) | Gautam, Divya, Nisha |
| Langfuse traces | Langfuse US cloud (third-party) | Gautam |

---

## What data Suchi does NOT collect

- No names or Aadhaar/ID numbers from users. Note: E.164 phone numbers are collected only for WhatsApp users to map inbound messages to conversation sessions.
- No location beyond what the user voluntarily shares in text
- No cookies or persistent browser identifiers (web session ID is ephemeral per conversation)
- No payment information

---

## Retention periods

| Data | Retention period | Rationale |
|---|---|---|
| Conversation messages | **90 days** | Sufficient for quality review; minimises patient-adjacent data at rest |
| Session metadata | **90 days** | Linked to message retention |
| Voice transcripts | **90 days** | Purged along with conversation metadata |
| WhatsApp contacts | **90 days** | Purged when inactive for 90 days to protect phone number privacy |
| Safety events | **1 year** | Required for audit; safety events are not message content |
| Feedback | **1 year** | Used for quality improvement |
| TTS audio (GCS) | **7 days** | Signed URLs expire in 60 min; raw files cleaned by GCS lifecycle rule |
| Langfuse traces | **30 days** (Langfuse default) | Observability only |
| Article drafts (GCS) | Until published or archived | Content pipeline operational data |

**Implementation status:**
- 90-day message/session deletion: **implemented** — `RetentionService` + `POST /v1/admin/housekeeping/run-retention`; schedule weekly via Cloud Scheduler
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

Suchi does not currently have a user account system — sessions are ephemeral and not linked to identity. Users cannot be identified across sessions. Therefore:
- No right-to-deletion workflow is needed (data is not linked to identity)
- No right-to-access workflow is needed

If an identified user (e.g., via future WhatsApp integration with phone number) requests deletion, the session ID can be located by phone number and all associated records deleted manually.

---

## Implementation backlog

| Item | Priority | Owner |
|---|---|---|
| PostgreSQL 90-day retention job (messages + sessions) | ~~P1~~ **Done** | — |
| GCS lifecycle rule for TTS audio bucket (7-day delete) | ~~P1~~ **Done** | — |
| Cloud Scheduler job for run-retention (weekly) | P1 | Gautam — add job at console.cloud.google.com |
| PostgreSQL 1-year retention for safety events + feedback | ~~P2~~ **Done** | — |
| PostgreSQL 90-day WhatsApp contact purging | ~~P2~~ **Done** | — |
| Log redaction for phone/Aadhaar patterns | P3 | Gautam |
