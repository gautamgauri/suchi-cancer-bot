# Suchitra Cancer Bot (“Suchi”) — Phase 1 PRD (Website-based Chat)
**Version:** v1.0  
**Owner:** SCCF (Suchitra Cancer Care Foundation)

## Purpose
Launch a public website chat for non-diagnostic cancer information + navigation, with strong safety guardrails, basic analytics, and a lightweight admin review capability.

## Goals
1. Web chat MVP with consent + disclaimers.
2. Safety policy engine (emergency/self-harm/refusal).
3. KB-backed answers (RAG) with doc IDs for traceability.
4. Feedback + basic analytics.
5. Architecture foundations for Phase 2 (App) and Phase 3 (WhatsApp).

## Non-goals
Diagnosis, prescribing, dosage recommendations, definitive interpretation of labs/scans, appointment booking, EMR.

## Users
Patients, caregivers, general public.

## Key UX
- Consent gate + emergency warning
- Chat UI with suggested prompts, feedback, “start over”
- Clear sections: Next steps / Red flags / Questions to ask a doctor

## Functional Requirements
- Session creation
- Chat endpoint with policy engine first, then KB retrieval, then LLM response generation
- Feedback endpoint
- Admin read-only endpoints for conversations + metrics
- Minimal PII by default (anonymous sessions)

## Acceptance Criteria
- Disclaimers/consent present
- Refusal + red-flag handling works
- Feedback stored
- Admin endpoints protected
- Logging/telemetry in place
