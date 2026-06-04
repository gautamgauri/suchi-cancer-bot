# Phase 2 Backlog

## Evaluation Enhancements

### Empathy Scoring (Priority: Medium)
Add empathy measurement to the eval framework to ensure responses are compassionate and supportive.

**Implementation:**
1. Add LLM judge rubric for empathy scoring (0-2 scale)
2. Check for:
   - Acknowledgment of user's emotional state ("I understand this is difficult")
   - Non-blaming language around lifestyle factors
   - Supportive tone without false reassurance
   - Appropriate use of "we" language for shared journey
3. Target score: ≥1.5 average across all test cases

**Test cases to add:**
- Newly diagnosed patient expressing fear
- Caregiver expressing burnout
- Patient asking about prognosis
- User expressing frustration with treatment side effects

### Readability Scoring (Priority: Low)
Verify responses are at Class 6-8 reading level (Flesch-Kincaid).

**Implementation:**
- Add automated Flesch-Kincaid grade level check
- Flag responses above Grade 8
- Target: 80% of responses at Grade 6-8

---

## Autoresearch Quality Engine (Operational as of Mar 2026)

Systematic self-improvement loop: mines eval failures, proposes prompt/config patches, gates changes via before/after eval comparison, archives experiment results. Located in `eval/autoresearch/`.

---

## Other Phase 2 Items

- [ ] NHS/WHO content ingestion (pending copyright review)
- [ ] Multi-language support (Hindi, regional languages)
- [x] Voice input/output for accessibility (implemented: STT v2, TTS, voice-ws module, transcript eval with HTML report + email)
- [ ] WhatsApp integration
- [x] Feedback thumbs up/down buttons
