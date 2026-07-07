# Language Launch Checklist (NFR-LANG-001)

**Policy:** No new language may be deployed to production unless both gates below are passed.

---

## Gate 1 — Medical Reviewer Available

A named Medical Reviewer must be confirmed who:

- Holds a relevant medical qualification (doctor, nurse, medical social worker, or clinical specialist)
- Can read, review, and approve medical content in the target language
- Has agreed in writing to review KB entries and chat response samples before launch
- Will remain available for at least 6 months post-launch for ongoing review

**Why:** Cancer information in a language without medical review capacity cannot be safely deployed. A grammatically correct translation may still contain medical errors or cultural mismatches that require a clinical reader to catch.

---

## Gate 2 — Minimum Reviewed KB Entries

At least **20 knowledge-base entries** in the target language must be:

1. Written or translated into the target language
2. Reviewed and approved by the Medical Reviewer (Gate 1)
3. Committed to `kb/{locale}/` with `reviewStatus: "approved"` and `reviewerName` set in frontmatter
4. Ingested into the vector store (`npm run kb:ingest`)

The 20 entries must cover at minimum:

| Required topic | Category |
|---|---|
| What is cancer (general awareness) | A |
| Common cancer warning signs | A |
| When to see a doctor | A |
| Cancer myths and facts | A |
| Chemotherapy — what to expect | B |
| Radiation — what to expect | B |
| Surgery — what to expect | B |
| Side effects of treatment | B |
| Palliative care basics | B |
| Emergency red flags | C |
| Caregiver support | A |
| Screening awareness (at least 2 cancer types) | A/B |

---

## Launch Approval

Before production deployment, the founder/program lead must confirm:

- [ ] Gate 1 passed — Medical Reviewer named and confirmed
- [ ] Gate 2 passed — 20+ reviewed KB entries ingested
- [ ] Safety module tested with sample queries in the new language
- [ ] Emergency patterns verified in the new language (emergency-fast-path.ts)
- [ ] Soft redirect tested for personal symptom queries in the new language

---

## Current Language Status

| Language | Status | Medical Reviewer | KB Entries |
|---|---|---|---|
| English (`en`) | Live | NCI sources (trusted) | 80+ |
| Hindi / Hinglish (`hi`) | Live (mixed with English) | NCI adapted | Partial |
| Bengali (`bn`) | Not started | — | 0 |
| Odia (`or`) | Not started | — | 0 |
| Nepali (`ne`) | Not started | — | 0 |

> **Current Code-Level Support Note:** Although the roadmap prioritizes Bengali, Odia, and Nepali as the next launch languages, the codebase already contains native support for **Bhojpuri (`bh`)** and **Maithili (`mai`)** within the safety disclaimer engine (`disclaimer-engine.ts`); the emergency fast path (`emergency-fast-path.ts`) additionally covers Bhojpuri (but not Maithili). Once medical reviewers are assigned and the 20+ KB entries are written/approved in Bhojpuri or Maithili, these languages can be launched using the existing code foundations.

---

*Reference: NFR-LANG-001, REQUIREMENTS.md §15.7*
