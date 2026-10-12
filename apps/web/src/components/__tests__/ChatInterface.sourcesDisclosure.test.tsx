import { act, render, screen } from '@testing-library/react';
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

/**
 * The shape /v1/chat actually returns: marker-free text, plus a `citations`
 * array that carries only ids (no title, no URL). Synthetic content.
 */
const realShapeResponse = {
  sessionId: 'session-1',
  messageId: 'msg-1',
  responseText: 'Synthetic grounded answer. Treatment decisions belong with your care team.',
  safety: { classification: 'normal', actions: [] },
  citations: [
    { docId: 'kb_en_synthetic_doc_v1', chunkId: 'chunk-1', position: 26, sourceType: 'NCI', isTrustedSource: true },
  ],
  citationConfidence: 'GREEN',
};

describe('ChatInterface — "About Our Sources" disclosure (issue #90)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Welcome seen, sources disclosure NOT seen — so it opens on the first answer.
    installLocalStorage({ suchi_welcome_seen: 'true' });
    Element.prototype.scrollIntoView = vi.fn();
    getSession.mockResolvedValue({
      sessionId: 'session-1',
      createdAt: '2026-09-10T00:00:00.000Z',
      greetingCompleted: true,
      currentGreetingStep: null,
      userContext: null,
      cancerType: null,
    });
    sendMessage.mockResolvedValue(realShapeResponse);
  });

  const askOnce = async () => {
    render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Type your message...'), 'Synthetic question?');
    await user.keyboard('{Enter}');
    await act(async () => {
      await Promise.resolve();
    });
    const title = await screen.findByText('About Our Sources');
    return title.parentElement as HTMLElement;
  };

  it('no longer promises per-answer citations the reader can verify', async () => {
    const modal = await askOnce();
    const copy = modal.textContent ?? '';

    expect(copy).not.toMatch(/citation/i);
    expect(copy).not.toMatch(/each response includes/i);
    expect(copy).not.toMatch(/so you can verify/i);
  });

  it('describes what is true: trusted sources, no per-answer list, check with a doctor', async () => {
    const modal = await askOnce();
    const copy = modal.textContent ?? '';

    expect(copy).toContain('National Cancer Institute (NCI)');
    expect(copy).toMatch(/do not list their sources/i);
    expect(copy).toMatch(/doctor or care team/i);
  });

  it('shows no per-answer source list, because the API sends nothing a reader could follow', async () => {
    await askOnce();

    const log = screen.getByRole('log');
    expect(log.textContent).toContain('Synthetic grounded answer.');
    // The id-only citations array must not be turned into fabricated sources.
    expect(log.textContent).not.toContain('kb_en_synthetic_doc_v1');
    expect(log.textContent).not.toMatch(/Source \d|Sources \(/);
    expect(log.textContent).not.toMatch(/\[\d+\]/);
  });
});
