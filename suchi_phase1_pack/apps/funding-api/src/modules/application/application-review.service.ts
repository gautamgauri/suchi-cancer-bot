import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AnswerGeneratorService } from "./answer-generator.service";
import {
  ApplicationDocument,
  DraftedAnswer,
  OppStatusResponse,
  pushTimelineEvent,
} from "./application.types";

@Injectable()
export class ApplicationReviewService {
  private readonly logger = new Logger(ApplicationReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly answerGenerator: AnswerGeneratorService,
  ) {}

  /**
   * Approve all answers for an application, locking the answer pack
   * for prefill or manual submission.
   */
  async approve(
    applicationId: string,
    actor: string = "gautam",
  ): Promise<{ applicationId: string; answersApproved: number }> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    const answers = jsonBlob.answers as DraftedAnswer[];
    if (!answers || answers.length === 0) {
      throw new BadRequestException(
        `No answers to approve for ${applicationId}. Run draft first.`,
      );
    }

    // Check for any answers that still need human input
    const needsHuman = answers.filter((a) => a.confidence === "needs_human");
    if (needsHuman.length > 0) {
      this.logger.warn(
        `${needsHuman.length} answers still need human input for ${applicationId}`,
      );
    }

    // Update status
    jsonBlob.status = "approved";
    pushTimelineEvent(jsonBlob,{
      timestamp: new Date().toISOString(),
      action: "approve",
      actor,
      details: `Approved ${answers.length} answers (${needsHuman.length} flagged as needs_human)`,
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "approved",
        jsonBlob: jsonBlob as Prisma.InputJsonValue,
      },
    });

    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: app.id,
        action: "approve",
        status: "success",
        actor,
        details: {
          answersApproved: answers.length,
          needsHuman: needsHuman.length,
        } as Prisma.InputJsonValue,
      },
    });

    // Archive approved answers for future reuse
    await this.answerGenerator.archiveApprovedAnswers(applicationId);

    this.logger.log(
      `Approved ${answers.length} answers for ${applicationId}`,
    );
    return { applicationId, answersApproved: answers.length };
  }

  /**
   * Mark an application as submitted.
   */
  async markSubmitted(
    applicationId: string,
    actor: string = "gautam",
  ): Promise<void> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    jsonBlob.status = "submitted";
    pushTimelineEvent(jsonBlob,{
      timestamp: new Date().toISOString(),
      action: "submit",
      actor,
      details: "Marked as submitted",
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "submitted",
        jsonBlob: jsonBlob as Prisma.InputJsonValue,
      },
    });

    await this.prisma.applicationAuditEvent.create({
      data: {
        applicationId: app.id,
        action: "submit",
        status: "success",
        actor,
      },
    });

    this.logger.log(`Marked ${applicationId} as submitted`);
  }

  /**
   * Archive an application (post-decision).
   */
  async archive(applicationId: string): Promise<void> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    jsonBlob.status = "archived";
    pushTimelineEvent(jsonBlob,{
      timestamp: new Date().toISOString(),
      action: "archive",
      actor: "system",
    });
    jsonBlob.updatedAt = new Date().toISOString();

    await this.prisma.personalApplication.update({
      where: { applicationId },
      data: {
        status: "archived",
        jsonBlob: jsonBlob as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Get full status of an application including timeline.
   */
  async getStatus(applicationId: string): Promise<OppStatusResponse> {
    const app = await this.prisma.personalApplication.findUnique({
      where: { applicationId },
    });
    if (!app) throw new NotFoundException(`Application not found: ${applicationId}`);

    const jsonBlob = app.jsonBlob as Record<string, unknown>;
    const doc = jsonBlob as unknown as ApplicationDocument;

    const questionsTotal = doc.questions?.length ?? 0;
    const questionsDrafted = doc.answers?.filter(
      (a) => a.answerText && a.confidence !== "needs_human",
    ).length ?? 0;
    const questionsApproved =
      doc.status === "approved" || doc.status === "submitted"
        ? questionsTotal
        : 0;

    return {
      applicationId,
      status: doc.status,
      programName: doc.programName,
      deadline: doc.deadline,
      owner: doc.owner,
      questionsTotal,
      questionsDrafted,
      questionsApproved,
      timeline: doc.timeline ?? [],
    };
  }

  /**
   * List all applications with optional status filter.
   */
  async list(
    statusFilter?: string,
  ): Promise<
    Array<{
      applicationId: string;
      programName: string;
      status: string;
      deadline: Date | null;
      owner: string;
    }>
  > {
    const where = statusFilter ? { status: statusFilter } : {};
    const apps = await this.prisma.personalApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        applicationId: true,
        programName: true,
        status: true,
        deadline: true,
        owner: true,
      },
    });
    return apps;
  }
}
