# Identify Requirements Prompt

> Repairable surface: extracted from `apps/api/src/modules/llm/llm.service.ts` → `getIdentifyRequirements()`
> This file is the source of truth for the identify-requirements structured checklist.
> The autoresearch loop may modify this file within safety constraints.

---

If the user asks "how to identify" cancer (or warning signs / how doctors confirm), you MUST output the following 4 sections with these minimum requirements.

IMPORTANT: {{cancerTypeContext}} All content MUST come from the provided REFERENCE LIST (RAG chunks). Do NOT make up information. If a required item is not in the references, note that it's not available rather than inventing it.

1) WARNING SIGNS (minimum 7 bullet points, plain language)
Extract {{cancerTypeLabel}} warning signs from the references. Look for signs that are SPECIFIC to {{cancerTypeTarget}}. Include:
- Any lumps, masses, or unusual growths mentioned in references
- Changes in size, shape, or appearance mentioned in references
- Any discharge, bleeding, or fluid changes mentioned in references
- Skin changes (if mentioned in references for this cancer type)
- Swollen lymph nodes (if mentioned in references)
- Systemic symptoms (weight loss, fatigue, fever, night sweats, etc. - if mentioned in references)
- Any other warning signs SPECIFIC to {{cancerTypeLabel2}} mentioned in the references

CRITICAL: You MUST cite EVERY warning sign using [citation:docId:chunkId] format. Example: "- Swollen lymph nodes [citation:kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1:a8b17b8f-2a5c-495f-b176-5e467affe9e4]". Use the exact docId and chunkId from the REFERENCE LIST below.

2) HOW DOCTORS CONFIRM (minimum 4 bullet points - you MUST list at least 4 distinct diagnostic methods)
Extract ALL diagnostic methods SPECIFIC to {{cancerTypeTarget}} from the references. You MUST include:

- Physical/clinical examination methods mentioned in references (e.g., physical exam, chest examination, lymph node examination)
- Imaging tests SPECIFIC to {{cancerTypeImaging}} - List ALL imaging tests mentioned: X-ray, CT scan, CT, MRI, PET scan, ultrasound, mammogram, bronchoscopy, etc. (as mentioned in references)
- Biopsy types and procedures mentioned in references - MUST be included if mentioned, and explicitly state it as the diagnostic gold standard / confirmation step if the references indicate this. Include specific biopsy types (e.g., needle biopsy, surgical biopsy, bronchoscopy biopsy) if mentioned.
- Pathology, staging, and molecular testing mentioned in references (receptor testing, genetic markers, tumor markers, histology, etc. - as mentioned in references)

EVIDENCE-ONLY POLICY (CRITICAL):
- DO NOT use phrases like "common tests include...", "usually doctors do...", "often done..." unless these exact phrases appear in the retrieved references
- DO NOT add general medical knowledge - only state what is explicitly mentioned in the retrieved chunks
- If a test/treatment/symptom is not mentioned in the references, DO NOT include it - omit it entirely
- Every bullet point MUST be directly supported by content in the retrieved chunks

Include the sentence: "Symptoms cannot confirm cancer; confirmation requires medical evaluation and often a biopsy." (only if this concept appears in references)

CRITICAL: You MUST cite EVERY diagnostic method using [citation:docId:chunkId] format. Example: "- CT scan is used to detect lung cancer [citation:kb_en_nci_types_lung_hp_non_small_cell_lung_treatment_pdq_v1:chunk-id]". Use the exact docId and chunkId from the REFERENCE LIST below.

3) WHEN TO SEEK CARE (timeline + urgency - MUST include specific timeframe)
Extract timeline guidance SPECIFIC to {{cancerTypeTarget}} from the references.

CRITICAL TIMELINE REQUIREMENT: You MUST include a SPECIFIC timeframe with numbers in your response. DO NOT use vague phrases like "promptly", "soon", or "as soon as possible" without a specific timeframe. You MUST include one of these exact formats:
- "If symptoms persist for 2-4 weeks, seek medical evaluation"
- "Seek medical care within 1-2 weeks if symptoms persist"
- "Consult a doctor within 2-4 weeks of noticing symptoms"
- "If symptoms last more than 2 weeks, see a healthcare provider"
- "Seek evaluation within 2-4 weeks if symptoms persist"

If references mention specific timelines, include them exactly. If references don't mention a specific timeframe, you MUST state: "I don't have enough information in my NCI sources to provide a specific timeline. Please consult a clinician for guidance on when to seek care."

Also include urgent vs routine distinction:
- Urgent care: If symptoms are severe, rapidly worsening, or include red flags (e.g., significant bleeding, severe pain, difficulty breathing), seek care immediately or within days
- Routine care: For persistent but stable symptoms, seek evaluation within 2-4 weeks (MUST include the "2-4 weeks" timeframe explicitly)

CRITICAL: You MUST cite timeline/urgency information using [citation:docId:chunkId] format. Example: "If symptoms persist for 2-4 weeks, seek medical evaluation [citation:kb_en_nci_types_lymphoma_patient_adult_nhl_treatment_pdq_v1:a8b17b8f-2a5c-495f-b176-5e467affe9e4]". Use the exact docId and chunkId from the REFERENCE LIST below.

4) QUESTIONS TO ASK THE DOCTOR (minimum 7 questions)
Generate practical questions based on information in the references for {{cancerTypeTarget}}. Include questions about:
- What imaging or tests are needed for {{cancerTypeImaging}} and why? (if references discuss imaging/tests)
- Do I need a biopsy? Which type is used for {{cancerTypeImaging}}? (if references discuss biopsy)
- If cancer is confirmed, what staging or subtype tests will be done? (if references discuss staging/subtyping)
- What follow-up interval is recommended? (if references discuss follow-up)
- What symptoms should trigger earlier return? (if references discuss symptom monitoring)
Plus 2 additional practical questions based on reference content for {{cancerTypeTarget}} (referral, timeline, costs, where to go, etc.)

CITATION REQUIREMENTS (BLOCKING - READ CAREFULLY):
Without proper citations, your response will be REJECTED and the user will receive a fallback message.

YOU MUST:
1. Include [citation:docId:chunkId] for EVERY factual medical statement
2. Use the EXACT docId and chunkId from the REFERENCE LIST below
3. Copy the format EXACTLY as shown in this example:

EXAMPLE (copy this format exactly):
"Lung cancer is diagnosed through imaging tests [citation:kb_en_nci_types_lung_hp_non_small_cell_lung_treatment_pdq_v1:0cac033f-1d34-48ae-8ef1-d15a6682a2d2] and confirmed with biopsy [citation:kb_en_nci_types_lung_patient_non_small_cell_lung_treatment_pdq_v1:a8b17b8f-2a5c-495f-b176-5e467affe9e4]."

DO NOT use:
- Numbered references like [1], [2]
- Parenthetical citations like (NCI, 2024)
- Phrases like "according to sources"

Your response MUST include at least 2 citations in [citation:docId:chunkId] format or it will be rejected.
If you cannot find information in the references, say so clearly rather than making it up.

Do NOT ask more clarifying questions if the user has indicated general intent (e.g., "generally asking").

## Template Variables

The following placeholders are used at runtime:

- `{{cancerTypeContext}}` — e.g., "The user is asking about lung cancer. Extract information SPECIFIC to lung cancer from the references." or "The user is asking about cancer in general. Extract relevant information from the references."
- `{{cancerTypeLabel}}` — e.g., "lung cancer " (with trailing space) or "" (empty for general)
- `{{cancerTypeTarget}}` — e.g., "this cancer type" or "the cancer type mentioned"
- `{{cancerTypeLabel2}}` — e.g., "lung cancer" or "this cancer type"
- `{{cancerTypeImaging}}` — e.g., "this cancer type" or "this cancer"
