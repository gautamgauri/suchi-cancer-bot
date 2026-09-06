import { expect, type Page } from '@playwright/test';

/**
 * Shared e2e helpers for the shipped consent → role-picker → chat flow.
 *
 * Flow as implemented in src/ChatApp.tsx + src/components/ConsentGate.tsx:
 *   1. First visit: <ConsentGate> renders ("Namaste! I'm Suchi", single
 *      "Start chatting →" button, no checkbox).
 *   2. Clicking it writes sessionStorage["suchi_consented"] = "true" and
 *      renders <ChatInterface> with sessionId === null.
 *   3. With no sessionId the role picker is shown and the message input is
 *      *visible but disabled*. Picking a role calls POST /v1/sessions; only
 *      after that resolves is the textarea enabled.
 *   4. If session creation fails, ChatApp clears the consent flag and falls
 *      back to the gate with an error box — so any test that needs an enabled
 *      input needs a session, real (CI, deployed API) or stubbed (local).
 */

/** sessionStorage key written by ChatApp.handleConsent(). */
export const CONSENT_STORAGE_KEY = 'suchi_consented';

/** Accessible name of the single button on the shipped consent gate. */
export const START_CHATTING = /Start chatting/i;

/** Default role-picker option (ROLE_OPTIONS in ChatInterface.tsx). */
export const DEFAULT_ROLE_LABEL = 'Prefer not to say';

/**
 * Accessible name of the mic button in MessageInput.tsx. It is always rendered
 * — only the label changes with state: "Start voice input" when the Web Speech
 * API is available, "Voice input not supported in this browser" when it is not,
 * "Stop recording" while recording. Matching all three keeps the assertion
 * meaningful in headless Chromium, where speech support varies.
 */
export const MIC_BUTTON_NAME = /voice input|recording/i;

async function isVisibleWithin(
  locator: ReturnType<Page['locator']>,
  timeout: number,
): Promise<boolean> {
  return locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

/**
 * Pass the consent gate if it is showing. Returns true when the gate was
 * present and dismissed, false when the visit was already consented.
 */
export async function acceptConsent(page: Page, timeout = 15_000): Promise<boolean> {
  const startButton = page.getByRole('button', { name: START_CHATTING });
  const gateShown = await isVisibleWithin(startButton, timeout);
  if (gateShown) {
    await startButton.click();
  }
  // Either path lands on the chat shell, which always renders the textarea.
  await expect(page.locator('textarea')).toBeVisible();
  return gateShown;
}

/**
 * Pick a role if the role picker is showing. Selecting a role is what triggers
 * session creation; without it the message input stays disabled.
 */
export async function selectRole(
  page: Page,
  label: string = DEFAULT_ROLE_LABEL,
  timeout = 10_000,
): Promise<boolean> {
  const roleButton = page.getByRole('button', { name: label, exact: true });
  const pickerShown = await isVisibleWithin(roleButton, timeout);
  if (pickerShown) {
    await roleButton.click();
  }
  return pickerShown;
}

/**
 * Stub session creation/lookup so UI-only tests get an interactive chat shell
 * without a backend. Chat responses (POST /chat) are deliberately NOT stubbed:
 * tests that assert on real answers must keep hitting the deployed API in CI.
 */
export async function stubSessionApi(page: Page, sessionId = 'e2e-stub-session'): Promise<void> {
  const createdAt = new Date().toISOString();

  await page.route('**/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId, createdAt }),
    });
  });

  await page.route('**/sessions/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        createdAt,
        greetingCompleted: true,
        currentGreetingStep: null,
        userContext: null,
        cancerType: null,
      }),
    });
  });
}

/**
 * Stub POST /chat with a fixed delay so client-side loading states can be
 * asserted deterministically. Used only by the loading-state tests, which are
 * about UI timing, not about what the API returns.
 */
export async function stubSlowChat(page: Page, delayMs: number): Promise<void> {
  await page.route('**/chat', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messageId: 'e2e-stub-message',
        responseText: 'Stubbed response for loading-state timing.',
        citations: [],
        safety: { classification: 'normal', actions: [] },
      }),
    });
  });
}

export interface EnterChatOptions {
  /** Path to visit. The gate renders on every path (SPA, no router). */
  path?: string;
  /** Stub POST/GET /sessions so the input becomes enabled without a backend. */
  stubSession?: boolean;
  /** Role-picker option to select. */
  role?: string;
  /** Wait for the textarea to be enabled (needs a session). */
  requireEnabledInput?: boolean;
}

/**
 * Navigate, pass the consent gate, pick a role, and land on a usable chat UI.
 *
 * With `stubSession: true` this works offline. With `stubSession: false` the
 * real API must be reachable — locally that fails at session creation, which
 * is the documented API boundary.
 */
export async function enterChat(page: Page, options: EnterChatOptions = {}): Promise<void> {
  const {
    path = '/',
    stubSession = true,
    role = DEFAULT_ROLE_LABEL,
    requireEnabledInput = true,
  } = options;

  if (stubSession) {
    await stubSessionApi(page);
  }

  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await acceptConsent(page);
  await selectRole(page, role);

  if (requireEnabledInput) {
    // Fails here when no session could be created (no API) — the API boundary.
    await expect(page.locator('textarea')).toBeEnabled();
  }
}

/** The assistant messages rendered in the message log. */
export function assistantMessages(page: Page) {
  return page.locator('[aria-label="assistant message"]');
}

/**
 * Wait for a *new* assistant message beyond the seeded welcome message.
 * `baseline` is the assistant-message count captured before sending.
 */
export async function waitForAssistantReply(
  page: Page,
  baseline: number,
  timeout = 60_000,
): Promise<void> {
  await expect
    .poll(async () => assistantMessages(page).count(), { timeout })
    .toBeGreaterThan(baseline);
}
