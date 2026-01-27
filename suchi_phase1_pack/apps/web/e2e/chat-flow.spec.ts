import { test, expect } from '@playwright/test';

test.describe('Suchi Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads app and shows welcome message', async ({ page }) => {
    // Should show welcome/empty state or greeting
    await expect(page.locator('body')).toBeVisible();

    // Check for input area
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
    // Look for loading indicator first
    const loading = page.getByRole('status', { name: /loading/i });
    if (await loading.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 45000 });
    }

    // Should have assistant response with medical content
    await expect(page.locator('[role="assistant"], [aria-label*="assistant"]').first()).toBeVisible({ timeout: 45000 });
  });

  test('response includes citations', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What are the treatment options for lung cancer?');

    await page.getByRole('button', { name: /send/i }).click();

    // Wait for response
    await expect(page.locator('[role="assistant"], [aria-label*="assistant"]').first()).toBeVisible({ timeout: 45000 });

    // Should have citations (numbered references like [1], [2])
    await expect(page.getByText(/\[1\]/)).toBeVisible({ timeout: 5000 });
  });

  test('can hover over citation to see tooltip', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What causes colorectal cancer?');

    await page.getByRole('button', { name: /send/i }).click();

    // Wait for citation to appear
    const citation = page.getByText(/\[1\]/).first();
    await expect(citation).toBeVisible({ timeout: 45000 });

    // Hover to show tooltip
    await citation.hover();

    // Tooltip should appear
    await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 5000 });
  });

  test('shows sources section after response', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /message/i });
    await input.fill('What is chemotherapy?');

    await page.getByRole('button', { name: /send/i }).click();

    // Wait for response with sources
    await expect(page.getByText(/Sources/i)).toBeVisible({ timeout: 45000 });
  });
});

test.describe('Error Handling', () => {
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

test.describe('Accessibility', () => {
  test('message input has proper aria labels', async ({ page }) => {
    await page.goto('/');

    const input = page.getByRole('textbox');
    await expect(input).toHaveAttribute('aria-label', /message/i);
  });

  test('chat messages area has proper role', async ({ page }) => {
    await page.goto('/');

    // Should have log role for message area
    const messageArea = page.getByRole('log');
    await expect(messageArea).toBeVisible();
  });

  test('can navigate with keyboard', async ({ page }) => {
    await page.goto('/');

    // Tab to input
    await page.keyboard.press('Tab');

    // Type message
    await page.keyboard.type('Hello Suchi');

    // Tab to send button and press Enter
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    // Message should be sent
    await expect(page.getByText('Hello Suchi')).toBeVisible();
  });
});
