/* eslint-disable no-console */
/**
 * Extract form fields from an Airtable form page using Playwright.
 *
 * Usage:
 *   cd funding-eval
 *   npx tsx scripts/extract-airtable-form.ts
 *   npx tsx scripts/extract-airtable-form.ts --headed   # debug with visible browser
 *   npx tsx scripts/extract-airtable-form.ts --url <url> --output <path>
 *
 * Output: digital-minds-questions.json (array of form fields)
 */
import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const DEFAULT_URL =
  "https://airtable.com/appB2hZBZVdkDjm3N/pagM7UKtYnhBERW8m/form";
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "digital-minds-questions.json",
);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k: string, def?: string) => {
    const i = args.indexOf(k);
    return i === -1 ? def : args[i + 1];
  };
  const flag = (k: string) => args.includes(k);
  return {
    url: get("--url", DEFAULT_URL)!,
    output: get("--output", DEFAULT_OUTPUT)!,
    headed: flag("--headed"),
  };
}

interface FormField {
  index: number;
  label: string;
  description: string;
  type: string; // text | textarea | select | radio | checkbox | file | unknown
  required: boolean;
  options: string[];
}

/**
 * Try multiple selector strategies for Airtable's obfuscated DOM.
 */
async function extractFields(page: import("playwright").Page): Promise<FormField[]> {
  // Airtable forms use various class patterns — try several
  const fieldSelectors = [
    ".sharedFormFieldWrapper",
    '[class*="formField"]',
    '[data-testid*="field"]',
    ".sharedFormField",
    // Fallback: any container with a label-like child
    '[class*="FieldWrapper"]',
  ];

  let fieldElements: import("playwright").Locator | null = null;
  let selectorUsed = "";

  for (const sel of fieldSelectors) {
    const loc = page.locator(sel);
    const count = await loc.count();
    if (count > 0) {
      console.log(`Found ${count} fields with selector: ${sel}`);
      fieldElements = loc;
      selectorUsed = sel;
      break;
    }
  }

  if (!fieldElements || selectorUsed === "") {
    console.warn("No field containers found with known selectors. Trying generic label scan...");
    return extractFieldsGeneric(page);
  }

  const fields: FormField[] = [];
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
    else if ((await el.locator('input[type="file"]').count()) > 0) fieldType = "file";
    else if ((await el.locator('input[type="radio"]').count()) > 0) fieldType = "radio";
    else if ((await el.locator('input[type="checkbox"]').count()) > 0) fieldType = "checkbox";
    else if ((await el.locator("select").count()) > 0) fieldType = "select";
    else if ((await el.locator('input[type="text"], input[type="email"], input[type="url"], input:not([type])').count()) > 0)
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
      const optionEls = el.locator('[class*="option"], [class*="Option"], label');
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
      fields.push({
        index: i,
        label,
        description,
        type: fieldType,
        required,
        options,
      });
    }
  }

  return fields;
}

/**
 * Fallback: scan for all visible labels on the page.
 */
async function extractFieldsGeneric(page: import("playwright").Page): Promise<FormField[]> {
  const fields: FormField[] = [];

  // Try to get all text content that looks like form labels
  const allLabels = page.locator("label, [role='group'] > div:first-child");
  const count = await allLabels.count();
  console.log(`Generic scan: found ${count} potential labels`);

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

async function main() {
  const { url, output, headed } = parseArgs();
  console.log(`Airtable form extractor | url=${url} | headed=${headed}`);

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    console.log("Navigating to form...");
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

    // Wait for initial render, then scroll to bottom to trigger lazy-loading
    await page.waitForTimeout(3000);

    // Scroll incrementally to load all lazy-rendered fields
    console.log("Scrolling to load all form fields...");
    let prevHeight = 0;
    for (let i = 0; i < 20; i++) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === prevHeight && i > 2) break;
      prevHeight = currentHeight;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }
    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    console.log("Extracting form fields...");
    const fields = await extractFields(page);
    console.log(`Extracted ${fields.length} form fields`);

    // Write output
    fs.writeFileSync(output, JSON.stringify(fields, null, 2));
    console.log(`Saved to ${output}`);

    // Print summary
    for (const f of fields) {
      const req = f.required ? " *" : "";
      console.log(`  [${f.index}] ${f.label}${req} (${f.type})`);
      if (f.description) console.log(`      ${f.description.slice(0, 100)}`);
    }

    await context.close();
  } finally {
    await browser.close();
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
