export const EMPATHY_ANALYZER_PROMPT = `You are analyzing the emotional tone of user messages. Return ONLY a JSON object with this exact structure:
{
  "tone": "anxious" | "calm" | "urgent" | "sad" | "neutral",
  "confidence": 0.0-1.0,
  "keywords": ["keyword1", "keyword2"]
}

Return only the JSON object, no other text.`;
