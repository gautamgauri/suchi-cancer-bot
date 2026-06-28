# Suchi: Hindi and Hinglish Requirements (v1.0)

**Product:** Suchi cancer-information and navigation assistant
**Release context:** Hindi functionality is a **launch requirement for the WhatsApp channel**, not a later localisation enhancement.
**Primary objective:** A person writing in Hindi, Hinglish, or mixed Hindi-English must receive the **same safety boundaries, useful information, and escalation pathways** as a person writing in English.

> Canonical source for the Hindi + WhatsApp release. Implementation coverage and gaps are tracked in the appendix at the bottom of this file (keep it current as PRs land).

---

## 1. Product principles
- **Safety parity, not translation parity.** Hindi support is complete only when safety, intent recognition, retrieval, templates, and escalation work equivalently across English, Devanagari Hindi, and Romanized Hindi.
- **No diagnosis or prognosis.** Suchi may explain information and suggest appropriate next steps, but must not tell a user that they have cancer, confirm a cancer type, guarantee recovery, or dismiss concerning symptoms.
- **Match the user's language and script.** The response should use the user's preferred language and script wherever reliably inferred.
- **Plain, respectful language.** Conversational Hindi appropriate for WhatsApp, without patronising reassurance or bureaucratic wording.
- **Medical terms must remain recognisable.** At first mention, use a simple Hindi explanation plus the recognised English term where helpful, e.g. "बायोप्सी (biopsy)" or "कीमोथेरेपी (chemotherapy)".
- **Fail safe.** When language understanding is uncertain, safety checks and escalation must still operate. A detector must never be bypassed merely because text is Hindi, mixed-script, misspelled, or transliterated.

## 2. Scope for the first Hindi + WhatsApp release
**Included:** text in English / Devanagari / Romanized / mixed; Hindi responses for all core journeys; Hindi safety verification, distress detection, escalation language; Hindi/Hinglish intent classification, signal extraction, template routing; Hindi query expansion + answer generation; WhatsApp-safe formatting/chunking; per-user language/script preference with override.

**Explicitly deferred:** report/scan/pathology image interpretation; audio/voice-note transcription (unless a separate tested pipeline ships); diagnosis/triage as clinician substitute, prescriptions, emergency medical decisions; Indian languages beyond Hindi/Hinglish.

## 3. Supported language modes

| Mode | Example input | Expected response mode |
|---|---|---|
| English | "What happens after a biopsy?" | English |
| Hindi (Devanagari) | "बायोप्सी के बाद क्या होता है?" | Hindi in Devanagari |
| Romanized Hindi / Hinglish | "biopsy ke baad kya hota hai?" | Romanized Hindi/Hinglish by default |
| Mixed Hindi-English | "मुझे chemo ke side effects जानने हैं" | Predominantly Hindi, preserving familiar English medical terms |

**Language selection rules**
- Explicit user choice always wins: "Hindi mein," "English please," "Roman Hindi mein."
- Otherwise, respond in the script used by the current message when confidence is high.
- Preserve the previous confirmed preference for the WhatsApp contact unless the user switches language.
- When script/language confidence is low, use concise bilingual clarification rather than silently defaulting to English.
- Do not switch a Devanagari user into Romanized Hindi, or an English user into Hindi, without a clear signal.

## 4. Functional requirements

**FR-1: Shared text normalisation.** Before every safety, intent, entity, translation, or routing decision, create a normalized representation. The normalizer must handle: Unicode normalization for Devanagari; zero-width/invisible characters; extra spaces, punctuation variation, repeated characters, common WhatsApp typing patterns; Hindi words written together or split apart; common Romanized variants (kya/ka/ki, cancer/kainsar, chemo/kimo, biopsy/baipsi); mixed-script sentences. The original message must remain available for display, audit, and response generation — normalization is for detection and routing only.

**FR-2: Hindi/Hinglish intent classification.** Recognise the same core journeys as English (general info; personal symptom concern; cancer-type info; test/report/biopsy/scan/pathology; treatment options + side effects; "what next?" / navigation; second opinion; hospital/doctor/location/affordability/Ayushman; caregiver + emotional support; urgent/crisis/self-harm; greeting/small-talk/general). Must NOT route clear personal concerns ("mujhe lymphoma hai kya", "how do I know if I have cancer", "meri biopsy aa gayi, ab kya karna hai") to `UNCLEAR_REQUEST`.

**FR-3: Entity and signal extraction.** Recognise/normalize cancer types + variants; diagnostic terms (biopsy, pathology, FNAC, CT/CAT, PET, MRI, blood test, report, stage); treatment terms (chemo, radiation/radiotherapy, surgery, immunotherapy, targeted); navigation terms (second opinion, hospital, doctor, cost, Ayushman, referral, appointment); clinical-context signals (report received, treatment started, side effect, symptom duration, caregiver role, location); negation/uncertainty ("nahi", "shayad", "confirm nahi hua", "sirf doubt hai"). Must preserve uncertainty — never convert a suspected condition into a confirmed diagnosis.

**FR-4: Hindi safety verifier.** Runs against every final Hindi/Hinglish response (templates, retrieval, fallback, handoff). Detects/blocks/rewrites: diagnosis/confirmation; prognosis certainty / cure guarantees; minimisation/dismissal under clinical uncertainty; unsafe medical instruction / unsupported remedies / delay of care; stigmatising/blaming/coercive language; missing crisis escalation. Detection must run on (a) original text, (b) normalized text, and (c) a semantic/translated representation where available — failure of one path must not suppress the others.

**FR-5: Distress and crisis detection.** Identify Hindi/Hinglish fear/panic/anxiety/overwhelm; hopelessness/inability to cope; self-harm ideation/intent; immediate danger/emergency. For high-risk: short compassionate Hindi/Hinglish; encourage immediate contact with local emergency services / a trusted person / a clinician; present a configurable verified escalation route; never imply Suchi is monitoring the user or can provide emergency response.

**FR-6: Retrieval and answer generation.** Hindi/Hinglish queries retrieve from approved KB via query expansion / controlled translation / bilingual indexing. Preserve the user's medical terms and intended question; use only approved evidence-based sources; answer in the preferred language/script; keep the source's clinical caution and uncertainty; say when a clinician should confirm; never fabricate a Hindi source, translation, hospital option, or clinical fact.

**FR-7: Hindi response templates.** Created or clinically reviewed in Hindi (not mechanically translated). Every core journey needs a Hindi/Hinglish version with: a direct answer/acknowledgement; safe bounded explanation; practical next steps; a clear escalation condition; one focused follow-up question only when it materially improves routing. For WhatsApp, favour short paragraphs, numbered actions, readable line breaks.

**FR-8: Care navigation and location handling.** Hindi/Hinglish hospital / second-opinion / affordability / Ayushman / appointment queries retain all existing navigation capability. Distinguish information-seeking from personal navigation; request city/district only when needed; avoid promising appointment availability or funding eligibility; explain uncertainty plainly where eligibility/availability requires verification.

**FR-9: WhatsApp channel behaviour.** Accept Hindi/Hinglish/English/mixed text without corrupting characters; respond in the user's selected language/script; keep each message below a configurable threshold (default target 3,200 chars); never split a sentence, safety warning, helpline instruction, or numbered action across messages; put the essential answer + next step first; max three outbound messages for a normal answer (longer → summarize + offer to continue); handle unsupported media safely (acknowledge limitation, request typed details, never imply an image/report was reviewed); store language preference + conversation state securely per contact.

## 5. Hindi response style guide
**Required:** respectful second person ("आप"); calm/direct/non-alarmist; short sentences, familiar words; acknowledge emotion without claiming certainty; familiar English medical terms where they aid comprehension.

**Preferred formulations**
- "यह चिंता की बात हो सकती है, लेकिन केवल इन लक्षणों से कैंसर की पुष्टि नहीं की जा सकती।"
- "रिपोर्ट को डॉक्टर के साथ समझना सबसे सही रहेगा। आप चाहें तो बताइए कि रिपोर्ट किस जांच की है।"
- "अगर दर्द बहुत तेज है, सांस लेने में दिक्कत है, या हालत अचानक बिगड़ रही है, तो तुरंत स्थानीय आपातकालीन सहायता लें।"

**Prohibited:** "आपको कैंसर है।"; "आप बिल्कुल ठीक हो जाएंगे।"; "चिंता मत करो, कुछ नहीं है।"; "यह इलाज जरूर काम करेगा।"; any statement that makes Suchi sound like a doctor, emergency service, or confirmed diagnostic authority.

## 6. Acceptance tests and launch gate
Every high-risk flow needs English + Devanagari + Romanized + mixed-script examples.

**Safety regression set:** diagnosis assertions; prognosis/cure guarantees; false reassurance/minimisation; self-harm/hopelessness/inability-to-cope; severe-symptom/emergency guidance; unsafe treatments/unverified remedies; benign greetings & non-medical messages (false-positive guard).

**Understanding regression set:** biopsy/pathology/scan/chemo/radiation/surgery/second-opinion/Ayushman/hospital/cost/report-received signals; cancer-type synonyms + spelling variation; Hinglish + mixed-script; negation + uncertainty; general-vs-personal distinction; correct language/script propagation through planner, templates, retrieval, and final WhatsApp output.

**End-to-end WhatsApp tests** (per journey): `incoming → normalization → language selection → intent/signal extraction → knowledge/template route → safety verifier → WhatsApp chunking → stored preference`.

**Release criteria — all required before release:**
1. No high-risk false negatives in the curated Hindi/Hinglish safety regression suite.
2. No high-risk safety test bypassed due to script, transliteration, spacing, or Unicode variation.
3. All core journeys return an answer in the correct user-selected language/script.
4. The output verifier runs for templates, RAG responses, fallbacks, and escalation messages.
5. WhatsApp chunking preserves complete safety instructions.
6. Native Hindi reviewers complete a structured usability review of the top care journeys.
7. The full API suite passes serially via `npx jest --runInBand`.
8. A named owner signs off the Hindi safety suite and the WhatsApp channel integration.

## 7. Delivery sequence
- **Phase 1 — Safety & language foundation:** shared normalizer; Hindi/Hinglish safety rules; crisis/distress handling; language/script preference model; regression test matrix.
- **Phase 2 — Understanding & response quality:** intent classifier + entity/signal coverage; query expansion + retrieval; Hindi clinical templates; planner + locale propagation.
- **Phase 3 — WhatsApp readiness:** channel adapter, formatting, chunking, persistence; unsupported-media handling; end-to-end tests + native-speaker UAT; controlled pilot with monitoring + human review.

## 8. Definition of done
Hindi functionality is complete only when a Hindi/Hinglish WhatsApp user can ask a common cancer question, disclose emotional distress, seek care navigation, or ask what to do after a test — and Suchi reliably understands the request, responds in the appropriate language and script, stays within clinical boundaries, and provides an appropriate next step.

---

## Appendix A — Implementation coverage & gaps (as of 2026-06-23)

Maps each requirement to the work in flight (PRs #30–#38) and flags what remains. **Status:** ✅ done · ◑ partial · ⬜ gap (launch-blocking unless deferred).

| Req | Status | Where / what's done | Gap to close before release |
|---|---|---|---|
| **§3 language modes** | ◑ | `selectResponseLanguage()` (en/hi/hinglish/unknown) + per-language directive (#37); per-contact `WhatsAppContact.locale` (#30). | **Explicit user override** ("Hindi mein"/"English please") not implemented; preference is *detected*, not user-settable; low-confidence bilingual clarification not wired. |
| **FR-1 normalisation** | ◑ | `normalizeForMatch()` — NFC, zero-width, smart-quotes, whitespace (#31), used by safety/empathy/output-verifier. | Not applied **before every** intent/entity/routing decision (classifier/decomposer/cross-lingual use raw text). No Romanized-variant folding (kya/ka/ki, kainsar, kimo, baipsi) or repeated-char collapse. |
| **FR-2 intent** | ◑ | Personal-concern → PERSONAL_SYMPTOMS (#36); Romanized symptom/personal detection (#37); "signs of" → INFORMATIONAL_SYMPTOMS. | Full Hinglish coverage of caregiver / second-opinion / Ayushman journeys unverified; needs the understanding regression matrix. |
| **FR-3 entity/signal** | ◑ | CAT/CT synonym + generic-token fix (#35); Hindi/Hinglish biopsy/report/chemo/scheme signals (#32). | **Negation & uncertainty** ("nahi", "shayad", "confirm nahi hua") not modelled; FNAC/PET/stage + cancer-type spelling variants incomplete. |
| **FR-4 safety verifier** | ◑ | Hindi/Romanized diagnosis/prognosis/tone, `\b`-bug fixed, regression matrix (#31); runs on normalized text. | Semantic/translated detection path (c) not implemented; verifier not yet proven to run on **every** template/handoff path. |
| **FR-5 distress/crisis** | ✅◑ | Hindi + Romanized crisis/self-harm/hopelessness/anxious (#31, #37). | Configurable verified escalation route + Hindi escalation copy review pending. |
| **FR-6 retrieval/answer** | ◑ | Cross-lingual query expansion + dictionary ordering + thresholds (#32). | Answer-language directive applied only on the symptom-soft-redirect path — **not** on explain/RAG generation; "answer in preferred script" not guaranteed end-to-end. |
| **FR-7 Hindi templates** | ⬜ | `renderTemplate` has some `headingHi`. | Core-journey templates **authored/clinically reviewed in Hindi** do not exist — this is a Phase-2 build. |
| **FR-8 care navigation** | ◑ | Navigate-mode + hospital routing reused; scheme/Ayushman keywords (#32). | Info-vs-personal distinction for Hinglish navigation + uncertainty phrasing unverified. |
| **FR-9 WhatsApp** | ◑ | Channel via ChatService, formatting, 4096-char split, media-safe stub, per-contact session (#30); `undefined`-guard (#38). | Threshold not set to **3,200**; chunking does **not** guarantee never splitting a safety warning / numbered action; no **3-message cap** + "continue" summary; language **override** + preference write-back missing. |
| **Launch gate** | ⬜ | Safety + Romanized regression suites exist (#31, #37). | Full serial suite not yet green on a single branch (PRs unmerged); native-speaker UAT not done; named-owner sign-off pending. |

**Net:** Phase 1 (safety + language foundation) is largely covered by #31/#36/#37/#38. Phase 2 gaps: FR-1 universal+variant normalization, FR-3 negation/uncertainty, FR-6 answer-language on all paths, **FR-7 Hindi templates (largest gap)**. Phase 3 gaps: FR-9 chunking-safety + 3-message cap + threshold, language override/persistence, native-speaker UAT.
