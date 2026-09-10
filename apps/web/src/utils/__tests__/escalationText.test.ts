import { describe, it, expect } from 'vitest';
import { ESCALATION_RAG_SEPARATOR, resolveEscalationText } from '../escalationText';

// Verbatim opening of the S2 escalation template
// (apps/api/src/modules/chat/response-templates.ts).
const ESCALATION = `Some of what you described could be urgent. Please seek emergency medical care now.

**Call for help immediately:**
• **112** (national emergency number) or **108** (ambulance service)`;

const RAG_HALF = `**Educational answer**:
A new lump should be checked by a doctor.`;

describe('resolveEscalationText', () => {
  it('prefers the explicit bannerText sent by the API', () => {
    const composed = ESCALATION + ESCALATION_RAG_SEPARATOR + RAG_HALF;
    expect(resolveEscalationText(composed, ESCALATION)).toBe(ESCALATION);
  });

  it('falls back to slicing at the separator when bannerText is absent', () => {
    const composed = ESCALATION + ESCALATION_RAG_SEPARATOR + RAG_HALF;
    expect(resolveEscalationText(composed)).toBe(ESCALATION);
  });

  it('does not alter the escalation copy when slicing', () => {
    const composed = ESCALATION + ESCALATION_RAG_SEPARATOR + RAG_HALF;
    // Byte-identical: the fix changes where text is rendered, never what it says.
    expect(composed.startsWith(resolveEscalationText(composed))).toBe(true);
  });

  it('drops the appended RAG half so the answer is not duplicated in the banner', () => {
    const composed = ESCALATION + ESCALATION_RAG_SEPARATOR + RAG_HALF;
    expect(resolveEscalationText(composed)).not.toContain('Educational answer');
    expect(resolveEscalationText(composed)).not.toContain('Information from trusted sources');
  });

  it('returns the whole response when no RAG half was appended', () => {
    expect(resolveEscalationText(ESCALATION)).toBe(ESCALATION);
  });

  it('ignores a blank bannerText and falls back to slicing', () => {
    const composed = ESCALATION + ESCALATION_RAG_SEPARATOR + RAG_HALF;
    expect(resolveEscalationText(composed, '   ')).toBe(ESCALATION);
    expect(resolveEscalationText(composed, null)).toBe(ESCALATION);
  });
});
