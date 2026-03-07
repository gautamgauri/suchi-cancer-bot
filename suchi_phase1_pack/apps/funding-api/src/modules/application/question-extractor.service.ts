import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { ApplicationIntakeService } from "./application-intake.service";
import { PlaywrightScraperService, ScrapedFormField } from "./playwright-scraper.service";
import { Prisma } from "@prisma/client";
import { ApplicationQuestion, pushTimelineEvent } from "./application.types";
import {
  QUESTION_EXTRACT_SYSTEM_PROMPT,
  buildQuestionExtractContext,
} from "./prompts/application.prompts";

@Injectable()
export class QuestionExtractorService {
  private readonly logger = new Logger(QuestionExtractorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: FundingLlmService,
    private readonly intake: ApplicationIntakeService,
    private readonly scraperService: PlaywrightScraperService,
  ) {}

  /**
   * Extract all application questions from the opportunity page.
   */
  async extractQuestions(applicationId: string): Promise<ApplicationQuestion[]> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    this.logger.log(`Extracting questions for ${applicationId}`);

    const pageContent = await this.intake.fetchPageContent(app.sourceUrl);
    const context = buildQuestionExtractContext(pageContent, app.sourceUrl);

    const raw = await this.llm.generatePlain(
      QUESTION_EXTRACT_SYSTEM_PROMPT,
      context,
      "Extract all form fields and questions from this application page.",
      { maxTokens: 3000 },
    );

    let questions: ApplicationQuestion[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Not an array");
      questions = parsed.map((q: Record<string, unknown>, i: number) =>
        this.normalizeQuestion(q, i),
      );
    } catch {
      this.logger.warn(
        `Failed to parse questions JSON for ${applicationId}, attempting line-by-line extraction`,
      );
      questions = this.fallbackExtract(raw);
    }

    // If LLM extraction yielded few meaningful questions, try Playwright fallback
    const meaningfulCount = questions.filter(
      (q) =>
        q.fieldType !== "unknown" &&
        q.questionText.length > 5 &&
        !q.questionText.startsWith("["),
    ).length;

    if (meaningfulCount < 2 && this.scraperService.isAvailable()) {
      this.logger.log(
        `Only ${meaningfulCount} meaningful questions from LLM — trying Playwright fallback`,
      );
      try {
        const scraped = await this.scraperService.scrapeFormFields(app.sourceUrl);
        if (scraped.length > 0) {
          const scrapedQuestions = this.convertScrapedToQuestions(scraped, questions.length);
          const merged = this.mergeQuestions(questions, scrapedQuestions);
          this.logger.log(
            `Playwright added ${merged.length - questions.length} new questions (total: ${merged.length})`,
          );
          questions = merged;
        }
      } catch (err) {
        this.logger.warn(
          `Playwright fallback failed for ${applicationId}: ${(err as Error)?.message}`,
        );
      }
    } else if (meaningfulCount >= 2) {
      this.logger.debug("LLM extraction sufficient — skipping Playwright");
    }

    // Update the application record
    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    jsonBlob.questions = questions;
    jsonBlob.status = "questions_extracted";
    pushTimelineEvent(jsonBlob, {
      timestamp: new Date().toISOString(),
      action: "extract_questions",
      actor: "system",
      details: `Extracted ${questions.length} questions`,
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "questions_extracted",
        jsonBlob: jsonBlob as Prisma.InputJsonValue,
      },
    });

    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: app.id,
        action: "extract_questions",
        status: "success",
        actor: "system",
        details: { questionCount: questions.length } as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Extracted ${questions.length} questions for ${applicationId}`);
    return questions;
  }

  /**
   * Normalize a raw question object from LLM output.
   */
  private normalizeQuestion(
    raw: Record<string, unknown>,
    index: number,
  ): ApplicationQuestion {
    return {
      id: typeof raw.id === "string" ? raw.id : `q_${index + 1}`,
      questionText: typeof raw.questionText === "string" ? raw.questionText : String(raw.question ?? raw.label ?? `Question ${index + 1}`),
      fieldType: this.normalizeFieldType(raw.fieldType as string),
      wordLimit: typeof raw.wordLimit === "number" ? raw.wordLimit : undefined,
      charLimit: typeof raw.charLimit === "number" ? raw.charLimit : undefined,
      required: raw.required === true || raw.required === "true",
      options: Array.isArray(raw.options) ? raw.options.map(String) : undefined,
      sectionLabel: typeof raw.sectionLabel === "string" ? raw.sectionLabel : undefined,
    };
  }

  private normalizeFieldType(
    type: string | undefined,
  ): ApplicationQuestion["fieldType"] {
    const valid = [
      "text",
      "textarea",
      "select",
      "radio",
      "checkbox",
      "file_upload",
      "date",
      "number",
    ];
    if (type && valid.includes(type)) {
      return type as ApplicationQuestion["fieldType"];
    }
    return "unknown";
  }

  /**
   * Fallback extraction when JSON parsing fails — attempt to extract
   * question-like content from raw text.
   */
  private fallbackExtract(raw: string): ApplicationQuestion[] {
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const questions: ApplicationQuestion[] = [];
    let idx = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      // Look for numbered questions or lines ending with ?
      if (/^\d+[\.\)]\s/.test(trimmed) || trimmed.endsWith("?")) {
        idx++;
        questions.push({
          id: `q_${idx}`,
          questionText: trimmed.replace(/^\d+[\.\)]\s*/, ""),
          fieldType: "textarea",
          required: true,
        });
      }
    }

    if (questions.length === 0) {
      questions.push({
        id: "q_1",
        questionText: "[Could not extract questions — manual review needed]",
        fieldType: "unknown",
        required: true,
      });
    }

    return questions;
  }

  /**
   * Convert scraped form fields to ApplicationQuestion format.
   */
  private convertScrapedToQuestions(
    scraped: ScrapedFormField[],
    startIndex: number,
  ): ApplicationQuestion[] {
    return scraped
      .filter((f) => f.label.length > 2)
      .map((f, i) => ({
        id: `q_pw_${startIndex + i + 1}`,
        questionText: f.label,
        fieldType: this.normalizeFieldType(f.type),
        required: f.required,
        options: f.options.length > 0 ? f.options : undefined,
        sectionLabel: f.description || undefined,
      }));
  }

  /**
   * Merge LLM-extracted questions with Playwright-scraped questions.
   * Scraped fields that don't fuzzy-match existing questions get appended.
   */
  private mergeQuestions(
    existing: ApplicationQuestion[],
    scraped: ApplicationQuestion[],
  ): ApplicationQuestion[] {
    const merged = [...existing];
    const existingTexts = existing.map((q) => q.questionText.toLowerCase());

    for (const sq of scraped) {
      const sqLower = sq.questionText.toLowerCase();
      const isDuplicate = existingTexts.some(
        (et) => this.fuzzyMatch(et, sqLower),
      );
      if (!isDuplicate) {
        merged.push(sq);
      }
    }

    return merged;
  }

  /**
   * Simple fuzzy match — checks if significant words overlap between two strings.
   */
  private fuzzyMatch(a: string, b: string): boolean {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will",
      "would", "could", "should", "may", "might", "shall", "can",
      "of", "in", "to", "for", "with", "on", "at", "from", "by",
      "your", "you", "this", "that", "what", "which", "how",
    ]);

    const wordsA = a.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
    const wordsB = b.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));

    if (wordsA.length === 0 || wordsB.length === 0) return false;

    const matchCount = wordsA.filter((w) => wordsB.some((wb) => wb.includes(w) || w.includes(wb))).length;
    return matchCount / Math.min(wordsA.length, wordsB.length) >= 0.5;
  }
}
