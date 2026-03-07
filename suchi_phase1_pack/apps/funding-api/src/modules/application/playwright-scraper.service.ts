import { Injectable, Logger, BadRequestException } from "@nestjs/common";

export interface ScrapedFormField {
  index: number;
  label: string;
  description: string;
  type: string; // text | textarea | select | radio | checkbox | file | unknown
  required: boolean;
  options: string[];
}

/**
 * Playwright-based form scraper for JS-rendered forms (Airtable, Typeform, Google Forms).
 *
 * Gracefully degrades when Playwright is not installed (e.g. prod Docker).
 * Ported from funding-eval/scripts/extract-airtable-form.ts.
 */
@Injectable()
export class PlaywrightScraperService {
  private readonly logger = new Logger(PlaywrightScraperService.name);
  private playwrightAvailable = false;

  constructor() {
    try {
      require.resolve("playwright");
      this.playwrightAvailable = true;
      this.logger.log("Playwright available — form scraping enabled");
    } catch {
      this.playwrightAvailable = false;
      this.logger.warn(
        "Playwright not installed — JS-rendered form scraping disabled",
      );
    }
  }

  isAvailable(): boolean {
    return this.playwrightAvailable;
  }

  /**
   * Scrape form fields from a JS-rendered page using headless Playwright.
   * Returns structured form fields with labels, types, and options.
   */
  async scrapeFormFields(url: string): Promise<ScrapedFormField[]> {
    if (!this.playwrightAvailable) {
      this.logger.warn("scrapeFormFields called but Playwright not available");
      return [];
    }

    this.validateUrl(url);

    // Dynamic import since Playwright may not be installed
    // @ts-ignore
    const { chromium } = await import("playwright");

    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      this.logger.log(`Navigating to ${url}...`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });

      // Wait for initial render
      await page.waitForTimeout(3000);

      // Scroll incrementally to load all lazy-rendered fields
      let prevHeight = 0;
      for (let i = 0; i < 20; i++) {
        const currentHeight = await page.evaluate(
          () => document.body.scrollHeight,
        );
        if (currentHeight === prevHeight && i > 2) break;
        prevHeight = currentHeight;
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        await page.waitForTimeout(1000);
      }
      // Scroll back to top
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);

      const fields = await this.extractFields(page);
      this.logger.log(
        `Playwright scraped ${fields.length} form fields from ${url}`,
      );

      await context.close();
      return fields;
    } finally {
      await browser.close();
    }
  }

  /**
   * Try multiple selector strategies for Airtable/JS-rendered forms.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async extractFields(page: any): Promise<ScrapedFormField[]> {
    const fieldSelectors = [
      ".sharedFormFieldWrapper",
      '[class*="formField"]',
      '[data-testid*="field"]',
      ".sharedFormField",
      '[class*="FieldWrapper"]',
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fieldElements: any = null;

    for (const sel of fieldSelectors) {
      const loc = page.locator(sel);
      const count = await loc.count();
      if (count > 0) {
        this.logger.debug(`Found ${count} fields with selector: ${sel}`);
        fieldElements = loc;
        break;
      }
    }

    if (!fieldElements) {
      this.logger.debug(
        "No Airtable-specific selectors matched, trying generic label scan",
      );
      return this.extractFieldsGeneric(page);
    }

    const fields: ScrapedFormField[] = [];
    const count = await fieldElements.count();

    for (let i = 0; i < count; i++) {
      const el = fieldElements.nth(i);

      // Extract label
      const labelSelectors = [
        ".fieldLabel",
        '[class*="FieldLabel"]',
        '[class*="fieldLabel"]',
        "label",
      ];
      let label = "";
      for (const ls of labelSelectors) {
        const lbl = el.locator(ls).first();
        if ((await lbl.count()) > 0) {
          label = ((await lbl.textContent()) ?? "").trim();
          if (label) break;
        }
      }

      // Extract description
      const descSelectors = [
        ".fieldDescription",
        '[class*="FieldDescription"]',
        '[class*="fieldDescription"]',
        '[class*="description"]',
      ];
      let description = "";
      for (const ds of descSelectors) {
        const desc = el.locator(ds).first();
        if ((await desc.count()) > 0) {
          description = ((await desc.textContent()) ?? "").trim();
          if (description) break;
        }
      }

      // Determine field type
      let fieldType = "unknown";
      if ((await el.locator("textarea").count()) > 0) fieldType = "textarea";
      else if ((await el.locator('input[type="file"]').count()) > 0)
        fieldType = "file";
      else if ((await el.locator('input[type="radio"]').count()) > 0)
        fieldType = "radio";
      else if ((await el.locator('input[type="checkbox"]').count()) > 0)
        fieldType = "checkbox";
      else if ((await el.locator("select").count()) > 0) fieldType = "select";
      else if (
        (await el
          .locator(
            'input[type="text"], input[type="email"], input[type="url"], input:not([type])',
          )
          .count()) > 0
      )
        fieldType = "text";

      // Check required
      const requiredIndicators = [
        '[class*="required"]',
        '[class*="Required"]',
        ".requiredIndicator",
        'span:has-text("*")',
      ];
      let required = false;
      for (const ri of requiredIndicators) {
        if ((await el.locator(ri).count()) > 0) {
          required = true;
          break;
        }
      }

      // Extract options (for radio/select/checkbox)
      const options: string[] = [];
      if (fieldType === "radio" || fieldType === "checkbox") {
        const optionEls = el.locator(
          '[class*="option"], [class*="Option"], label',
        );
        const optCount = await optionEls.count();
        for (let j = 0; j < optCount; j++) {
          const text = ((await optionEls.nth(j).textContent()) ?? "").trim();
          if (text && text !== label) options.push(text);
        }
      } else if (fieldType === "select") {
        const optEls = el.locator("option");
        const optCount = await optEls.count();
        for (let j = 0; j < optCount; j++) {
          const text = ((await optEls.nth(j).textContent()) ?? "").trim();
          if (text) options.push(text);
        }
      }

      if (label || description) {
        fields.push({ index: i, label, description, type: fieldType, required, options });
      }
    }

    return fields;
  }

  /**
   * Fallback: scan for all visible labels on the page.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async extractFieldsGeneric(page: any): Promise<ScrapedFormField[]> {
    const fields: ScrapedFormField[] = [];
    const allLabels = page.locator("label, [role='group'] > div:first-child");
    const count = await allLabels.count();

    this.logger.debug(`Generic scan: found ${count} potential labels`);

    for (let i = 0; i < count; i++) {
      const text = ((await allLabels.nth(i).textContent()) ?? "").trim();
      if (text && text.length > 2 && text.length < 500) {
        fields.push({
          index: i,
          label: text,
          description: "",
          type: "unknown",
          required: false,
          options: [],
        });
      }
    }

    return fields;
  }

  /**
   * SSRF protection — same checks as ApplicationIntakeService.validateUrl().
   */
  private validateUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`Invalid URL: ${url}`);
    }

    if (parsed.protocol !== "https:") {
      throw new BadRequestException(
        `Only https:// URLs are allowed, got: ${parsed.protocol}`,
      );
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("172.16.")
    ) {
      throw new BadRequestException(
        `SSRF blocked: private/internal URL not allowed: ${hostname}`,
      );
    }
  }
}
