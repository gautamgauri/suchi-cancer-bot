import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import { ApplicationIntakeService } from "./application-intake.service";
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
}
