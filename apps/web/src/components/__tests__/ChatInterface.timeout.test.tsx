import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Exercise the real apiService so the whole 504 chain is covered: axios
// rejects, services/api.ts recovers the body, ChatInterface renders it.
const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock('axios', () => {
  const isAxiosError = (err: any) => Boolean(err?.isAxiosError);
  return {
    default: {
      create: () => ({ post: mocks.post, get: mocks.get }),
      isAxiosError,
    },
    isAxiosError,
  };
});

import { ChatInterface } from '../ChatInterface';

// The 55s turn-timeout body, verbatim from
// apps/api/src/modules/chat/chat.controller.ts:52-57.
const FALLBACK_TEXT =
  "I'm sorry — my response is taking longer than expected. " +
  'In the meantime, here are some general steps you can take:\n\n' +
  '1. **Talk to a doctor**: If you have symptoms or concerns about cancer, the most important step is seeing a healthcare professional.\n' +
  '2. **Indian Cancer Society Helpline**: Call 1800-22-1951 (toll-free) for guidance.\n' +
  "3. **Emergency**: If you're experiencing severe symptoms (coughing blood, sudden severe pain, difficulty breathing), call 112 or 108 for an ambulance.\n\n" +
  'Please try asking your question again — I should be able to give you a more detailed, referenced answer.';

const GENERIC_ERROR = /there was an error processing your message/i;

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

const axiosError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

const sendQuestion = async () => {
  const user = userEvent.setup();
  const input = screen.getByPlaceholderText('Type your message...');
  await user.type(input, 'My child is on treatment and has a severe headache.');
  await user.keyboard('{Enter}');
  // Settle the greeting-state refresh promises so assertions run quiet.
  await act(async () => {
    await Promise.resolve();
  });
};

describe('ChatInterface — 55s turn timeout (issue #171)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom here has no Storage implementation and no scrollIntoView.
    installLocalStorage({
      suchi_welcome_seen: 'true',
      suchi_sources_disclosure_seen: 'true',
    });
    Element.prototype.scrollIntoView = vi.fn();
    mocks.get.mockResolvedValue({
      data: {
        sessionId: 'session-1',
        createdAt: '2026-09-19T07:56:06.000Z',
        greetingCompleted: true,
        currentGreetingStep: null,
        userContext: null,
        cancerType: null,
      },
    });
  });

  it('renders the helpline/emergency fallback instead of the generic error', async () => {
    mocks.post.mockRejectedValue(
      axiosError(504, {
        sessionId: 'session-1',
        responseText: FALLBACK_TEXT,
        safety: { classification: 'normal', actions: [] },
        error: 'timeout',
      })
    );

    const { container } = render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);
    await sendQuestion();

    const log = await screen.findByRole('log');
    expect(log.textContent).toContain('1800-22-1951');
    expect(log.textContent).toContain('112 or 108');
    // The fallback is an assistant bubble, not the error overlay.
    expect(screen.queryByText(GENERIC_ERROR)).toBeNull();
    // Rendered as markdown, like every other reply.
    expect(log.textContent).not.toContain('**');
    expect(container.querySelectorAll('[role="log"] strong').length).toBeGreaterThan(0);
  });

  it('still shows the generic error when the 504 carries no usable copy', async () => {
    mocks.post.mockRejectedValue(axiosError(504, '<html>upstream request timeout</html>'));

    render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);
    await sendQuestion();

    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
  });

  it('still shows the generic error on a non-timeout failure', async () => {
    mocks.post.mockRejectedValue(axiosError(500, { message: 'boom' }));

    render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);
    await sendQuestion();

    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
  });

  describe('feedback targeting when a timeout follows a real answer', () => {
    const ANSWER_TEXT = 'Screening guidance depends on your age and family history.';

    // First turn answers normally and is persisted as message-1; the second
    // turn times out, and nothing is persisted for it.
    const seedAnswerThenTimeout = () => {
      let chatCalls = 0;
      mocks.post.mockImplementation(async (url: string) => {
        if (url !== '/chat') return { data: { id: 'feedback-1', createdAt: '2026-09-19T08:00:00.000Z' } };
        chatCalls += 1;
        if (chatCalls === 1) {
          return {
            data: {
              sessionId: 'session-1',
              messageId: 'message-1',
              responseText: ANSWER_TEXT,
              safety: { classification: 'normal', actions: [] },
            },
          };
        }
        throw axiosError(504, {
          sessionId: 'session-1',
          responseText: FALLBACK_TEXT,
          safety: { classification: 'normal', actions: [] },
          error: 'timeout',
        });
      });
    };

    const bubbleContaining = (container: HTMLElement, needle: string) => {
      const bubble = Array.from(container.querySelectorAll<HTMLElement>('[role="assistant"]')).find(
        (el) => el.textContent?.includes(needle)
      );
      expect(bubble).toBeDefined();
      return bubble!;
    };

    const feedbackPosts = () => mocks.post.mock.calls.filter(([url]) => url === '/feedback');

    it('offers no thumb rating on the non-persisted timeout bubble', async () => {
      seedAnswerThenTimeout();

      const { container } = render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);
      await sendQuestion();
      await sendQuestion();

      const answered = bubbleContaining(container, ANSWER_TEXT);
      expect(within(answered).getByLabelText('Thumbs up')).toBeInTheDocument();

      const timedOut = bubbleContaining(container, '1800-22-1951');
      expect(within(timedOut).queryByLabelText('Thumbs up')).toBeNull();
      expect(within(timedOut).queryByLabelText('Thumbs down')).toBeNull();
      // The rest of the toolbar (copy, listen) stays available.
      expect(within(timedOut).getByLabelText('Copy message')).toBeInTheDocument();
    });

    it('does not rate the previous answer from the conversation feedback button', async () => {
      seedAnswerThenTimeout();

      const user = userEvent.setup();
      render(<ChatInterface sessionId="session-1" onStartOver={vi.fn()} />);
      await sendQuestion();
      await sendQuestion();

      await user.click(screen.getByLabelText('Provide feedback on conversation'));
      await user.click(screen.getByRole('button', { name: /👍 Yes/ }));
      await user.click(screen.getByRole('button', { name: 'Submit' }));
      await act(async () => {
        await Promise.resolve();
      });

      expect(feedbackPosts()).toHaveLength(0);
    });
  });
});
