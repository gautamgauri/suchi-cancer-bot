import { test, expect } from '@playwright/test';

// Fast tests - no LLM dependency, run in CI
test.describe('UI Smoke Tests @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads app and shows input', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
    const input = page.getByRole('textbox', { name: /message/i });
    await expect(input).toBeVisible();
  });

  test('can type in message input', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What are breast cancer symptoms?');
    await expect(input).toHaveValue('What are breast cancer symptoms?');
  });

  test('send button is disabled when input is empty', async ({ page }) => {
    const sendButton = page.getByRole('button', { name: /send/i });
    await expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has text', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('Hello');
    const sendButton = page.getByRole('button', { name: /send/i });
    await expect(sendButton).toBeEnabled();
  });

  test('message input has proper aria labels', async ({ page }) => {
    const input = page.getByRole('textbox');
    await expect(input).toHaveAttribute('aria-label', /message/i);
  });

  test('chat messages area has proper role', async ({ page }) => {
    const messageArea = page.getByRole('log');
    await expect(messageArea).toBeVisible();
  });
});

// Full tests - require LLM responses, run manually or with longer timeout
test.describe('Full Chat Flow @full', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('can send message and receive response', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What are the symptoms of breast cancer?');

    const sendButton = page.getByRole('button', { name: /send/i });
    await sendButton.click();

    // Input should be cleared after sending
    await expect(input).toHaveValue('');

    // Should show user message
    await expect(page.getByText('What are the symptoms of breast cancer?')).toBeVisible();

    // Wait for assistant response (may take time due to LLM)
    const loading = page.getByRole('status', { name: /loading/i });
    if (await loading.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 60000 });
    }

    // Should have assistant response
    await expect(page.locator('[role="assistant"], [aria-label*="assistant"]').first()).toBeVisible({ timeout: 60000 });
  });

  test('response includes citations', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What are the treatment options for lung cancer?');

    await page.getByRole('button', { name: /send/i }).click();

    // Wait for response
    await expect(page.locator('[role="assistant"], [aria-label*="assistant"]').first()).toBeVisible({ timeout: 60000 });

    // Should have citations
    await expect(page.getByText(/\[1\]/)).toBeVisible({ timeout: 5000 });
  });

  test('shows sources section after response', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What is chemotherapy?');

    await page.getByRole('button', { name: /send/i }).click();

    // Wait for response with sources
    await expect(page.getByText(/Sources/i)).toBeVisible({ timeout: 60000 });
  });
});

test.describe('Error Handling @smoke', () => {
  test('shows error message on network failure', async ({ page }) => {
    // Block API requests to simulate network failure
    await page.route('**/v1/**', route => route.abort());

    await page.goto('/');

    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('Test message');

    await page.getByRole('button', { name: /send/i }).click();

    // Should show error
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Keyboard Navigation @smoke', () => {
  test('can navigate with keyboard', async ({ page }) => {
    await page.goto('/');

    // Tab to input
    await page.keyboard.press('Tab');

    // Type message
    await page.keyboard.type('Hello Suchi');

    // Tab to send button and press Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // Message should be sent (appears in chat)
    await expect(page.getByText('Hello Suchi')).toBeVisible();
  });
});
