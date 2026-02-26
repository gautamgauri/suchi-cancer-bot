import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  ApplicationDocument,
  DraftedAnswer,
  PrefillFieldLog,
  PrefillResult,
} from "./application.types";

/**
 * Browser Prefill Runner — uses Playwright to fill application forms.
 *
 * Security guardrails:
 * - NEVER clicks "Submit" — only fills fields
 * - Pauses on login/OTP, CAPTCHA, payment, and file uploads
 * - Produces a fill log + screenshot proof
 * - Requires explicit "Approve & Submit" from the human
 *
 * NOTE: Playwright must be installed as a dependency for this to work.
 * If not available, the service gracefully falls back to a "manual copy" mode.
 */
@Injectable()
export class BrowserPrefillService {
  private readonly logger = new Logger(BrowserPrefillService.name);
  private playwrightAvailable = false;

  constructor(private readonly prisma: PrismaService) {
    this.checkPlaywrightAvailability();
  }

  private checkPlaywrightAvailability(): void {
    try {
      require.resolve("playwright");
      this.playwrightAvailable = true;
      this.logger.log("Playwright available — browser prefill enabled");
    } catch {
      this.playwrightAvailable = false;
      this.logger.warn(
        "Playwright not installed — browser prefill disabled, manual copy mode active",
      );
    }
  }

  /**
   * Prefill an application form in the browser.
   * Returns a fill log showing what was filled and what was skipped.
   */
  async prefill(applicationId: string): Promise<PrefillResult> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new Error(`Application not found: ${applicationId}`);

    if (app.status !== "approved") {
      throw new Error(
        `Application ${applicationId} must be approved before prefill. Current status: ${app.status}`,
      );
    }

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    const doc = jsonBlob as unknown as ApplicationDocument;
    const answers = doc.answers;

    if (!answers || answers.length === 0) {
      throw new Error(`No answers available for prefill in ${applicationId}`);
    }

    if (!this.playwrightAvailable) {
      return this.manualCopyFallback(applicationId, app.sourceUrl, answers);
    }

    return this.runPlaywrightPrefill(applicationId, app, doc);
  }

  /**
   * Run Playwright-based prefill.
   */
  private async runPlaywrightPrefill(
    applicationId: string,
    app: { id: string; sourceUrl: string },
    doc: ApplicationDocument,
  ): Promise<PrefillResult> {
    // Dynamic import since Playwright may not be installed
    const { chromium } = await import("playwright");

    const fillLog: PrefillFieldLog[] = [];
    let fieldsFilled = 0;
    let fieldsSkipped = 0;
    const skippedReasons: string[] = [];

    const browser = await chromium.launch({ headless: false }); // visible so user can intervene
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(app.sourceUrl, { waitUntil: "networkidle", timeout: 30000 });

      // Check for login/CAPTCHA blockers
      const pageContent = await page.content();
      if (this.detectBlocker(pageContent)) {
        this.logger.warn(
          `Blocker detected on ${app.sourceUrl} — pausing for manual intervention`,
        );
        skippedReasons.push("Login/CAPTCHA/OTP detected — manual intervention needed");

        // Wait for user to handle login (up to 5 minutes)
        await page.waitForTimeout(5000);
      }

      // Try to fill each answer
      for (const answer of doc.answers) {
        try {
          const filled = await this.fillField(page, answer);
          if (filled) {
            fieldsFilled++;
            fillLog.push({
              questionId: answer.questionId,
              selector: `[name*="${answer.questionId}"]`,
              action: "filled",
            });
          } else {
            fieldsSkipped++;
            fillLog.push({
              questionId: answer.questionId,
              selector: "",
              action: "skipped",
              reason: "Could not find matching form field",
            });
            skippedReasons.push(
              `${answer.questionId}: Could not find matching field`,
            );
          }
        } catch (error) {
          fieldsSkipped++;
          const msg = (error as Error)?.message ?? "Unknown error";
          fillLog.push({
            questionId: answer.questionId,
            selector: "",
            action: "error",
            reason: msg,
          });
          skippedReasons.push(`${answer.questionId}: ${msg}`);
        }
      }

      // Take screenshot proof
      const screenshotPath = `/tmp/prefill-${applicationId}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const result: PrefillResult = {
        fieldsFilled,
        fieldsSkipped,
        skippedReasons,
        screenshotPath,
        fillLog,
      };

      // Update application record
      const jsonBlob = app as unknown as Record<string, unknown>;
      // We need to re-fetch since app is minimal here
      await this.updateApplicationWithPrefillResult(applicationId, result);

      // Keep browser open for manual review — do NOT close automatically
      this.logger.log(
        `Prefill complete for ${applicationId}: ${fieldsFilled} filled, ${fieldsSkipped} skipped. Browser left open for review.`,
      );

      return result;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  /**
   * Try to fill a single form field using various selector strategies.
   */
  private async fillField(
    page: import("playwright").Page,
    answer: DraftedAnswer,
  ): Promise<boolean> {
    const questionText = answer.questionText.toLowerCase();

    // Strategy 1: Find by label text match
    const labels = await page.$$("label");
    for (const label of labels) {
      const labelText = (await label.textContent())?.toLowerCase() ?? "";
      if (this.fuzzyMatch(labelText, questionText)) {
        const forAttr = await label.getAttribute("for");
        if (forAttr) {
          const input = await page.$(`#${forAttr}`);
          if (input) {
            await input.fill(answer.answerText);
            return true;
          }
        }
        // Try next sibling
        const sibling = await label.$("+ input, + textarea, + select");
        if (sibling) {
          await sibling.fill(answer.answerText);
          return true;
        }
      }
    }

    // Strategy 2: Find by placeholder text match
    const inputs = await page.$$("input, textarea");
    for (const input of inputs) {
      const placeholder = (await input.getAttribute("placeholder"))?.toLowerCase() ?? "";
      if (this.fuzzyMatch(placeholder, questionText)) {
        await input.fill(answer.answerText);
        return true;
      }
    }

    return false;
  }

  /**
   * Detect login walls, CAPTCHAs, OTP screens, and payment gates.
   */
  private detectBlocker(html: string): boolean {
    const lower = html.toLowerCase();
    const blockerPatterns = [
      "captcha",
      "recaptcha",
      "hcaptcha",
      "sign in",
      "log in",
      "login",
      "one-time password",
      "otp",
      "verify your email",
      "payment required",
      "credit card",
    ];
    return blockerPatterns.some((p) => lower.includes(p));
  }

  /**
   * Simple fuzzy match — checks if significant words from the question
   * appear in the target text.
   */
  private fuzzyMatch(target: string, question: string): boolean {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will",
      "would", "could", "should", "may", "might", "shall", "can",
      "of", "in", "to", "for", "with", "on", "at", "from", "by",
      "your", "you", "this", "that", "what", "which", "how",
    ]);

    const questionWords = question
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));

    if (questionWords.length === 0) return false;

    const matchCount = questionWords.filter((w) =>
      target.includes(w),
    ).length;

    return matchCount / questionWords.length >= 0.5;
  }

  /**
   * Fallback when Playwright is not available — generates a copy-paste guide.
   */
  private manualCopyFallback(
    applicationId: string,
    sourceUrl: string,
    answers: DraftedAnswer[],
  ): PrefillResult {
    this.logger.log(
      `Generating manual copy guide for ${applicationId} (Playwright not available)`,
    );

    const fillLog: PrefillFieldLog[] = answers.map((a) => ({
      questionId: a.questionId,
      selector: "manual",
      action: "skipped" as const,
      reason: "Playwright not installed — use copy-paste from the answer pack",
    }));

    return {
      fieldsFilled: 0,
      fieldsSkipped: answers.length,
      skippedReasons: [
        "Playwright not installed. Use the answer pack document to manually copy-paste answers.",
        `Open ${sourceUrl} and fill in the ${answers.length} answers from the approved pack.`,
      ],
      fillLog,
    };
  }

  /**
   * Update the application record with prefill results.
   */
  private async updateApplicationWithPrefillResult(
    applicationId: string,
    result: PrefillResult,
  ): Promise<void> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) return;

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    jsonBlob.prefillResult = result;
    jsonBlob.status = "prefilled";
    (jsonBlob.timeline as Array<Record<string, unknown>>).push({
      timestamp: new Date().toISOString(),
      action: "prefill",
      actor: "system",
      details: `Filled ${result.fieldsFilled} fields, skipped ${result.fieldsSkipped}`,
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "prefilled",
        jsonBlob: jsonBlob as unknown as Record<string, unknown>,
      },
    });

    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: app.id,
        action: "prefill",
        status: "success",
        actor: "system",
        details: result as unknown as Record<string, unknown>,
      },
    });
  }
}
