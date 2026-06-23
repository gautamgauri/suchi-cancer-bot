import { chromium } from "playwright";

const TWITTER_URL = "https://x.com/";
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "true";

/** Truncate content to 280 chars with ellipsis if needed. */
function truncateTweet(content: string): string {
  if (content.length <= 280) return content;
  return content.substring(0, 277) + "...";
}

/**
 * Post content to Twitter / X.
 *
 * Requires env vars:
 *   SCCF_TWITTER_USERNAME — Twitter/X username (without @)
 *   SCCF_TWITTER_PASSWORD — Twitter/X password
 */
export async function postToTwitter(content: string): Promise<void> {
  const username = process.env.SCCF_TWITTER_USERNAME;
  const password = process.env.SCCF_TWITTER_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "SCCF_TWITTER_USERNAME and SCCF_TWITTER_PASSWORD must be set"
    );
  }

  const tweetText = truncateTweet(content);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    // -------------------------------------------------------------------------
    // 1. Navigate and click "Sign in"
    // -------------------------------------------------------------------------
    await page.goto(TWITTER_URL, { waitUntil: "networkidle" });

    const signInBtn = page
      .getByRole("link", { name: /sign in/i })
      .or(page.getByTestId("loginButton"));
    await signInBtn.first().waitFor({ state: "visible", timeout: 15000 });
    await signInBtn.first().click();

    // -------------------------------------------------------------------------
    // 2. Enter username
    // -------------------------------------------------------------------------
    await page.waitForSelector('input[autocomplete="username"]', {
      timeout: 15000,
    });
    await page.fill('input[autocomplete="username"]', username);

    const nextBtn = page.getByRole("button", { name: /next/i });
    await nextBtn.waitFor({ state: "visible", timeout: 10000 });
    await nextBtn.click();

    // -------------------------------------------------------------------------
    // 3. Enter password (Twitter may show an extra "verify" step — skip it)
    // -------------------------------------------------------------------------

    // Occasionally Twitter asks for phone/email verification before the password
    const verifyInput = page.locator(
      'input[data-testid="ocfEnterTextTextInput"]'
    );
    if (await verifyInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Can't proceed without manual intervention — surface a clear error
      throw new Error(
        "Twitter is requesting additional identity verification. " +
          "Log in manually once to clear the check, then retry."
      );
    }

    await page.waitForSelector('input[name="password"]', { timeout: 15000 });
    await page.fill('input[name="password"]', password);

    const loginBtn = page.getByTestId("LoginForm_Login_Button");
    await loginBtn.waitFor({ state: "visible", timeout: 10000 });
    await loginBtn.click();

    // Wait for home timeline
    await page.waitForURL(/x\.com\/home/i, { timeout: 30000 });

    // -------------------------------------------------------------------------
    // 4. Compose tweet
    // -------------------------------------------------------------------------

    // Click the "What is happening?!" / compose area
    const composeArea = page.getByTestId("tweetTextarea_0");
    await composeArea.waitFor({ state: "visible", timeout: 15000 });
    await composeArea.click();
    await composeArea.fill(tweetText);

    // -------------------------------------------------------------------------
    // 5. Post
    // -------------------------------------------------------------------------

    const postBtn = page.getByTestId("tweetButtonInline");
    await postBtn.waitFor({ state: "visible", timeout: 10000 });
    await postBtn.click();

    // Wait a moment for the network call to complete
    await page.waitForTimeout(3000);

    // Verify compose box cleared (tweet sent)
    const textAfter = await composeArea.inputValue().catch(() => "");
    if (textAfter.trim().length > 0 && textAfter === tweetText) {
      throw new Error("Tweet may not have been posted — compose box still has content");
    }

    console.log("[twitter] Tweet posted successfully");
  } catch (err) {
    await page
      .screenshot({ path: "poster-error-twitter.png" })
      .catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
