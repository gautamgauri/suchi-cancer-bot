/**
 * Strip markdown formatting and shorten responses for voice/TTS delivery.
 * Applied as a final post-processing step when channel === 'voice'.
 */
export function stripForVoice(text: string): string {
  let result = text;

  // ── Remove source/citation blocks ─────────────────────────────────
  // "**This answer is based on information from the following trusted sources:**"
  result = result.replace(/\*?\*?This answer is based on information from.*$/gs, '');

  // Numbered source lists: "1. Signs and Symptoms of Breast Cancer - NCI"
  result = result.replace(/^\d+\.\s+.+[-–]\s*(NCI|WHO|AIIMS|Indian Cancer).*$/gm, '');

  // ── Remove all disclaimer blocks ──────────────────────────────────
  // Italic disclaimer: *This information is for general educational...*
  result = result.replace(/\*This information is for general educational[^]*?guidance\.\*/gi, '');
  // Non-italic disclaimer
  result = result.replace(/This information is for general educational purposes only[^]*?personalized guidance\./gi, '');
  // Important disclaimer at start
  result = result.replace(/^\s*\*?\*?Important:?\*?\*?\s*This information is for general educational[^]*?guidance\.\s*/gim, '');
  // Emergency disclaimer
  result = result.replace(/\*?If this is a medical emergency[^]*?emergency medical care\.\*?/gi, '');

  // ── Remove markdown formatting ────────────────────────────────────
  // Bold: **text** → text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  // Any remaining ** markers
  result = result.replace(/\*\*/g, '');

  // Italic: *text* → text (but not bullet markers)
  result = result.replace(/(?<!\n\s*)\*([^*\n]+)\*/g, '$1');

  // Heading markers: ## Heading → Heading
  result = result.replace(/^#{1,6}\s+/gm, '');

  // Bullet lists: * item or - item → item
  result = result.replace(/^\s*[-*•]\s+/gm, '');

  // Numbered lists: 1. item → item
  result = result.replace(/^\s*\d+\.\s+/gm, '');

  // Citation markers [citation:docId:chunkId]
  result = result.replace(/\s*\[citation:[^\]]*\]/g, '');
  result = result.replace(/\s*\[source:[^\]]*\]/g, '');

  // Horizontal rules (--- or ***)
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // Standalone italic fragments (leftover disclaimer bits)
  result = result.replace(/^\*[^*]{20,}\*$/gm, '');
  // Standalone * markers
  result = result.replace(/(?<=\s)\*(?=\s)/g, '');
  result = result.replace(/^\*\s/gm, '');

  // ── Remove duplicate template blocks ──────────────────────────────
  // Only remove the SECOND occurrence of the navigate-mode template (if duplicated)
  const navigateTemplate = /I understand (this can be worrying|you're experiencing symptoms)\.\s*Many symptoms like these/g;
  const matches = [...result.matchAll(navigateTemplate)];
  if (matches.length > 1) {
    // Remove from second occurrence to "How often do they occur?"
    const secondStart = matches[1].index!;
    const endPattern = result.indexOf('How often do they occur?', secondStart);
    if (endPattern > secondStart) {
      result = result.substring(0, secondStart) + result.substring(endPattern + 'How often do they occur?'.length);
    }
  }

  // "Key points to be aware of:" section if it duplicates earlier content
  // Keep only the first occurrence
  const keyPointsMatch = result.match(/Key points to be aware of:/g);
  if (keyPointsMatch && keyPointsMatch.length > 1) {
    const idx = result.lastIndexOf('Key points to be aware of:');
    const nextSection = result.indexOf('\n\n', idx);
    result = result.substring(0, idx) + (nextSection > -1 ? result.substring(nextSection) : '');
  }

  // "What to do next:" duplicate — keep first only
  const nextStepsMatch = result.match(/What to do next:/g);
  if (nextStepsMatch && nextStepsMatch.length > 1) {
    const idx = result.lastIndexOf('What to do next:');
    const nextSection = result.indexOf('\n\n', idx + 20);
    result = result.substring(0, idx) + (nextSection > -1 ? result.substring(nextSection) : '');
  }

  // ── Clean up ──────────────────────────────────────────────────────
  // Multiple blank lines → single
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim
  result = result.trim();

  // ── Add spoken disclaimer if missing ──────────────────────────────
  if (!result.includes('not medical advice') && !result.includes('not a substitute') && !result.includes('consult your doctor for personalized')) {
    result += '\n\nPlease remember, this is general information and not medical advice. Always consult your doctor for personalized guidance.';
  }

  return result;
}
