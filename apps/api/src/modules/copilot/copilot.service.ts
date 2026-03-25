import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvalBridgeService } from './services/eval-bridge.service';
import { FailureClassifierService } from './services/failure-classifier.service';
import { PatchPlannerService } from './services/patch-planner.service';
import { PatchExecutorService } from './services/patch-executor.service';
import type { ReviewSession, PatchPlan } from './copilot.types';
import { v4 as uuid } from 'uuid';

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  // In-memory store for review sessions (could be moved to DB later)
  private sessions = new Map<string, ReviewSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly evalBridge: EvalBridgeService,
    private readonly failureClassifier: FailureClassifierService,
    private readonly patchPlanner: PatchPlannerService,
    private readonly patchExecutor: PatchExecutorService,
  ) {}

  /** Create a review session from an existing chat message */
  async createSession(chatSessionId: string, messageId: string): Promise<ReviewSession> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { citations: true },
    });

    if (!message) throw new NotFoundException(`Message ${messageId} not found`);

    // Find the user message that preceded this bot response
    const messages = await this.prisma.message.findMany({
      where: { sessionId: chatSessionId },
      orderBy: { createdAt: 'asc' },
    });

    const msgIndex = messages.findIndex((m) => m.id === messageId);
    const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
    const query = userMsg?.role === 'user' ? userMsg.text : 'unknown query';

    const session: ReviewSession = {
      id: uuid(),
      chatSessionId,
      messageId,
      query,
      responseText: message.text,
      createdAt: new Date().toISOString(),
      status: 'created',
    };

    this.sessions.set(session.id, session);
    this.logger.log({ event: 'copilot_session_created', id: session.id, messageId });
    return session;
  }

  /** Diagnose quality issues in the response */
  async diagnose(sessionId: string): Promise<ReviewSession> {
    const session = this.getSession(sessionId);

    // Get citations for this message
    const citations = await this.prisma.messageCitation.findMany({
      where: { messageId: session.messageId },
    });

    // Evaluate response metrics
    session.metrics = this.evalBridge.evaluateResponse(
      session.query,
      session.responseText,
      citations,
    );

    // Classify failures
    session.findings = this.failureClassifier.classify(
      session.metrics,
      session.responseText,
      citations,
    );

    session.status = 'diagnosed';
    this.sessions.set(session.id, session);

    this.logger.log({
      event: 'copilot_diagnosed',
      id: session.id,
      overallScore: session.metrics.overallScore,
      findingsCount: session.findings.length,
    });

    return session;
  }

  /** Generate a repair plan from findings */
  plan(sessionId: string): ReviewSession {
    const session = this.getSession(sessionId);
    if (!session.findings) throw new Error('Session not diagnosed yet');

    session.patchPlan = this.patchPlanner.plan(session.id, session.findings);
    session.status = 'planned';
    this.sessions.set(session.id, session);

    this.logger.log({
      event: 'copilot_planned',
      id: session.id,
      actionsCount: session.patchPlan.actions.length,
    });

    return session;
  }

  /** Approve a patch plan */
  approve(sessionId: string, approvedBy?: string): ReviewSession {
    const session = this.getSession(sessionId);
    if (!session.patchPlan) throw new Error('No plan to approve');

    session.patchPlan.status = 'approved';
    session.patchPlan.approvedBy = approvedBy;
    session.patchPlan.approvedAt = new Date().toISOString();
    this.sessions.set(session.id, session);

    return session;
  }

  /** Reject a patch plan */
  reject(sessionId: string, reason?: string): ReviewSession {
    const session = this.getSession(sessionId);
    if (!session.patchPlan) throw new Error('No plan to reject');

    session.patchPlan.status = 'rejected';
    this.sessions.set(session.id, session);

    return session;
  }

  /** Execute the approved repair plan */
  async execute(sessionId: string): Promise<ReviewSession> {
    const session = this.getSession(sessionId);
    if (!session.patchPlan || session.patchPlan.status !== 'approved') {
      throw new Error('Plan must be approved before execution');
    }

    session.repairedResponse = await this.patchExecutor.execute(
      session.patchPlan,
      session.query,
      session.responseText,
    );

    session.patchPlan.status = 'executed';
    session.status = 'executed';
    this.sessions.set(session.id, session);

    this.logger.log({ event: 'copilot_executed', id: session.id });
    return session;
  }

  /** Compare original vs repaired response */
  async compare(sessionId: string): Promise<ReviewSession> {
    const session = this.getSession(sessionId);
    if (!session.repairedResponse) throw new Error('No repaired response to compare');

    const citations = await this.prisma.messageCitation.findMany({
      where: { messageId: session.messageId },
    });

    const originalMetrics = session.metrics!;
    const repairedMetrics = this.evalBridge.evaluateResponse(
      session.query,
      session.repairedResponse,
      citations,
    );

    session.comparisonDelta = repairedMetrics.overallScore - originalMetrics.overallScore;
    session.status = 'compared';
    this.sessions.set(session.id, session);

    this.logger.log({
      event: 'copilot_compared',
      id: session.id,
      delta: session.comparisonDelta,
      originalScore: originalMetrics.overallScore,
      repairedScore: repairedMetrics.overallScore,
    });

    return session;
  }

  /** Get a session by ID */
  getSession(id: string): ReviewSession {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException(`Review session ${id} not found`);
    return session;
  }
}
