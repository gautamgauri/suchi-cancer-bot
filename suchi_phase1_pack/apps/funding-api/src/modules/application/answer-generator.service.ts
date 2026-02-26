import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FundingLlmService } from "../core_ai/funding-llm.service";
import {
  ApplicantProfile,
  ApplicationQuestion,
  DraftedAnswer,
  OppReviseRequest,
  pushTimelineEvent,
} from "./application.types";
import {
  ANSWER_GENERATOR_SYSTEM_PROMPT,
  ANSWER_REVISE_SYSTEM_PROMPT,
  buildAnswerContext,
  buildReviseContext,
} from "./prompts/application.prompts";
import * as fs from "fs";
import * as path from "path";

@Injectable()
export class AnswerGeneratorService {
  private readonly logger = new Logger(AnswerGeneratorService.name);
  private profileCache: ApplicantProfile | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: FundingLlmService,
  ) {}

  /**
   * Load the applicant profile from the JSON file.
   * Cached after first load (restart to reload).
   */
  getProfile(): ApplicantProfile {
    if (this.profileCache) return this.profileCache;

    const profilePath = path.join(
      __dirname,
      "data",
      "applicant-profile.json",
    );
    const raw = fs.readFileSync(profilePath, "utf-8");
    this.profileCache = JSON.parse(raw) as ApplicantProfile;
    return this.profileCache;
  }

  /**
   * Format the applicant profile as a string for the LLM context.
   */
  private formatProfileForLLM(): string {
    const p = this.getProfile();
    const parts: string[] = [];

    parts.push(`NAME: ${p.identity.full_name}`);
    parts.push(`LOCATION: ${p.identity.location}`);
    parts.push("");

    parts.push("ROLES:");
    for (const role of p.roles) {
      parts.push(`- ${role.title}, ${role.org}: ${role.summary_1line}`);
    }
    parts.push("");

    parts.push("EDUCATION:");
    for (const edu of p.education) {
      parts.push(`- ${edu.program}, ${edu.institution} (${edu.years})`);
    }
    parts.push("");

    parts.push(`CORE INTERESTS: ${p.core_interests.join(", ")}`);
    parts.push("");

    parts.push("SIGNATURE PROJECTS:");
    for (const proj of p.signature_projects) {
      parts.push(`- ${proj.name} (${proj.type}): ${proj.what_it_does ?? proj.target ?? ""}`);
    }
    parts.push("");

    parts.push(`FRAMEWORKS: ${p.frameworks.join(", ")}`);
    parts.push("");

    const metrics = p.metrics_and_credibility;
    parts.push("METRICS:");
    for (const [k, v] of Object.entries(metrics)) {
      parts.push(`- ${k}: ${v}`);
    }
    parts.push("");

    // Include non-empty snippets
    const snippetEntries = Object.entries(p.snippets).filter(
      ([, v]) => v && v.trim().length > 0,
    );
    if (snippetEntries.length > 0) {
      parts.push("REUSABLE SNIPPETS:");
      for (const [key, content] of snippetEntries) {
        parts.push(`[${key}]: ${content}`);
      }
    }

    return parts.join("\n");
  }

  /**
   * Fetch relevant past answers from the DB to include as context.
   */
  private async fetchPastAnswers(
    questions: ApplicationQuestion[],
    programType?: string,
  ): Promise<string> {
    // Find past answers that match similar question patterns
    const pastAnswers = await this.prisma.pastApplicationAnswer.findMany({
      where: {
        wasApproved: true,
        ...(programType && { programType }),
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (pastAnswers.length === 0) return "(No past answers available yet.)";

    return pastAnswers
      .map(
        (a) =>
          `[${a.programName ?? "Unknown Program"} | ${a.programType ?? ""}]\nQ: ${a.questionPattern}\nA: ${a.answerText.substring(0, 500)}`,
      )
      .join("\n\n---\n\n");
  }

  /**
   * Fetch DB-stored snippets to supplement the file-based profile snippets.
   */
  private async fetchDbSnippets(): Promise<string> {
    const snippets = await this.prisma.applicationSnippet.findMany({
      orderBy: { usageCount: "desc" },
      take: 20,
    });

    if (snippets.length === 0) return "";

    return snippets
      .map((s) => `[${s.snippetKey}]: ${s.content}`)
      .join("\n\n");
  }

  /**
   * Generate draft answers for all questions in an application.
   */
  async generateAnswers(applicationId: string): Promise<DraftedAnswer[]> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    const questions = jsonBlob.questions as ApplicationQuestion[];
    if (!questions || questions.length === 0) {
      throw new BadRequestException(
        `No questions extracted yet for ${applicationId}. Run extract first.`,
      );
    }

    this.logger.log(
      `Generating answers for ${applicationId} (${questions.length} questions)`,
    );

    // Build context
    const profile = this.formatProfileForLLM();
    const dbSnippets = await this.fetchDbSnippets();
    const fullProfile = dbSnippets
      ? `${profile}\n\nADDITIONAL SNIPPETS FROM DB:\n${dbSnippets}`
      : profile;

    const pastAnswers = await this.fetchPastAnswers(
      questions,
      app.opportunityType,
    );

    const programContext = `Program: ${app.programName}\nOrganizer: ${app.organizerName ?? "Unknown"}\nType: ${app.opportunityType}\nDeadline: ${app.deadline?.toISOString() ?? "Unknown"}`;

    const questionsStr = questions
      .map((q) => {
        let line = `[${q.id}] ${q.questionText}`;
        if (q.fieldType !== "textarea" && q.fieldType !== "text") {
          line += ` (type: ${q.fieldType})`;
        }
        if (q.wordLimit) line += ` [max ${q.wordLimit} words]`;
        if (q.charLimit) line += ` [max ${q.charLimit} chars]`;
        if (q.required) line += " [REQUIRED]";
        if (q.options) line += ` [options: ${q.options.join(", ")}]`;
        return line;
      })
      .join("\n");

    const context = buildAnswerContext(
      questionsStr,
      fullProfile,
      pastAnswers,
      programContext,
    );

    const raw = await this.llm.generatePlain(
      ANSWER_GENERATOR_SYSTEM_PROMPT,
      context,
      `Generate answers for all ${questions.length} questions. Return valid JSON array.`,
      { maxTokens: 4000 },
    );

    let answers: DraftedAnswer[];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("Not an array");
      answers = parsed.map((a: Record<string, unknown>) =>
        this.normalizeAnswer(a),
      );
    } catch {
      this.logger.warn(
        `Failed to parse answers JSON for ${applicationId}, using fallback`,
      );
      answers = questions.map((q) => ({
        questionId: q.id,
        questionText: q.questionText,
        answerText:
          "[Could not generate answer — manual input needed]",
        wordCount: 0,
        charCount: 0,
        wordLimit: q.wordLimit,
        charLimit: q.charLimit,
        withinLimit: true,
        confidence: "needs_human" as const,
        sourceSnippets: [],
        notes: "LLM response could not be parsed",
      }));
    }

    // Update the application record
    jsonBlob.answers = answers;
    jsonBlob.status = "review";
    pushTimelineEvent(jsonBlob, {
      timestamp: new Date().toISOString(),
      action: "draft_answers",
      actor: "system",
      details: `Drafted ${answers.length} answers, ${answers.filter((a) => a.confidence === "needs_human").length} need human input`,
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "review",
        jsonBlob: jsonBlob as unknown as Record<string, unknown>,
      },
    });

    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: app.id,
        action: "draft_answers",
        status: "success",
        actor: "system",
        details: {
          answerCount: answers.length,
          needsHuman: answers.filter((a) => a.confidence === "needs_human")
            .length,
        } as unknown as Record<string, unknown>,
      },
    });

    this.logger.log(
      `Generated ${answers.length} answers for ${applicationId}`,
    );
    return answers;
  }

  /**
   * Revise a specific answer or all answers with instructions.
   */
  async reviseAnswer(req: OppReviseRequest): Promise<DraftedAnswer[]> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId: req.applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${req.applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    const currentAnswers = jsonBlob.answers as DraftedAnswer[];
    if (!currentAnswers || currentAnswers.length === 0) {
      throw new BadRequestException(`No answers to revise for ${req.applicationId}`);
    }

    const toRevise = req.questionId
      ? currentAnswers.filter((a) => a.questionId === req.questionId)
      : currentAnswers;

    const revised: DraftedAnswer[] = [];

    for (const answer of toRevise) {
      const context = buildReviseContext(
        JSON.stringify(answer),
        req.instructions,
        answer.wordLimit,
      );

      const raw = await this.llm.generatePlain(
        ANSWER_REVISE_SYSTEM_PROMPT,
        context,
        "Revise this answer.",
      );

      try {
        const parsed = JSON.parse(raw);
        revised.push(this.normalizeAnswer(parsed));
      } catch {
        this.logger.warn(
          `Failed to parse revised answer for ${answer.questionId}`,
        );
        revised.push(answer); // keep original on failure
      }
    }

    // Merge revised answers back
    const updatedAnswers = currentAnswers.map((a) => {
      const replacement = revised.find((r) => r.questionId === a.questionId);
      return replacement ?? a;
    });

    jsonBlob.answers = updatedAnswers;
    pushTimelineEvent(jsonBlob, {
      timestamp: new Date().toISOString(),
      action: "revise_answers",
      actor: "gautam",
      details: `Revised ${revised.length} answers: "${req.instructions}"`,
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId: req.applicationId },
      data: {
        jsonBlob: jsonBlob as unknown as Record<string, unknown>,
      },
    });

    return updatedAnswers;
  }

  /**
   * Archive approved answers as PastApplicationAnswer records for future reuse.
   */
  async archiveApprovedAnswers(applicationId: string): Promise<number> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    const answers = jsonBlob.answers as DraftedAnswer[];
    if (!answers) return 0;

    let count = 0;
    for (const answer of answers) {
      if (answer.answerText && answer.confidence !== "needs_human") {
        await this.prisma.pastApplicationAnswer.create({
          data: {
            applicationId: app.id,
            questionPattern: answer.questionText.toLowerCase().trim(),
            answerText: answer.answerText,
            wordCount: answer.wordCount,
            programName: app.programName,
            programType: app.opportunityType,
            wasApproved: app.status === "approved" || app.status === "submitted",
            wasSubmitted: app.status === "submitted",
          },
        });
        count++;
      }
    }

    this.logger.log(`Archived ${count} answers from ${applicationId}`);
    return count;
  }

  private normalizeAnswer(raw: Record<string, unknown>): DraftedAnswer {
    const answerText = typeof raw.answerText === "string" ? raw.answerText : "";
    const wordCount =
      typeof raw.wordCount === "number"
        ? raw.wordCount
        : answerText.split(/\s+/).filter(Boolean).length;
    const charCount =
      typeof raw.charCount === "number" ? raw.charCount : answerText.length;
    const wordLimit = typeof raw.wordLimit === "number" ? raw.wordLimit : undefined;
    const charLimit = typeof raw.charLimit === "number" ? raw.charLimit : undefined;

    return {
      questionId: typeof raw.questionId === "string" ? raw.questionId : "unknown",
      questionText: typeof raw.questionText === "string" ? raw.questionText : "",
      answerText,
      wordCount,
      charCount,
      wordLimit,
      charLimit,
      withinLimit:
        (wordLimit == null || wordCount <= wordLimit) &&
        (charLimit == null || charCount <= charLimit),
      confidence: this.normalizeConfidence(raw.confidence as string),
      sourceSnippets: Array.isArray(raw.sourceSnippets) ? raw.sourceSnippets.map(String) : [],
      notes: typeof raw.notes === "string" ? raw.notes : "",
    };
  }

  private normalizeConfidence(
    conf: string | undefined,
  ): DraftedAnswer["confidence"] {
    const valid = ["high", "medium", "low", "needs_human"];
    if (conf && valid.includes(conf)) return conf as DraftedAnswer["confidence"];
    return "medium";
  }
}
