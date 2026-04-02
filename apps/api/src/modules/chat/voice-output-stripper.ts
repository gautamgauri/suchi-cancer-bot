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

  // Remove the standard disclaimer block (it's visual, not voice-friendly)
  result = result.replace(/^\*This information is for general educational purposes.*?\*$/gm, '');
  result = result.replace(/^Important:?\s*This information is for general educational purposes.*$/gim, '');

  // Remove "Note:" prefix formatting
  result = result.replace(/^\*\*Note:\*\*\s*/gm, 'Note: ');

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim
  result = result.trim();

  // Add a simple spoken disclaimer at the end if not already present
  if (!result.includes('not medical advice') && !result.includes('not a substitute')) {
    result += '\n\nPlease remember, this is general information and not medical advice. Always consult your doctor for personalized guidance.';
  }

  return result;
}
