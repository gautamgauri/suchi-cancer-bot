import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SafetyBanner } from '../SafetyBanner';

// Verbatim head of the S2 escalation template
// (apps/api/src/modules/chat/response-templates.ts).
const ESCALATION = `Some of what you described could be urgent. Please seek emergency medical care now.

**Call for help immediately:**
• **112** (national emergency number) or **108** (ambulance service)
• **102** (medical emergency helpline, available in many states)

---
*If this is a medical emergency, call 112 or 108 immediately.*`;

describe('SafetyBanner', () => {
  describe('markdown rendering (issue #111)', () => {
    // Live prod DOM proof, run 2026-09-10T19-02-52 (q05):
    //   banner: literal_asterisks=true,  <strong>=0, <em>=0
    //   bubble: literal_asterisks=false, <strong>=8, <em>=1
    // The banner must go through the same markdown pipeline as the bubble.
    it('renders bold markers as <strong>, not literal asterisks', () => {
      const { container } = render(
        <SafetyBanner classification="red_flag" message={ESCALATION} />
      );

      expect(container.textContent).not.toContain('**');
      expect(container.querySelectorAll('strong').length).toBeGreaterThan(0);
      expect(screen.getByText('112')).toBeInTheDocument();
    });

    it('does not leak a raw horizontal rule', () => {
      const { container } = render(
        <SafetyBanner classification="red_flag" message={ESCALATION} />
      );

      expect(container.textContent).not.toContain('---');
      expect(container.querySelector('hr')).toBeInTheDocument();
    });

    it('does not leak citation markers', () => {
      const { container } = render(
        <SafetyBanner
          classification="red_flag"
          message={'Call **112** now [citation:doc1:chunk1].'}
        />
      );

      expect(container.textContent).not.toContain('[citation:');
    });
  });

  describe('classification', () => {
    it('shows the emergency title for red_flag', () => {
      render(<SafetyBanner classification="red_flag" message="Call 112." />);
      expect(screen.getByText('Seek Emergency Medical Care')).toBeInTheDocument();
    });

    it('shows the notice title for self_harm', () => {
      render(<SafetyBanner classification="self_harm" message="Support is available." />);
      expect(screen.getByText('Important Notice')).toBeInTheDocument();
    });
  });
});
