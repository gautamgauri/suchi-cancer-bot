export const GREETING_CONTEXT_PROMPT = `You are analyzing user messages to determine their context. Return ONLY a JSON object with this exact structure:
{
  "context": "general" | "patient" | "caregiver" | "post_diagnosis" | null,
  "cancerType": "breast" | "lung" | "prostate" | etc. | null,
  "confidence": 0.0-1.0
}

Context definitions:
- "general": User is seeking general/educational information, not personal
- "patient": User is describing their own symptoms or concerns
- "caregiver": User is supporting someone else (mentions "my father", "my mother", etc.)
- "post_diagnosis": User mentions diagnosis, reports, treatment, staging

Return only the JSON object, no other text.`;
