import { test, expect } from '@playwright/test';

// Helper to pass through consent gate
async function acceptConsent(page: import('@playwright/test').Page) {
  // Check if consent gate is visible
  const consentCheckbox = page.locator('input[type="checkbox"]');
  if (await consentCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Check the "I understand and accept" checkbox
    await consentCheckbox.check();
    // Click "Continue to Chat" button
    await page.locator('button:has-text("Continue to Chat")').click();
    // Wait for chat interface to load
    await page.waitForSelector('textarea', { timeout: 10000 });
  }
}

// Consent Gate tests - verify disclaimer flow works
test.describe('Consent Gate @smoke', () => {
  test('shows consent gate on first visit', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should see Welcome to Suchi
    await expect(page.getByText('Welcome to Suchi')).toBeVisible();
    // Should see emergency warning
    await expect(page.getByText('Emergency Warning')).toBeVisible();
    // Should see disclaimer
    await expect(page.getByText('Important Disclaimer')).toBeVisible();
  });

  test('continue button is disabled until checkbox is checked', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const continueButton = page.locator('button:has-text("Continue to Chat")');
    await expect(continueButton).toBeDisabled();

    // Check the checkbox
    await page.locator('input[type="checkbox"]').check();

    // Button should now be enabled
    await expect(continueButton).toBeEnabled();
  });

  test('clicking continue shows chat interface', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Accept consent
    await page.locator('input[type="checkbox"]').check();
    await page.locator('button:has-text("Continue to Chat")').click();

    // Should now see chat interface (textarea)
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 });
  });
});

// Fast tests - no LLM dependency, run in CI
test.describe('UI Smoke Tests @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to hydrate
    await page.waitForLoadState('networkidle');
    // Pass through consent gate
    await acceptConsent(page);
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
    const sendButton = page.locator('button:has-text("Send")');
    await expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has text', async ({ page }) => {
    const input = page.locator('textarea');
    await input.fill('Hello');
    const sendButton = page.locator('button:has-text("Send")');
    await expect(sendButton).toBeEnabled();
  });

  test('message input has proper aria labels', async ({ page }) => {
    const input = page.locator('textarea');
    await expect(input).toHaveAttribute('aria-label', 'Message input');
  });

  test('chat messages area has proper role', async ({ page }) => {
    const messageArea = page.locator('[role="log"]');
    await expect(messageArea).toBeVisible();
  });
});

// Full tests - require LLM responses, run manually or with longer timeout
test.describe('Full Chat Flow @full', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await acceptConsent(page);
  });

  test('can send message and receive response', async ({ page }) => {
    const input = page.locator('textarea');
    await input.fill('What are the symptoms of breast cancer?');

    const sendButton = page.locator('button:has-text("Send")');
    await sendButton.click();

    // Input should be cleared after sending
    await expect(input).toHaveValue('');

    // Should show user message
    await expect(page.getByText('What are the symptoms of breast cancer?')).toBeVisible();

    // Wait for assistant response (may take time due to LLM)
    const loading = page.locator('[role="status"]');
    if (await loading.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 60000 });
    }

    // Should have assistant response
    await expect(page.locator('[aria-label*="assistant"]').first()).toBeVisible({ timeout: 60000 });
  });

  test('response includes citations', async ({ page }) => {
    const input = page.locator('textarea');
    await input.fill('What are the treatment options for lung cancer?');

    await page.locator('button:has-text("Send")').click();

    // Wait for response
    await expect(page.locator('[aria-label*="assistant"]').first()).toBeVisible({ timeout: 60000 });

    // Should have citations (use .first() since there may be multiple [1] citations)
    await expect(page.getByText(/\[1\]/).first()).toBeVisible({ timeout: 5000 });
  });

  test('shows sources section after response', async ({ page }) => {
    const input = page.locator('textarea');
    await input.fill('What is chemotherapy?');

    await page.locator('button:has-text("Send")').click();

    // Wait for response with sources
    await expect(page.getByText(/Sources/i)).toBeVisible({ timeout: 60000 });
  });
});

test.describe('Error Handling @smoke', () => {
  test('shows error message on network failure', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await acceptConsent(page);

    // Block chat API requests AFTER consent to simulate network failure on message send
    // Match any URL ending in /chat (the API endpoint for sending messages)
    await page.route('**/chat', route => route.abort());

    const input = page.locator('textarea');
    await input.fill('Test message');

    await page.locator('button:has-text("Send")').click();

    // Should show error
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Keyboard Navigation @smoke', () => {
  test('can navigate with keyboard', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await acceptConsent(page);

    // Focus the textarea directly
    const input = page.locator('textarea');
    await input.focus();

    // Type message
    await input.type('Hello Suchi');

    // Press Enter to send (without Shift)
    await page.keyboard.press('Enter');

    // Message should be sent (appears in chat)
    await expect(page.getByText('Hello Suchi')).toBeVisible({ timeout: 5000 });
  });
});
