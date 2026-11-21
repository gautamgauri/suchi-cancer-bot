import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock('axios', () => ({
  default: { create: () => ({ post: mocks.post, get: mocks.get }), isAxiosError: () => false },
  isAxiosError: () => false,
}));

import { apiService } from '../api';

/**
 * The API rejects unknown JSON body fields with a 400 (ValidationPipe with
 * forbidNonWhitelisted). The production API at the time of writing has no
 * attribution field, so attribution must never reach the body. It goes in
 * the query string, which that API ignores.
 */
describe('apiService.createSession attribution', () => {
  const body = { channel: 'web' as const, locale: 'en', userRole: 'unknown' as const };

  beforeEach(() => {
    mocks.post.mockReset();
    mocks.post.mockResolvedValue({ data: { sessionId: 's-1', createdAt: '2026-11-21T00:00:00Z' } });
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('sends src and utm_source as query params and leaves the body unchanged', async () => {
    window.history.replaceState(null, '', '/?src=site-article&utm_source=instagram');
    await apiService.createSession(body);
    expect(mocks.post).toHaveBeenCalledWith('/sessions', body, {
      params: { src: 'site-article', utm_source: 'instagram' },
    });
    const sentBody = mocks.post.mock.calls[0][1];
    expect(sentBody).not.toHaveProperty('src');
    expect(sentBody).not.toHaveProperty('utm_source');
  });

  it('makes exactly the old request when the URL has no attribution', async () => {
    window.history.replaceState(null, '', '/');
    await apiService.createSession(body);
    expect(mocks.post).toHaveBeenCalledWith('/sessions', body);
    expect(mocks.post.mock.calls[0]).toHaveLength(2);
  });

  it('sends nothing extra for an invalid src', async () => {
    window.history.replaceState(null, '', `/?src=${encodeURIComponent('https://example.com')}`);
    await apiService.createSession(body);
    expect(mocks.post.mock.calls[0]).toHaveLength(2);
  });
});
