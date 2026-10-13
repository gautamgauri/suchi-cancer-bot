# KB content proposal — "does a biopsy spread cancer?" (REQUIRES SCCF REVIEW)

**Status:** proposal only. No clinical text is written here; this document
records *what is missing, where it would live, and what it needs to cover*, so
SCCF medical reviewers can author or source the content. Written by a coding
agent under AGENTS.md §1.3 (medical content requires SCCF human review).

**Trigger:** issue #136 — daily web QA run `2026-09-13T04-00-12_seed1789272008`,
`q04 [myth] (hi)`: *"लोग कहते हैं कि बायोप्सी कराने से कैंसर फैल जाता है। क्या यह सच है?"*
The runtime routing defect that answered with a bare definition is fixed in
PR #137. This proposal covers the second half of the problem: the knowledge
base has nothing that corrects the claim.

## What was checked (2026-09-13)

| Where | Method | Result |
|---|---|---|
| `kb/manifest.json` (1451 docs) | search id/title/tags/url for `myth`, `misconception`, `biops` | **0** myth/misconception documents; the only `biopsy`-tagged doc is `kb_en_oral_cancer_signs_diagnosis_treatment_v1` (oral-cancer signs/diagnosis), which is not about procedure safety |
| `scripts/nci-ingestion/nci_urls_*.json` (NCI crawl lists) | search for a `myths` URL, `diagnosis-staging/diagnosis`, `biopsy` | none present — the NCI "Common Cancer Myths and Misconceptions" page and the general "How Cancer Is Diagnosed" page were never in the crawl |
| `eval/hybrid_retrieval_scenarios.json`, `eval/cases/` | search for biopsy-safety / myth scenarios | only a generic "How is cancer diagnosed?" retrieval case; no `myth` eval cases |
| `kb/en/**` text | — | **not checkable**: gitignored, not on the machine, DB access out of scope |

**Unverified assumption:** an incidental sentence in one of the 1433 NCI
PDQ documents might touch on this. Nothing in the manifest points to a
document dedicated to it, and production retrieval for the Hindi probe surfaced
only PDQ glossary definitions of "biopsy" from pediatric treatment summaries.

## Why this matters

The belief that a biopsy "spreads" cancer is a documented reason patients in
the service area delay or refuse diagnosis. It is also one of the harness's
standing `myth` probes, so the gap will keep reproducing in QA until content
exists.

## Proposed content (high level — for SCCF to author/source)

- **Where it would live:** a new document under `kb/en/02_nci_core/` if
  sourced from NCI (public domain; the NCI *Common Cancer Myths and
  Misconceptions* page is the obvious candidate and also covers the sugar
  myth that q01 is currently answering from nutrition/CAM chunks), or under
  `kb/en/01_suchi_oncotalks/` if SCCF prefers its own patient-facing wording.
  Manifest entry with `tags` including `myth`, `misconception`, `biopsy`,
  `diagnosis`, `audienceLevel: patient`.
- **What it needs to cover (topics, not wording):**
  1. Directly answer the claim: whether a biopsy causes cancer to spread, and
     how rare that is according to the cited source.
  2. Why the procedure is needed (only way to confirm a diagnosis and plan
     treatment) and what delaying it costs.
  3. The precautions clinicians take during biopsies/surgery that address the
     concern (as described by the source).
  4. Reassurance framing suitable for a worried caregiver, in patient-level
     language; must translate cleanly to Hindi/Hinglish (the production reply
     was correctly in Hindi — the language path works, the content does not
     exist).
- **Companion items in the same page, if the NCI myths page is used:** sugar
  and cancer growth, "cancer is contagious", herbal cures, mobile phones,
  deodorants, hair dye — each is a recurring probe category.

## Follow-ups outside SCCF (not done here, tracked for coordination)

- Add a `myth` category to `eval/cases/` and a biopsy-safety scenario to
  `eval/hybrid_retrieval_scenarios.json` once the document exists, so the
  Tier1 canary would catch a regression.
- Retrieval note for #134 coordination: for a Devanagari query the English
  full-text arm can never contribute (every retrieved chunk had `lexSim: 0`),
  so the "long query" weighting in `hybridSearchWithMetadata` (55 % vector /
  45 % lexical) leaves the ranking to embedding similarity alone. That is a
  separate weakness from #134's tsquery shape and is *not* what caused #136.

## Boundaries

No KB files, prompts, safety keyword lists or clinical wording are changed
by the PR carrying this document. Authoring the content is an SCCF decision.
