import { chromium } from "playwright";

const INSTAGRAM_URL = "https://www.instagram.com/";
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS === "true";

/**
 * Post text content to Instagram as a caption-only post.
 *
 * Requires env vars:
 *   SCCF_INSTAGRAM_EMAIL    — Instagram account email / username
 *   SCCF_INSTAGRAM_PASSWORD — Instagram account password
 *
 * Note: Instagram requires a media file for posts. We use a minimal 1x1
 * transparent PNG data URI written to a temp file, then attach it as the
 * media. The caption carries the real content.
 */
export async function postToInstagram(content: string): Promise<void> {
  const email = process.env.SCCF_INSTAGRAM_EMAIL;
  const password = process.env.SCCF_INSTAGRAM_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "SCCF_INSTAGRAM_EMAIL and SCCF_INSTAGRAM_PASSWORD must be set"
    );
  }

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
    // 1. Navigate to Instagram and log in
    // -------------------------------------------------------------------------
    await page.goto(INSTAGRAM_URL, { waitUntil: "networkidle" });

    // Accept cookies if prompted
    const cookieBtn = page.getByRole("button", { name: /allow.*cookies|accept all/i });
    if (await cookieBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cookieBtn.click();
    }

    // Fill login form
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.fill('input[name="username"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    // Wait for home page — Instagram redirects after successful login
    await page.waitForURL(/instagram\.com\/(home|accounts\/onetap|\?)/i, {
      timeout: 30000,
    }).catch(() => {
      // Some accounts land on a different path; continue anyway
    });

    // -------------------------------------------------------------------------
    // 2. Dismiss post-login interstitials
    // -------------------------------------------------------------------------

    // "Save your login info?" — click "Not Now"
    const saveLoginBtn = page.getByRole("button", { name: /not now/i });
    if (await saveLoginBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await saveLoginBtn.click();
    }

    // "Turn on notifications?" — click "Not Now"
    const notifBtn = page.getByRole("button", { name: /not now/i });
    if (await notifBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await notifBtn.click();
    }

    // -------------------------------------------------------------------------
    // 3. Create a new post
    // -------------------------------------------------------------------------

    // Click the "New post" / "Create" button in the nav (aria-label varies)
    const createBtn = page.locator(
      '[aria-label="New post"], [aria-label="Create"], svg[aria-label="New post"]'
    ).first();
    await createBtn.waitFor({ state: "visible", timeout: 15000 });
    await createBtn.click();

    // -------------------------------------------------------------------------
    // 4. Upload a placeholder image (Instagram requires media)
    // -------------------------------------------------------------------------

    // Write a minimal 1×1 white JPEG as a temp file
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const nodeFs = await import("node:fs/promises");

    // Smallest valid JPEG (1×1 white pixel)
    const minimalJpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
        "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
        "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
        "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB" +
        "QQHAAIDEQABAQAAAAAAAAAAAAAAAAAAAQP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEB" +
        "AAAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKwAB//Z",
      "base64"
    );
    const tmpFile = nodePath.join(os.tmpdir(), "sccf-placeholder.jpg");
    await nodeFs.writeFile(tmpFile, minimalJpeg);

    // Locate the hidden file input inside the new-post dialog
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpFile);

    // Wait for image to be processed / the "Next" button to appear
    const nextBtn = page.getByRole("button", { name: /next/i });
    await nextBtn.waitFor({ state: "visible", timeout: 20000 });
    await nextBtn.click(); // Crop step → click Next again
    await page.waitForTimeout(1500);

    const nextBtn2 = page.getByRole("button", { name: /next/i });
    if (await nextBtn2.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nextBtn2.click(); // Filter step → proceed to caption
      await page.waitForTimeout(1500);
    }

    // -------------------------------------------------------------------------
    // 5. Fill in caption
    // -------------------------------------------------------------------------

    const captionArea = page.locator(
      '[aria-label="Write a caption..."], textarea[placeholder*="caption" i]'
    ).first();
    await captionArea.waitFor({ state: "visible", timeout: 15000 });
    await captionArea.click();
    await captionArea.fill(content);

    // -------------------------------------------------------------------------
    // 6. Share the post
    // -------------------------------------------------------------------------

    const shareBtn = page.getByRole("button", { name: /share/i }).last();
    await shareBtn.waitFor({ state: "visible", timeout: 10000 });
    await shareBtn.click();

    // Wait for confirmation that the post was published
    await page.waitForSelector(
      '[aria-label="Post shared"], text=Your post has been shared',
      { timeout: 30000 }
    );

    console.log("[instagram] Post published successfully");

    // Clean up temp file
    await nodeFs.unlink(tmpFile).catch(() => {});
  } catch (err) {
    await page
      .screenshot({ path: "poster-error-instagram.png" })
      .catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
