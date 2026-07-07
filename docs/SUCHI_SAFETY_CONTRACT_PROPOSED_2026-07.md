# Proposed Updates to the Suchi Safety Contract — July 2026

**Status: DRAFT — NOT CANONICAL. Pending SCCF medical/policy review.**

This document proposes amendments to `docs/SUCHI_SAFETY_CONTRACT.md` (the canonical
safety contract). It exists because the July 2026 docs-vs-code audit found that the
**code already enforces behavior the contract does not describe**. Nothing here
proposes a code change: every item below documents behavior that is implemented and
live. SCCF sign-off aligns the written policy with the implementation (or, if SCCF
disagrees with any item, triggers a code change to match policy).

Reviewer: SCCF (via Gautam). On approval, fold each accepted section into
`SUCHI_SAFETY_CONTRACT.md` and delete this file. On rejection of any item, open an
issue to change the code instead.

---

## Proposal 1 — Add three categories to the Hard "NO" (Auto-Refuse) list

The contract lists 5 auto-refuse areas. Code enforces these additional ones
(`apps/api/src/modules/safety/safety.rules.ts`, `safety.service.ts`,
`safety.templates.ts`):

6. **Misinformation & Alternative Cure Claims**
   - Stopping prescribed treatments ("can I stop chemo?") — enforced by
     `MISINFO_STOP_TREATMENT`.
   - Curing cancer with alternative remedies alone — enforced by
     `MISINFO_ALTERNATIVE_ONLY`.

7. **Prognosis Predictions**
   - Life expectancy or survival outcome predictions — enforced by
     `REFUSAL_PROGNOSIS_V1` (dedicated refusal template).

8. **Self-Harm and Mental Health Crisis**
   - Self-harm queries route to a dedicated crisis template with helpline numbers
     (separate `self_harm` classification; never treated as a medical query).

## Proposal 2 — Add the `symptoms` row to the evidence-threshold table

`trusted-sources.config.ts` defines a threshold the contract's table omits:

| Query Type | Min Passages | Min Sources | Rationale |
|------------|--------------|-------------|-----------|
| Symptoms | 2 | 1 | Symptom info should come from an authoritative source |

## Proposal 3 — Document the implemented "Safe + Useful" abstention policy

The contract's Abstention Criteria describe strict "grounded or silent" behavior.
The implemented evidence gate (`evidence-gate.service.ts`) is deliberately softer:

1. **Threshold relaxation:** if any Tier-1 source (e.g. `01_suchi_oncotalks`,
   `02_nci_core`, `05_india_ncg`) is present among retrieved chunks, thresholds
   relax to 1 passage / 1 source, preferring weak-but-trusted educational content
   over abstention.
2. **Bypass for general/identify queries:** non-personal "generally asking" /
   "how to identify" queries with some evidence bypass abstention entirely.
3. **Abstention still applies** for untrusted-only evidence (`LOW_TRUST`) and
   very low similarity with no Tier-1 source (`LOW_SCORE`, avg similarity < 0.3);
   the safe fallback response (navigation + clinician referral, no medical
   content) is returned.

**This is the highest-stakes item**: it means Suchi will answer some questions the
current contract says it should abstain from. If SCCF prefers the stricter
contract behavior, the relaxation in `evidence-gate.service.ts` must be removed or
tightened — that is a product/medical decision, not an engineering one.
