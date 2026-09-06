import { test, expect } from '@playwright/test';
import {
  CONSENT_STORAGE_KEY,
  START_CHATTING,
  acceptConsent,
  assistantMessages,
  enterChat,
  stubSessionApi,
  waitForAssistantReply,
} from './helpers';

/**
 * The shipped consent gate (src/components/ConsentGate.tsx) is a single
 * "Start chatting →" button — no checkbox, no separate emergency/disclaimer
 * headings. Consent is stored in sessionStorage under `suchi_consented`
 * (src/ChatApp.tsx), so a fresh Playwright context always sees the gate.
 */
test.describe('Consent Gate @smoke', () => {
  test('shows consent gate on first visit', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: "Namaste! I'm Suchi" })).toBeVisible();
    await expect(page.getByText('Your cancer information companion')).toBeVisible();
    await expect(page.getByText('I can help you:')).toBeVisible();
    await expect(
      page.getByText(/Suchi provides general health information, not medical diagnosis/i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: START_CHATTING })).toBeVisible();

    // The gate must not have leaked chat UI behind it.
    await expect(page.locator('textarea')).toHaveCount(0);
  });

  test('start button is immediately actionable (gate has no checkbox)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The old gate gated its button on a checkbox. The shipped gate has none,
    // so the button must be enabled on arrival.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);

    const startButton = page.getByRole('button', { name: START_CHATTING });
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('clicking start chatting shows chat interface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: START_CHATTING }).click();

    // Chat shell: header, message log and the message input.
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[role="log"]')).toBeVisible();
    await expect(page.getByRole('button', { name: START_CHATTING })).toHaveCount(0);
  });

  test('gate also guards a deep link (/chat)', async ({ page }) => {
    await page.goto('/chat');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('button', { name: START_CHATTING })).toBeVisible();
    await acceptConsent(page);
    await expect(page.locator('textarea')).toBeVisible();
  });

  test('returning visitor with stored consent skips the gate', async ({ page }) => {
    // A returning visit re-creates the session on load, so the session API has
    // to answer for the gate to stay dismissed.
    await stubSessionApi(page);
    await page.addInitScript((key) => {
      sessionStorage.setItem(key, 'true');
    }, CONSENT_STORAGE_KEY);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.getByRole('button', { name: START_CHATTING })).toHaveCount(0);
  });
});

// Fast tests - no LLM dependency, run in CI
test.describe('UI Smoke Tests @smoke', () => {
  test.beforeEach(async ({ page }) => {
    // stubSession: the message input stays disabled until a session exists,
    // so UI-only assertions need session creation to succeed without a backend.
    await enterChat(page);
  });

  test('loads app and shows input', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    // Use textarea directly since that's what MessageInput renders
    const input = page.locator('textarea');
    await expect(input).toBeVisible();
  });

  test('can type in message input', async ({ page }) => {
    const input = page.locator('textarea');
    await input.fill('What are breast cancer symptoms?');
    await expect(input).toHaveValue('What are breast cancer symptoms?');
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has text', async ({ page }) => {
    const input = page.locator('textarea');
    await input.fill('Hello');
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await expect(sendButton).toBeEnabled();
  });

  test('message input has proper aria labels', async ({ page }) => {
    const input = page.locator('textarea');
    await expect(input).toHaveAttribute('aria-label', 'Message input');
    await expect(page.getByRole('button', { name: 'Send message' })).toHaveAttribute(
      'aria-label',
      'Send message',
    );
  });

  test('chat messages area has proper role', async ({ page }) => {
    const messageArea = page.locator('[role="log"]');
    await expect(messageArea).toBeVisible();
  });
});

/**
 * Full tests - require a real chat response from the API. They deliberately do
 * NOT stub sessions, so they exercise the deployed stack in CI
 * (E2E_BASE_URL). Locally they fail at the API boundary: session creation is
 * the first call that needs a backend.
 */
test.describe('Full Chat Flow @full', () => {
  test.beforeEach(async ({ page }) => {
    await enterChat(page, { stubSession: false });
  });

  test('can send message and receive response', async ({ page }) => {
    const baseline = await assistantMessages(page).count();

    const input = page.locator('textarea');
    await input.fill('What are the symptoms of breast cancer?');

    await page.getByRole('button', { name: 'Send message' }).click();

    // Input should be cleared after sending
    await expect(input).toHaveValue('');

    // Should show user message
    await expect(page.getByText('What are the symptoms of breast cancer?')).toBeVisible();

    await waitForAssistantReply(page, baseline);
  });

  /**
   * Replaces two specs that could never pass (issue #71.1):
   *
   *   test('response includes citations')          → expected [1] in the answer
   *   test('shows sources section after response') → expected /Sources/i
   *
   * `ChatController.send()` strips `[citation:…]`, leftover `[n]` refs and the
   * raw `**Sources:**` block from `responseText` before it leaves the API
   * (apps/api/src/modules/chat/chat.controller.ts), deliberately — citations are
   * for auditors, not users (#54). No marker survives to the browser, so those
   * assertions were fiction against any real service.
   *
   * The shipped contract has two halves, and this asserts both: the user sees
   * clean prose, AND the audit trail still arrives in the structured payload.
   * Asserting only the first half would pass if citations stopped being
   * produced at all.
   */
  test('answer reaches the browser clean, with the audit trail still in the payload', async ({
    page,
  }) => {
    const baseline = await assistantMessages(page).count();

    const chatResponse = page.waitForResponse(
      (r) => r.url().includes('/chat') && r.request().method() === 'POST',
    );

    const input = page.locator('textarea');
    await input.fill('What are the treatment options for lung cancer?');
    await page.getByRole('button', { name: 'Send message' }).click();

    const payload = await (await chatResponse).json();

    // Half 1 — the API must not emit markers in the user-facing text.
    expect(payload.responseText).not.toMatch(/\[citation:/);
    expect(payload.responseText).not.toMatch(/\[\d{1,3}\]/);
    expect(payload.responseText).not.toMatch(/\*\*Sources:\*\*/);

    // Half 2 — provenance is still returned for auditing. A grounded answer
    // must cite; if this array empties out, citation auditing has silently died.
    expect(Array.isArray(payload.citations)).toBe(true);
    expect(payload.citations.length).toBeGreaterThan(0);

    // And the rendered message agrees with the payload.
    await waitForAssistantReply(page, baseline);
    const rendered = await assistantMessages(page).last().innerText();
    expect(rendered).not.toMatch(/\[citation:/);
    expect(rendered).not.toMatch(/\[\d{1,3}\]/);
  });
});

test.describe('Error Handling @smoke', () => {
  test('shows error message on network failure', async ({ page }) => {
    // Session creation is stubbed so the input is usable; only the chat call
    // is broken, which is the failure this test is about.
    await enterChat(page);
    await page.route('**/chat', (route) => route.abort());

    const input = page.locator('textarea');
    await input.fill('Test message');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Keyboard Navigation @smoke', () => {
  test('can navigate with keyboard', async ({ page }) => {
    await enterChat(page);

    const input = page.locator('textarea');
    await input.focus();
    await expect(input).toBeFocused();

    await input.pressSequentially('Hello Suchi');

    // Press Enter to send (without Shift)
    await page.keyboard.press('Enter');

    // Message should be sent (appears in chat) and the input cleared.
    await expect(page.getByText('Hello Suchi')).toBeVisible({ timeout: 10000 });
    await expect(input).toHaveValue('');
  });
});
