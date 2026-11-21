import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { apiService } from '../api';

// The 55s turn-timeout body, verbatim from
// apps/api/src/modules/chat/chat.controller.ts:52-57. This is the only
// user-facing copy the server composes on the timeout path.
const FALLBACK_TEXT =
  "I'm sorry — my response is taking longer than expected. " +
  'In the meantime, here are some general steps you can take:\n\n' +
  '1. **Talk to a doctor**: If you have symptoms or concerns about cancer, the most important step is seeing a healthcare professional.\n' +
  '2. **Indian Cancer Society Helpline**: Call 1800-22-1951 (toll-free) for guidance.\n' +
  "3. **Emergency**: If you're experiencing severe symptoms (coughing blood, sudden severe pain, difficulty breathing), call 112 or 108 for an ambulance.\n\n" +
  'Please try asking your question again — I should be able to give you a more detailed, referenced answer.';

const TIMEOUT_BODY = {
  sessionId: 'b50bbc2a-c7e2-451f-87ce-79ab4b20d6b2',
  responseText: FALLBACK_TEXT,
  safety: { classification: 'normal', actions: [] },
  error: 'timeout',
};

const axiosError = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

const request = {
  sessionId: 'b50bbc2a-c7e2-451f-87ce-79ab4b20d6b2',
  channel: 'web' as const,
  userText: 'My child is on cancer treatment and has a severe headache and blurred vision.',
};

describe('apiService.sendMessage — 55s turn timeout (issue #171)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces the helpline/emergency fallback carried in the 504 body', async () => {
    mocks.post.mockRejectedValue(axiosError(504, TIMEOUT_BODY));

    const response = await apiService.sendMessage(request);

    expect(response.responseText).toBe(FALLBACK_TEXT);
    expect(response.responseText).toContain('1800-22-1951');
    expect(response.responseText).toContain('112 or 108');
    expect(response.error).toBe('timeout');
    expect(response.sessionId).toBe(TIMEOUT_BODY.sessionId);
    expect(response.safety).toEqual({ classification: 'normal', actions: [] });
    // No message row exists for an aborted turn; the id is a render key only.
    expect(response.messageId).toMatch(/^timeout-/);
  });

  it('defaults safety to normal when the 504 body omits or malforms it', async () => {
    mocks.post.mockRejectedValue(
      axiosError(504, { responseText: FALLBACK_TEXT, safety: { classification: 'normal' } })
    );

    const response = await apiService.sendMessage(request);

    // ChatInterface calls .includes() on actions — it must always be an array.
    expect(response.safety.actions).toEqual([]);
  });

  it('rethrows a bodyless 504 from the infrastructure', async () => {
    // Cloud Run's own request cap answers with HTML, not copy we can show.
    mocks.post.mockRejectedValue(axiosError(504, '<html>upstream request timeout</html>'));

    await expect(apiService.sendMessage(request)).rejects.toThrow();
  });

  it('rethrows non-timeout failures', async () => {
    mocks.post.mockRejectedValue(axiosError(500, { message: 'An error occurred processing your request' }));

    await expect(apiService.sendMessage(request)).rejects.toThrow();
  });

  it('passes a successful answer through untouched', async () => {
    const ok = {
      sessionId: 'session-1',
      messageId: 'msg-1',
      responseText: 'A real answer.',
      safety: { classification: 'normal', actions: [] },
    };
    mocks.post.mockResolvedValue({ data: ok });

    await expect(apiService.sendMessage(request)).resolves.toEqual(ok);
  });
});
