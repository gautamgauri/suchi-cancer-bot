import { test, expect } from '@playwright/test';
import {
  MIC_BUTTON_NAME,
  assistantMessages,
  enterChat,
  stubSlowChat,
  waitForAssistantReply,
} from './helpers';

/**
 * Tests for UX improvement tickets:
 * 1. Voice input (mic button)
 * 2. Audio output (TTS listen button)
 * 3. Sources disclosure modal
 * 4. Sources footer styling
 * 5. Loading states ("Answering...", "Still working...")
 *
 * Consent/role/session plumbing lives in ./helpers (the shipped flow is
 * consent gate → role picker → session → chat). Suites that assert on real
 * answers pass `stubSession: false` so they exercise the deployed API in CI.
 */

test.describe('UX Ticket: Voice Input @ux @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await enterChat(page, { path: '/chat' });
  });

  test('mic button is visible in message input area', async ({ page }) => {
    // MessageInput always renders the mic button; only its label changes with
    // Web Speech API support, so match on the label rather than on an icon.
    const micButton = page.getByRole('button', { name: MIC_BUTTON_NAME });
    await expect(micButton).toBeVisible();
  });

  test('mic button has proper accessibility attributes', async ({ page }) => {
    // Unconditional: previously this silently passed when the button was
    // missing, which hid the consent-gate regression.
    const micButton = page.getByRole('button', { name: MIC_BUTTON_NAME });
    await expect(micButton).toBeVisible();
    await expect(micButton).toHaveAttribute('aria-label', /.+/);
    await expect(micButton).toHaveAttribute('title', /.+/);
  });
});

test.describe('UX Ticket: Audio Output / TTS @ux', () => {
  // Requires a real assistant response (the Listen button hangs off a
  // rendered assistant message) — red locally at the API boundary.
  test.beforeEach(async ({ page }) => {
    await enterChat(page, { path: '/chat', stubSession: false });
  });

  test('listen/speaker button appears after sending a message', async ({ page }) => {
    const baseline = await assistantMessages(page).count();

    const input = page.locator('textarea');
    await input.fill('What is cancer?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await waitForAssistantReply(page, baseline);

    const listenButton = page.locator('button:has-text("Listen")');
    await expect(listenButton.first()).toBeVisible();
  });
});

test.describe('UX Ticket: Sources Disclosure Modal @ux', () => {
  test('sources disclosure modal appears on first response with citations', async ({ page }) => {
    // The modal is one-time per browser and keyed on localStorage; a fresh
    // Playwright context already starts clean, so no clearing dance is needed.
    await enterChat(page, { path: '/chat', stubSession: false });

    const baseline = await assistantMessages(page).count();

    const input = page.locator('textarea');
    await input.fill('What are the symptoms of lung cancer?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await waitForAssistantReply(page, baseline);

    await expect(page.getByText('About Our Sources')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();

    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('About Our Sources')).toHaveCount(0);
  });
});

/**
 * Was "UX Ticket: Sources Footer Styling" (issue #71.1). Both of its specs were
 * wrong about the shipped surface:
 *
 *  - 'citation markers appear in response' expected `[n]` in the answer.
 *    `ChatController.send()` strips `[citation:…]`, `[n]` and the raw
 *    `**Sources:**` block before the response leaves the API, so no marker can
 *    reach the browser. It could never pass.
 *  - 'sources section appears with proper styling' expected a `/SOURCES/i`
 *    footer. There is no per-answer sources footer in the app. The assertion
 *    nevertheless PASSED for the wrong reason: the case-insensitive match also
 *    hits the "About Our Sources" disclosure modal and the WelcomeMessage line
 *    "Find trusted sources and resources". A green test naming a component that
 *    does not exist is worse than a red one.
 *
 * The shipped surface is: clean prose in the answer, provenance disclosed once
 * via the "About Our Sources" modal (asserted above), audit trail in the JSON.
 */
test.describe('UX Ticket: Answer text carries no citation furniture @ux', () => {
  test.beforeEach(async ({ page }) => {
    await enterChat(page, { path: '/chat', stubSession: false });
  });

  test('no citation markers or sources footer are rendered in the answer', async ({
    page,
  }) => {
    const baseline = await assistantMessages(page).count();

    const input = page.locator('textarea');
    await input.fill('What are treatment options for breast cancer?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await waitForAssistantReply(page, baseline);

    const rendered = await assistantMessages(page).last().innerText();
    expect(rendered).not.toMatch(/\[citation:/);
    expect(rendered).not.toMatch(/\[\d{1,3}\]/);
    expect(rendered).not.toMatch(/\*\*Sources:\*\*/);
    // Scoped to the answer bubble, so the "About Our Sources" modal and the
    // welcome copy cannot make this pass or fail by accident.
    expect(rendered).not.toMatch(/^\s*sources\b/im);
  });
});

/**
 * Loading states are pure client-side timing (ChatInterface swaps the
 * LoadingIndicator message after 10s), so they are asserted against a stubbed,
 * deliberately slow /chat instead of a live model. That makes them
 * deterministic — the previous versions asserted `x || y || true`, which could
 * never fail.
 */
test.describe('UX Ticket: Loading States @ux @smoke', () => {
  test('shows loading state when sending message', async ({ page }) => {
    await stubSlowChat(page, 5_000);
    await enterChat(page, { path: '/chat' });

    const input = page.locator('textarea');
    await input.fill('What is radiation therapy?');
    await page.getByRole('button', { name: 'Send message' }).click();

    const loadingIndicator = page.locator('[role="status"]');
    await expect(loadingIndicator).toBeVisible();
    await expect(loadingIndicator).toContainText(/Answering/i);
  });

  test('shows "Still working..." after extended wait', async ({ page }) => {
    // ChatInterface switches the message at 10s; hold the response past that.
    await stubSlowChat(page, 14_000);
    await enterChat(page, { path: '/chat' });

    const input = page.locator('textarea');
    await input.fill('Give me a detailed explanation of immunotherapy treatments');
    await page.getByRole('button', { name: 'Send message' }).click();

    const loadingIndicator = page.locator('[role="status"]');
    await expect(loadingIndicator).toContainText(/Answering/i);
    await expect(loadingIndicator).toContainText(/Still working/i, { timeout: 15_000 });
  });
});
