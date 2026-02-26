import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApplicationIntakeService } from "./application-intake.service";
import { QuestionExtractorService } from "./question-extractor.service";
import { AnswerGeneratorService } from "./answer-generator.service";
import { ApplicationReviewService } from "./application-review.service";
import { BrowserPrefillService } from "./browser-prefill.service";
import {
  OppAddRequest,
  OppReviseRequest,
  OppStatusResponse,
  OppTriageResponse,
  OppDraftResponse,
  ApplicationTriage,
  DraftedAnswer,
  PrefillResult,
} from "./application.types";

/**
 * Slack command orchestrator for the Opportunity Application Assistant.
 *
 * Supported commands:
 *   /opp add <url>            → creates opportunity record + Drive workspace
 *   /opp triage <id>          → fit/effort/deadline summary
 *   /opp draft <id>           → generates answer pack
 *   /opp revise <id> "..."    → controlled rewrite
 *   /opp approve <id>         → locks answers for prefill
 *   /opp prefill <id>         → launches browser runner
 *   /opp status <id>          → timeline + who owns next step
 *   /opp list [status]        → list all applications
 *
 * Each command returns a Slack-formatted message block.
 */
@Injectable()
export class ApplicationSlackService {
  private readonly logger = new Logger(ApplicationSlackService.name);
  private readonly webhookUrl: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly intake: ApplicationIntakeService,
    private readonly questionExtractor: QuestionExtractorService,
    private readonly answerGenerator: AnswerGeneratorService,
    private readonly review: ApplicationReviewService,
    private readonly prefill: BrowserPrefillService,
  ) {
    this.webhookUrl = this.config.get<string>("FUNDING_SLACK_WEBHOOK_URL");
  }

  /**
   * Route a Slack command to the appropriate handler.
   */
  async handleCommand(
    command: string,
    args: string[],
    actor: string = "gautam",
  ): Promise<string> {
    try {
      switch (command) {
        case "add":
          return this.handleAdd(args, actor);
        case "triage":
          return this.handleTriage(args[0]);
        case "draft":
          return this.handleDraft(args[0]);
        case "revise":
          return this.handleRevise(args, actor);
        case "approve":
          return this.handleApprove(args[0], actor);
        case "prefill":
          return this.handlePrefill(args[0]);
        case "status":
          return this.handleStatus(args[0]);
        case "list":
          return this.handleList(args[0]);
        case "submit":
          return this.handleSubmit(args[0], actor);
        default:
          return this.formatHelp();
      }
    } catch (error) {
      const msg = (error as Error)?.message ?? "Unknown error";
      this.logger.error(`Slack command error: ${command} ${args.join(" ")} — ${msg}`);
      return `Error: ${msg}`;
    }
  }

  // ─── Command Handlers ───────────────────────────────────────────────────

  private async handleAdd(args: string[], actor: string): Promise<string> {
    const url = args[0];
    if (!url) return "Usage: `/opp add <url> [notes]`";

    const notes = args.slice(1).join(" ") || undefined;
    const req: OppAddRequest = { url, notes, owner: actor };
    const result = await this.intake.ingest(req);

    return this.formatBlock(
      "New Opportunity Ingested",
      [
        `*ID:* \`${result.applicationId}\``,
        `*Program:* ${result.programName}`,
        `*URL:* ${url}`,
        notes ? `*Notes:* ${notes}` : "",
        "",
        "Next: Run `/opp triage " + result.applicationId + "` to assess fit.",
      ].filter(Boolean),
    );
  }

  private async handleTriage(applicationId: string): Promise<string> {
    if (!applicationId) return "Usage: `/opp triage <application-id>`";

    const triage: ApplicationTriage =
      await this.intake.triage(applicationId);

    const fitEmoji =
      triage.fitLevel === "strong"
        ? "+++"
        : triage.fitLevel === "moderate"
          ? "++"
          : triage.fitLevel === "weak"
            ? "+"
            : "?";

    return this.formatBlock(
      `Triage: ${applicationId}`,
      [
        `*Fit:* ${fitEmoji} ${triage.fitLevel}`,
        `*Reasons:* ${triage.fitReasons.join("; ")}`,
        `*Effort:* ${triage.effortLevel} (~${triage.estimatedQuestions} questions)`,
        `*Deadline:* ${triage.deadline ?? "Unknown"}`,
        `*Themes:* ${triage.relevanceThemes.join(", ")}`,
        "",
        `*Recommendation:* ${triage.recommendation}`,
        "",
        "Next: Run `/opp draft " + applicationId + "` to generate answers.",
      ],
    );
  }

  private async handleDraft(applicationId: string): Promise<string> {
    if (!applicationId) return "Usage: `/opp draft <application-id>`";

    // Step 1: Extract questions if not already done
    const app = await this.review.getStatus(applicationId);
    if (
      app.status === "intake" ||
      app.status === "triaged" ||
      app.questionsTotal === 0
    ) {
      await this.questionExtractor.extractQuestions(applicationId);
    }

    // Step 2: Generate answers
    const answers: DraftedAnswer[] =
      await this.answerGenerator.generateAnswers(applicationId);

    const needsHuman = answers.filter(
      (a) => a.confidence === "needs_human",
    ).length;
    const overLimit = answers.filter((a) => !a.withinLimit).length;

    return this.formatBlock(
      `Draft Complete: ${applicationId}`,
      [
        `*Questions:* ${answers.length}`,
        `*Drafted:* ${answers.length - needsHuman}`,
        `*Needs Human:* ${needsHuman}`,
        overLimit > 0 ? `*Over Limit:* ${overLimit} (review needed)` : "",
        "",
        ...answers.slice(0, 5).map(
          (a) =>
            `> *${a.questionId}:* ${a.questionText.substring(0, 60)}... — _${a.confidence}_ (${a.wordCount}w)`,
        ),
        answers.length > 5 ? `> _...and ${answers.length - 5} more_` : "",
        "",
        "Next: Review answers, then `/opp approve " + applicationId + "`",
      ].filter(Boolean),
    );
  }

  private async handleRevise(
    args: string[],
    actor: string,
  ): Promise<string> {
    const applicationId = args[0];
    if (!applicationId || args.length < 2) {
      return 'Usage: `/opp revise <id> "instructions"` or `/opp revise <id> <question-id> "instructions"`';
    }

    // Check if second arg is a question ID (q_1, q_2, etc.) or instructions
    let questionId: string | undefined;
    let instructions: string;

    if (/^q_\d+$/.test(args[1])) {
      questionId = args[1];
      instructions = args.slice(2).join(" ");
    } else {
      instructions = args.slice(1).join(" ");
    }

    // Remove surrounding quotes
    instructions = instructions.replace(/^["']|["']$/g, "");

    const req: OppReviseRequest = {
      applicationId,
      questionId,
      instructions,
    };
    const revised = await this.answerGenerator.reviseAnswer(req);

    const targetCount = questionId ? 1 : revised.length;
    return this.formatBlock(
      `Revised: ${applicationId}`,
      [
        `*Revised:* ${targetCount} answer(s)`,
        `*Instructions:* "${instructions}"`,
        "",
        "Review the updated answers, then `/opp approve " + applicationId + "`",
      ],
    );
  }

  private async handleApprove(
    applicationId: string,
    actor: string,
  ): Promise<string> {
    if (!applicationId) return "Usage: `/opp approve <application-id>`";

    const result = await this.review.approve(applicationId, actor);

    return this.formatBlock(
      `Approved: ${applicationId}`,
      [
        `*Answers Approved:* ${result.answersApproved}`,
        `*Approved By:* ${actor}`,
        "",
        "Answer pack is now locked.",
        "Next: `/opp prefill " + applicationId + "` to auto-fill the form,",
        "or manually copy-paste from the answer pack.",
      ],
    );
  }

  private async handlePrefill(applicationId: string): Promise<string> {
    if (!applicationId) return "Usage: `/opp prefill <application-id>`";

    const result: PrefillResult =
      await this.prefill.prefill(applicationId);

    return this.formatBlock(
      `Prefill: ${applicationId}`,
      [
        `*Fields Filled:* ${result.fieldsFilled}`,
        `*Fields Skipped:* ${result.fieldsSkipped}`,
        ...(result.skippedReasons.length > 0
          ? ["*Skipped Reasons:*", ...result.skippedReasons.map((r) => `> ${r}`)]
          : []),
        result.screenshotPath
          ? `*Screenshot:* ${result.screenshotPath}`
          : "",
        "",
        "IMPORTANT: Review the form before submitting.",
        "The bot does NOT click Submit. You must submit manually.",
        "",
        "After submission: `/opp submit " + applicationId + "`",
      ].filter(Boolean),
    );
  }

  private async handleSubmit(
    applicationId: string,
    actor: string,
  ): Promise<string> {
    if (!applicationId) return "Usage: `/opp submit <application-id>`";

    await this.review.markSubmitted(applicationId, actor);

    return this.formatBlock(
      `Submitted: ${applicationId}`,
      [
        `Marked as submitted by ${actor}.`,
        "Answers archived for future reuse.",
      ],
    );
  }

  private async handleStatus(applicationId: string): Promise<string> {
    if (!applicationId) return "Usage: `/opp status <application-id>`";

    const status: OppStatusResponse =
      await this.review.getStatus(applicationId);

    return this.formatBlock(
      `Status: ${status.programName}`,
      [
        `*ID:* \`${status.applicationId}\``,
        `*Status:* ${status.status}`,
        `*Deadline:* ${status.deadline ?? "Unknown"}`,
        `*Owner:* ${status.owner}`,
        `*Questions:* ${status.questionsTotal} total, ${status.questionsDrafted} drafted, ${status.questionsApproved} approved`,
        "",
        "*Timeline:*",
        ...status.timeline.slice(-5).map(
          (e) =>
            `> ${e.timestamp.substring(0, 16)} — ${e.action} (${e.actor})${e.details ? ": " + e.details : ""}`,
        ),
      ],
    );
  }

  private async handleList(statusFilter?: string): Promise<string> {
    const apps = await this.review.list(statusFilter);

    if (apps.length === 0) {
      return statusFilter
        ? `No applications with status "${statusFilter}".`
        : "No applications found.";
    }

    return this.formatBlock(
      `Applications${statusFilter ? ` (${statusFilter})` : ""}`,
      apps.map(
        (a) =>
          `\`${a.applicationId}\` — ${a.programName} [${a.status}] ${a.deadline ? "deadline: " + a.deadline.toISOString().substring(0, 10) : ""}`,
      ),
    );
  }

  // ─── Formatting ─────────────────────────────────────────────────────────

  private formatBlock(title: string, lines: string[]): string {
    return `*${title}*\n${lines.join("\n")}`;
  }

  private formatHelp(): string {
    return this.formatBlock("Opportunity Application Assistant", [
      "Available commands:",
      "`/opp add <url> [notes]` — Ingest a new opportunity",
      "`/opp triage <id>` — Assess fit, effort, deadline",
      "`/opp draft <id>` — Extract questions + generate answers",
      "`/opp revise <id> [q_id] \"instructions\"` — Revise answer(s)",
      "`/opp approve <id>` — Lock answer pack",
      "`/opp prefill <id>` — Auto-fill form (if Playwright available)",
      "`/opp submit <id>` — Mark as submitted",
      "`/opp status <id>` — View status + timeline",
      "`/opp list [status]` — List all applications",
    ]);
  }

  /**
   * Post a message to the configured Slack webhook.
   */
  async postToSlack(message: string): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn("No Slack webhook configured — skipping post");
      return;
    }

    try {
      await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: message,
          unfurl_links: false,
        }),
      });
    } catch (error) {
      const msg = (error as Error)?.message ?? "Unknown error";
      this.logger.error(`Failed to post to Slack: ${msg}`);
    }
  }
}
