import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMessage = vi.fn();
const getSession = vi.fn();

vi.mock('../../services/api', () => ({
  apiService: {
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    getSession: (...args: unknown[]) => getSession(...args),
    createSession: vi.fn(),
    submitFeedback: vi.fn(),
  },
}));

import { ChatInterface } from '../ChatInterface';

// Head of the S2 escalation template, verbatim
// (apps/api/src/modules/chat/response-templates.ts).
const ESCALATION = `Some of what you described could be urgent. Please seek emergency medical care now.

**Call for help immediately:**
• **112** (national emergency number) or **108** (ambulance service)`;

// The separator chat.service.ts uses to append the RAG answer on the urgent path.
const SEPARATOR = '\n\n**Information from trusted sources:**\n\n';

const RAG_HALF = `**Educational answer**:
A new lump should be *evaluated* by a doctor within a few days.`;

const COMPOSED = ESCALATION + SEPARATOR + RAG_HALF;

const escalatedResponse = (extra: Record<string, unknown> = {}) => ({
  sessionId: 'session-1',
  messageId: 'msg-1',
  responseText: COMPOSED,
  safety: {
    classification: 'red_flag',
    actions: ['show_emergency_banner', 'end_conversation'],
    ...extra,
  },
});

function installLocalStorage(seed: Record<string, string>) {
  const store = new Map(Object.entries(seed));
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
}

const bannerContent = () =>
  screen.getByText('Seek Emergency Medical Care').parentElement as HTMLElement;

const sendQuestion = async () => {
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText('Type your message...');
  await user.type(input, 'I found a hard lump. Is this an emergency?');
  await user.keyboard('{Enter}');
  // ChatInterface refreshes greeting state after every reply; settle those
  // promises here so the assertions below run against a quiet component.
  await act(async () => {
    await Promise.resolve();
  });
};

describe('ChatInterface — emergency banner (issue #111)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom in this project runs without a Storage implementation, and
    // ChatInterface reads localStorage on every reply.
    installLocalStorage({
      suchi_welcome_seen: 'true',
      suchi_sources_disclosure_seen: 'true',
    });
    // jsdom does not implement scrollIntoView; ChatInterface calls it on every
    // new message.
    Element.prototype.scrollIntoView = vi.fn();
    getSession.mockResolvedValue({
      sessionId: 'session-1',
      createdAt: '2026-09-10T00:00:00.000Z',
      greetingCompleted: true,
      currentGreetingStep: null,
      userContext: null,
      cancerType: null,
    });
  });

  it('shows only the escalation block in the banner, never the appended answer', async () => {
    sendMessage.mockResolvedValue(escalatedResponse({ bannerText: ESCALATION }));
    render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);

    await sendQuestion();
    await screen.findByText('Seek Emergency Medical Care');

    const banner = bannerContent();
    expect(banner.textContent).toContain('seek emergency medical care now');
    // The ~3,000-char answer must not be repeated inside the emergency card.
    expect(banner.textContent).not.toContain('Educational answer');
    expect(banner.textContent).not.toContain('Information from trusted sources');
  });

  it('renders the banner as markdown — no literal ** or --- reaches the patient', async () => {
    sendMessage.mockResolvedValue(escalatedResponse({ bannerText: ESCALATION }));
    render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);

    await sendQuestion();
    await screen.findByText('Seek Emergency Medical Care');

    const banner = bannerContent();
    expect(banner.textContent).not.toContain('**');
    expect(banner.textContent).not.toContain('---');
    expect(banner.querySelectorAll('strong').length).toBeGreaterThan(0);
  });

  it('falls back to slicing at the separator when the API sends no bannerText', async () => {
    // Guards the currently-deployed API build, which has no bannerText field.
    sendMessage.mockResolvedValue(escalatedResponse());
    render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);

    await sendQuestion();
    await screen.findByText('Seek Emergency Medical Care');

    const banner = bannerContent();
    expect(banner.textContent).not.toContain('**');
    expect(banner.textContent).not.toContain('Educational answer');
    expect(banner.textContent).toContain('seek emergency medical care now');
  });

  it('keeps the full answer once, in the message bubble, rendered as markdown', async () => {
    sendMessage.mockResolvedValue(escalatedResponse({ bannerText: ESCALATION }));
    const { container } = render(
      <ChatInterface sessionId="session-1" onStartOver={vi.fn()} />
    );

    await sendQuestion();
    await screen.findByText('Seek Emergency Medical Care');

    const bubble = await waitFor(() => {
      const log = container.querySelector('[role="log"]') as HTMLElement;
      expect(log.textContent).toContain('Educational answer');
      return log;
    });

    expect(bubble.textContent).not.toContain('**');
    expect(bubble.querySelectorAll('strong').length).toBeGreaterThan(0);
    expect(bubble.querySelectorAll('em').length).toBeGreaterThan(0);

    // The appended answer appears exactly once in the whole page.
    const occurrences = (container.textContent ?? '').split('Educational answer').length - 1;
    expect(occurrences).toBe(1);
  });
});
