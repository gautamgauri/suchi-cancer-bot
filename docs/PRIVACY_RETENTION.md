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
| TTS audio output | GCS `suchi-tts-audio` bucket, signed URLs (60 min TTL) | Expiry: 7 days (see below) |
| Article drafts + queue | GCS `suchi-navigator-state` bucket | Gautam, Divya |
| Hospital directory | GCS + committed to git (`hospitals.json`) | Gautam, Divya, Nisha |
| Langfuse traces | Langfuse US cloud (third-party) | Gautam |

---

## What data Suchi does NOT collect

- No names, phone numbers, or Aadhaar/ID numbers from users
- No location beyond what the user voluntarily shares in text
- No cookies or persistent browser identifiers (session ID is ephemeral per conversation)
- No payment information

---

## Retention periods

| Data | Retention period | Rationale |
|---|---|---|
| Conversation messages | **90 days** | Sufficient for quality review; minimises patient-adjacent data at rest |
| Session metadata | **90 days** | Linked to message retention |
| Safety events | **1 year** | Required for audit; safety events are not message content |
| Feedback | **1 year** | Used for quality improvement |
| TTS audio (GCS) | **7 days** | Signed URLs expire in 60 min; raw files cleaned by GCS lifecycle rule |
| Langfuse traces | **30 days** (Langfuse default) | Observability only |
| Article drafts (GCS) | Until published or archived | Content pipeline operational data |

**Implementation status:**
- 90-day message/session deletion: **not yet implemented** — needs a scheduled job or GCS TTL equivalent on PostgreSQL
- TTS GCS lifecycle rule: **not yet configured** — add a 7-day Object Lifecycle policy on `suchi-tts-audio`
- Safety event 1-year retention: **not yet implemented**

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
| PostgreSQL 90-day retention job (messages + sessions) | P1 | Gautam |
| GCS lifecycle rule for TTS audio bucket (7-day delete) | P1 | Gautam |
| PostgreSQL 1-year retention for safety events + feedback | P2 | Gautam |
| Log redaction for phone/Aadhaar patterns | P3 | Gautam |
