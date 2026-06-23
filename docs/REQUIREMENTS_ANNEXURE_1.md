# Annexure 1: Requirements for Suchi Cancer Bot and Funding Bot

**Document:** Human-in-the-Loop AI Systems for SCCF Strategic Implementation  
**Status:** Approved strategic requirements  
**Scope:** Suchi Cancer Bot (this repo) + Funding Bot (separate repo: diksha-funding-bot)  
**Note:** Sections 9.x, 15.2, 16.2 (Funding Bot) are reproduced here for completeness but implemented in the separate Funding Bot repo.

---

## 1. Purpose of this Annexure

This annexure defines the functional, operational, governance, and human-review requirements for two AI-enabled systems that will support the implementation of Suchitra Cancer Care Foundation's strategic plan:

1. **Suchi Cancer Bot** — SCCF's patient and caregiver guidance layer.
2. **Funding Bot** — SCCF's fundraising, donor intelligence, proposal, documentation, and reporting layer.

Together, these systems will help SCCF operate as a lean, high-trust, AI-enabled cancer communication and navigation organisation.

The purpose of these systems is not to replace doctors, human judgement, medical advisors, or organisational leadership. Their role is to increase SCCF's capacity to listen, respond, document, learn, fundraise, and improve — while keeping humans in control of all sensitive decisions.

## 2. Strategic Context

SCCF's strategic plan positions the organisation as a cancer communication, navigation, and patient-support nonprofit that helps patients and caregivers make sense of complex cancer-care journeys.

Cancer care is not organised neatly by state boundaries. Patients often travel across districts, cities, and states for diagnosis, treatment, second opinions, surgery, chemotherapy, radiotherapy, palliative care, and follow-up. Their journey may involve local doctors, diagnostic centres, regional hospitals, specialist oncology centres, and major national institutions.

SCCF's role is to support people moving through these complex care pathways by providing:

* reliable cancer information,
* patient-friendly explanations,
* doctor-consultation preparedness,
* caregiver support,
* non-diagnostic digital guidance,
* awareness material,
* expert knowledge,
* and compassionate navigation.

Suchi and Funding Bot will act as implementation infrastructure for this strategy.

## 3. Overall AI Implementation Philosophy

SCCF will use AI as infrastructure for care, not as a replacement for care.

The guiding principle is:

> AI should help SCCF listen better, respond faster, document learning, and mobilise resources responsibly — while human beings retain responsibility for medical safety, ethical judgement, donor communication, and strategic decisions.

Both Suchi and Funding Bot must therefore follow a **human-in-the-loop model**.

## 4. System Overview

### 4.1 Suchi Cancer Bot

Suchi is SCCF's AI-enabled cancer information and navigation assistant.

It helps patients, caregivers, and community members understand cancer-related information in simple language, prepare for medical consultations, access SCCF-approved resources, and identify when professional professional medical care is needed.

Suchi must always remain non-diagnostic and non-prescriptive.

### 4.2 Funding Bot

Funding Bot is SCCF's AI-enabled fundraising and institutional documentation assistant.

It helps SCCF identify funding opportunities, profile donors, prepare proposals, generate concept notes, maintain donor communication, draft reports, prepare budgets, and convert program learning into funder-ready documentation.

Funding Bot must never use identifiable patient data without explicit permission and human review.

## 5. Core Operating Model

The two systems will work together through a learning loop:

1. SCCF creates expert-reviewed cancer knowledge through Onco Talks, medical advisors, trusted sources, and patient-facing content.
2. Suchi uses SCCF-approved knowledge to respond to users safely.
3. Human reviewers examine high-risk queries, content gaps, and user feedback.
4. SCCF identifies recurring patient and caregiver needs.
5. The program team creates new resources, campaigns, guides, or navigation tools.
6. Funding Bot converts program learning into donor updates, concept notes, proposals, reports, and fundraising material.
7. Human leadership reviews donor-facing material before use.
8. Fundraising supports further content, navigation, Suchi development, and awareness work.

## 6. Shared System Principles

Both Suchi and Funding Bot must follow the following principles.

### 6.1 Human-in-the-Loop Control

Human review is mandatory for:

* medical content,
* high-risk patient guidance,
* escalation cases,
* donor-facing proposals,
* financial projections,
* institutional claims,
* sensitive stories,
* public communication,
* and any content involving identifiable individuals.

### 6.2 Safety and Accuracy

The systems must avoid:

* unsupported claims,
* hallucinated facts,
* medical overreach,
* invented statistics,
* invented doctor names,
* invented institutional partnerships,
* exaggerated impact numbers,
* and unreviewed recommendations.

### 6.3 Privacy and Consent

The systems must avoid unnecessary collection of personal data.

Patient-identifiable data must not be used in fundraising, reports, AI prompts, or public communication unless:

* consent has been obtained,
* identifying details are removed where possible,
* the use has been reviewed by SCCF leadership,
* and the purpose is ethically justified.

### 6.4 Documentation

Both systems must maintain clear logs of:

* generated outputs,
* human approvals,
* revisions,
* published content,
* rejected content,
* escalation cases,
* and known limitations.

### 6.5 Language Accessibility

The systems should initially support:

* English,
* Hindi,
* Hinglish.

Future expansion may include:

* Bengali,
* Odia,
* Nepali,
* and other languages based on partnerships and medical review capacity.

No new language should be launched publicly unless SCCF can review medically sensitive content in that language.

## 7. User Roles

### 7.1 Suchi User Roles

#### Patient / Caregiver

A person seeking simple, reliable cancer information or guidance on what to ask doctors.

#### Community Member

A person seeking awareness information about symptoms, screening, prevention, or myths.

#### Field Worker / Volunteer

A person supporting patients or families and needing patient-friendly explanations.

#### SCCF Program Reviewer

A staff member reviewing Suchi conversations, escalation cases, and content gaps.

#### Medical Reviewer

A doctor or qualified medical advisor reviewing high-risk content or medical explanations.

#### System Admin

A technical or operational user managing knowledge base updates, logs, analytics, and configuration.

### 7.2 Funding Bot User Roles

*(Implemented in diksha-funding-bot repo)*

## 8. Suchi Cancer Bot Requirements

### 8.1 Objectives

Suchi must help users:

1. understand basic cancer information,
2. prepare for oncology consultations,
3. access SCCF-approved resources,
4. understand common cancer terms,
5. identify when medical consultation is needed,
6. access caregiver support,
7. receive emotionally sensitive responses,
8. avoid misinformation,
9. and feel less alone.

### 8.2 In Scope

Suchi may provide:

* general cancer awareness,
* explanation of common cancer terms,
* treatment journey explanations,
* doctor consultation preparation,
* questions to ask the doctor,
* caregiver guidance,
* side-effect awareness with referral to medical care,
* screening awareness,
* prevention information,
* palliative care awareness,
* emotional reassurance,
* links to SCCF-approved resources,
* escalation prompts when risk is detected.

### 8.3 Out of Scope

Suchi must not:

* diagnose cancer,
* rule out cancer,
* prescribe medicines,
* recommend a treatment plan,
* interpret reports as a doctor,
* compare hospitals irresponsibly,
* rank doctors,
* recommend stopping treatment,
* suggest alternative cures,
* provide emergency medical management beyond urging immediate care,
* give false reassurance,
* or pretend to be a human doctor.

### 8.4 Required User Journeys

Suchi must support the following priority user journeys:

#### Journey 1: Newly Diagnosed Patient

User has recently received a cancer diagnosis and wants to understand what happens next.

Required response: reassure calmly, explain that a cancer diagnosis needs specialist guidance, suggest questions to ask the oncologist, explain common next steps, offer SCCF resource links, avoid treatment recommendation.

#### Journey 2: Caregiver Reading a Report

User shares or describes medical terms from a report.

Required response: explain general meaning of terms, state that reports must be interpreted by a qualified doctor, help prepare questions for the doctor, avoid definitive interpretation.

#### Journey 3: Person Worried About Symptoms

User describes symptoms and asks whether it is cancer.

Required response: never diagnose, explain that symptoms can have many causes, identify red flags where appropriate, encourage timely medical consultation, avoid panic.

#### Journey 4: Treatment Preparation

User is preparing for chemotherapy, radiation, surgery, or immunotherapy.

Required response: explain what to generally expect, suggest preparation questions, mention side effects in general terms, encourage following the treating team's advice.

#### Journey 5: Caregiver Stress

User expresses fear, exhaustion, or emotional burden.

Required response: respond with empathy, normalise caregiver stress, suggest practical next steps, encourage support from family, doctor, counsellor, or trusted person, escalate if self-harm or crisis language appears.

#### Journey 6: Emergency or Red-Flag Situation

User mentions severe symptoms, distress, bleeding, breathlessness, unconsciousness, suicidal thoughts, or other urgent signals.

Required response: advise immediate medical attention, avoid detailed treatment advice, provide emergency escalation language, mark the case for human review where possible.

### 8.5 Knowledge Base Requirements

Suchi must use a structured, reviewed knowledge base.

Each knowledge-base entry should include:

* title,
* cancer type or topic,
* language,
* source,
* reviewer name or review status,
* last updated date,
* risk category (A / B / C — see §8.6),
* approved usage scope,
* and version number.

### 8.6 Content Risk Classification

#### Category A: Low-Risk Awareness

Examples: general awareness, myths, prevention, screening basics, glossary terms.

Review requirement: internal review, periodic medical review.

#### Category B: Medium-Risk Treatment Explanation

Examples: chemotherapy, radiation, surgery, side effects, staging, biopsy, palliative care.

Review requirement: medical review before public deployment.

#### Category C: High-Risk Guidance

Examples: symptoms, emergencies, report interpretation, treatment decisions, side-effect severity, distress or crisis language.

Review requirement: strict medical review, escalation logic, and continuous monitoring.

### 8.7 Safety Requirements

Suchi must:

1. introduce itself clearly as a non-diagnostic guidance assistant,
2. state that it does not replace doctors,
3. avoid definitive medical claims,
4. encourage consultation with qualified professionals,
5. escalate urgent cases,
6. respond safely to distress,
7. avoid false reassurance,
8. avoid treatment prescriptions,
9. avoid alternative cure claims,
10. maintain logs for review,
11. use only approved knowledge sources,
12. and clearly say when it does not know.

### 8.8 Human Review Requirements for Suchi

Human review is required for:

* high-risk user queries,
* symptom-related conversations,
* report-related queries,
* side-effect severity questions,
* mental distress,
* complaints about doctors or hospitals,
* requests for second opinion,
* requests for treatment decision-making,
* user feedback indicating harm or confusion,
* and any bot response flagged by confidence or safety filters.

### 8.9 Suchi Outputs

Suchi should be able to generate:

* simple explanations,
* doctor question lists,
* caregiver guidance,
* resource links,
* consultation preparation notes,
* myth-busting responses,
* awareness messages,
* escalation prompts,
* and internal content-gap reports.

### 8.10 Suchi Analytics

Suchi should track:

* number of users,
* number of conversations,
* common topics,
* common cancer types,
* language used,
* high-risk queries,
* escalation cases,
* unanswered questions,
* repeated myths,
* frequently requested resources,
* user satisfaction where possible,
* and content gaps.

Analytics must be anonymised before being used for fundraising or reporting.

## 9. Funding Bot Requirements

*(Implemented in diksha-funding-bot repo — see that repo's REQUIREMENTS.md)*

## 10. Integration Between Suchi and Funding Bot

Suchi and Funding Bot should not freely share identifiable user data.

### 10.1 Permitted Data Flow

Suchi may provide Funding Bot with:

* common question categories,
* anonymised topic trends,
* content gaps,
* language needs,
* user journey insights,
* aggregate interaction numbers,
* escalation category counts,
* feedback summaries,
* and resource usage patterns.

### 10.2 Prohibited Data Flow

Suchi must not provide Funding Bot with:

* patient names, phone numbers, medical reports, identifiable stories, personal diagnosis details, location details linked to a specific person, family information, chat transcripts with identifiers, or any sensitive data without explicit consent and review.

### 10.3 Learning Loop Requirement

The combined system should produce a monthly SCCF Learning Note covering:

1. What patients and caregivers are asking.
2. What content gaps exist.
3. What risks or distress patterns appeared.
4. What new resources are needed.
5. What donor opportunities align with these needs.
6. What program changes should be considered.

## 11. Admin Dashboard Requirements

### 11.1 Suchi Dashboard

Should display:

* total conversations,
* topics asked,
* language mix,
* high-risk flags,
* escalation cases,
* unanswered questions,
* content gaps,
* reviewed responses,
* user feedback,
* and resource links used.

## 12. Human Approval Matrix

| Output / Decision | AI Can Draft | Human Review Required | Final Approval |
|---|---|---|---|
| General cancer awareness content | Yes | Yes | Content/Medical reviewer depending on risk |
| Treatment explanation | Yes | Yes | Medical reviewer |
| Symptom-related guidance | Limited | Yes | Medical reviewer / Program lead |
| Emergency response language | Template only | Yes | Medical reviewer |
| Suchi public deployment | No | Yes | Founder / Advisory group |

## 13. Non-Functional Requirements

| Requirement | Description |
|---|---|
| Reliability | Dependable for regular staff use; clear fallback processes |
| Security | Sensitive information stored securely, access restricted |
| Privacy | Data minimisation; collect only what is necessary |
| Auditability | Key outputs, approvals, revisions traceable |
| Maintainability | Content, prompts, KB, workflows version-controlled |
| Accessibility | Outputs understandable to non-specialist users; simple language |
| Scalability | Expand from internal pilot to public use in stages |
| Interoperability | Works with Google Drive, Docs, Sheets, Gmail, Slack, website CMS, WhatsApp |

## 14. Implementation Phases

| Phase | Timeline | Key Outputs |
|---|---|---|
| 1: Internal Setup | Months 1–3 | Suchi prototype, Funding Bot internal workflow, approval matrix, risk register |
| 2: Controlled Pilot | Months 4–6 | Pilot report, reviewed KB v1, proposal templates, safety improvement list |
| 3: Limited External Use | Months 7–12 | 25–40 reviewed resources, Suchi dashboard, monthly learning notes, Year 1 donor report |
| 4: Expanded Deployment | Year 2+ | Public Suchi, multilingual expansion, stronger donor pipeline, annual impact report |

## 15. Suchi MVP Requirements

The Suchi MVP must include:

1. Clear introduction and disclaimer.
2. English and Hindi/Hinglish support.
3. Basic cancer glossary.
4. Doctor question preparation feature.
5. Treatment journey explainers.
6. Caregiver support responses.
7. Red-flag escalation logic.
8. Human review flagging.
9. Reviewed knowledge base.
10. Conversation logging.
11. Basic analytics.
12. Content gap reporting.

## 16. Success Metrics — Suchi

* number of conversations,
* percentage of safe responses,
* number of flagged high-risk cases,
* number of human-reviewed cases,
* user satisfaction,
* number of content gaps identified,
* number of resources used,
* number of consultation-preparation guides generated,
* number of languages supported,
* and number of improvements made from review.

## 17. Key Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Medical overreach | Strict disclaimers, reviewed KB, no diagnosis, escalation logic, regular audit |
| AI hallucination | Retrieval from approved sources, restricted scope, uncertainty labels, human review |
| Privacy breach | Data minimisation, anonymisation, restricted access, consent policy |
| Language expansion without review capacity | Language launch checklist, reviewer availability, pilot testing, no public rollout without medical review |
