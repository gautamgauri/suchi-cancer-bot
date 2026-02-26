import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { ApplicationIntakeService } from "./application-intake.service";
import { QuestionExtractorService } from "./question-extractor.service";
import { AnswerGeneratorService } from "./answer-generator.service";
import { ApplicationReviewService } from "./application-review.service";
import { BrowserPrefillService } from "./browser-prefill.service";
import { ApplicationSlackService } from "./application-slack.service";
import { SlackSignatureGuard } from "./slack-signature.guard";
import {
  IngestApplicationDto,
  ReviseAnswerDto,
  ApproveApplicationDto,
  SubmitApplicationDto,
  SlackCommandDto,
  ListApplicationsQueryDto,
} from "./application.dto";

/**
 * REST API for the Opportunity Application Assistant.
 *
 * All endpoints prefixed with /v1/applications (via global prefix).
 * Parallel Slack interface is handled by ApplicationSlackService.
 */
@Controller("applications")
export class ApplicationController {
  constructor(
    private readonly intake: ApplicationIntakeService,
    private readonly questionExtractor: QuestionExtractorService,
    private readonly answerGenerator: AnswerGeneratorService,
    private readonly review: ApplicationReviewService,
    private readonly prefill: BrowserPrefillService,
    private readonly slack: ApplicationSlackService,
  ) {}

  // ─── Static routes first (before parameterized :id routes) ──────────

  /**
   * GET /v1/applications
   * List all applications with optional status filter.
   */
  @Get()
  async list(@Query() query: ListApplicationsQueryDto) {
    return this.review.list(query.status);
  }

  /**
   * GET /v1/applications/profile
   * Get the current applicant profile.
   */
  @Get("profile")
  getProfile() {
    return this.answerGenerator.getProfile();
  }

  /**
   * POST /v1/applications/ingest
   * Ingest a new opportunity from a URL.
   */
  @Post("ingest")
  @HttpCode(HttpStatus.CREATED)
  async ingest(@Body() body: IngestApplicationDto) {
    return this.intake.ingest(body);
  }

  /**
   * POST /v1/applications/slack
   * Handle incoming Slack commands.
   * Protected by Slack signature verification.
   */
  @Post("slack")
  @HttpCode(HttpStatus.OK)
  @UseGuards(SlackSignatureGuard)
  async handleSlackCommand(@Body() body: SlackCommandDto) {
    const text = body.text?.trim() ?? "";
    const parts = text.split(/\s+/);
    const command = parts[0] ?? "help";
    const args = parts.slice(1);
    const actor = body.user_name ?? "gautam";

    const response = await this.slack.handleCommand(command, args, actor);

    // Slack expects a JSON response with response_type
    return {
      response_type: "in_channel",
      text: response,
    };
  }

  // ─── Parameterized :id routes ───────────────────────────────────────

  /**
   * GET /v1/applications/:id/status
   * Get full status of an application.
   */
  @Get(":id/status")
  async getStatus(@Param("id") applicationId: string) {
    return this.review.getStatus(applicationId);
  }

  /**
   * POST /v1/applications/:id/triage
   * Run triage on an application.
   */
  @Post(":id/triage")
  async triage(@Param("id") applicationId: string) {
    return this.intake.triage(applicationId);
  }

  /**
   * POST /v1/applications/:id/extract-questions
   * Extract questions from the application page.
   */
  @Post(":id/extract-questions")
  async extractQuestions(@Param("id") applicationId: string) {
    return this.questionExtractor.extractQuestions(applicationId);
  }

  /**
   * POST /v1/applications/:id/draft
   * Generate draft answers for all questions.
   */
  @Post(":id/draft")
  async draft(@Param("id") applicationId: string) {
    return this.answerGenerator.generateAnswers(applicationId);
  }

  /**
   * POST /v1/applications/:id/revise
   * Revise answers with specific instructions.
   */
  @Post(":id/revise")
  async revise(
    @Param("id") applicationId: string,
    @Body() body: ReviseAnswerDto,
  ) {
    return this.answerGenerator.reviseAnswer({
      applicationId,
      ...body,
    });
  }

  /**
   * POST /v1/applications/:id/approve
   * Approve the answer pack.
   */
  @Post(":id/approve")
  async approve(
    @Param("id") applicationId: string,
    @Body() body: ApproveApplicationDto,
  ) {
    return this.review.approve(applicationId, body.actor);
  }

  /**
   * POST /v1/applications/:id/prefill
   * Run browser prefill.
   */
  @Post(":id/prefill")
  async prefillForm(@Param("id") applicationId: string) {
    return this.prefill.prefill(applicationId);
  }

  /**
   * POST /v1/applications/:id/submit
   * Mark as submitted.
   */
  @Post(":id/submit")
  async submit(
    @Param("id") applicationId: string,
    @Body() body: SubmitApplicationDto,
  ) {
    await this.review.markSubmitted(applicationId, body.actor);
    return { applicationId, status: "submitted" };
  }
}
