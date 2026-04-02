/**
 * Strip markdown formatting and shorten responses for voice/TTS delivery.
 * Applied as a final post-processing step when channel === 'voice'.
 */
export function stripForVoice(text: string): string {
  let result = text;

  // Remove bold markdown: **text** → text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');

  // Remove italic markdown: *text* → text (but not bullet points)
  result = result.replace(/(?<!\n\s*)\*([^*\n]+)\*/g, '$1');

  // Remove heading markers: ## Heading → Heading
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Convert bullet lists to flowing text
  result = result.replace(/^\s*[-*•]\s+/gm, '');

  // Convert numbered lists to flowing text
  result = result.replace(/^\s*\d+\.\s+/gm, '');

  // Remove citation markers [citation:docId:chunkId]
  result = result.replace(/\s*\[citation:[^\]]*\]/g, '');
  result = result.replace(/\s*\[source:[^\]]*\]/g, '');

  // Remove markdown horizontal rules
  result = result.replace(/^---+\s*$/gm, '');

  // Remove all disclaimer blocks (visual, not voice-friendly)
  result = result.replace(/\*?This information is for general educational purposes[^]*?personalized guidance\.?\*?/gi, '');
  result = result.replace(/^\*?Important:?.*?educational purposes[^]*?guidance\.?\*?$/gim, '');
  result = result.replace(/^\*?If this is a medical emergency.*?emergency medical care\.?\*?$/gim, '');

  // Remove any remaining standalone italic text (leftover disclaimer fragments)
  result = result.replace(/^\*[^*]{20,}\*$/gm, '');

  // Remove "Note:" prefix formatting
  result = result.replace(/\*\*Note:\*\*\s*/g, 'Note: ');

  // Remove any remaining ** bold markers the first pass missed
  result = result.replace(/\*\*/g, '');

  // Remove any remaining * markers (standalone, not mid-word)
  result = result.replace(/(?<=\s)\*(?=\s)/g, '');
  result = result.replace(/^\*\s/gm, '');

  // Remove markdown horizontal rules (--- or ***)
  result = result.replace(/^[-*]{3,}\s*$/gm, '');

  // Remove "I understand you're experiencing symptoms" duplicate template block
  result = result.replace(/I understand you're experiencing symptoms\.\s*To help you better.*?symptoms worsen or become severe/gs, '');

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim
  result = result.trim();

  // Add a simple spoken disclaimer at the end if not already present
  if (!result.includes('not medical advice') && !result.includes('not a substitute') && !result.includes('consult your doctor for personalized')) {
    result += '\n\nPlease remember, this is general information and not medical advice. Always consult your doctor for personalized guidance.';
  }

  return result;
}
