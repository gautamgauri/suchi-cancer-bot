import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { WhatsAppNavigatorFlowService } from "./whatsapp-navigator-flow.service";
import { NavigatorMessage, NavigatorSession } from "./whatsapp-navigator.types";

interface WebhookRequestDto {
  phone: string;
  message: string;
  sessionId?: string;
}

interface WebhookResponseDto {
  sessionId: string;
  response: NavigatorMessage;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

// NOTE: the app sets a global `v1` prefix (main.ts), so this must NOT repeat it —
// otherwise routes serve at /v1/v1/whatsapp-navigator and diverge from the
// documented path /v1/whatsapp-navigator/webhook.
@Controller("whatsapp-navigator")
export class WhatsAppNavigatorController {
  private readonly logger = new Logger(WhatsAppNavigatorController.name);

  // In-memory session store keyed by phone number
  private readonly sessions = new Map<string, NavigatorSession>();

  constructor(private readonly flowService: WhatsAppNavigatorFlowService) {
    // Run session cleanup every 5 minutes
    setInterval(() => this.evictExpiredSessions(), 5 * 60 * 1000);
  }

  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: WebhookRequestDto
  ): Promise<WebhookResponseDto> {
    const { phone, message } = body;

    if (!phone || !message) {
      return {
        sessionId: "",
        response: {
          text: "Missing phone or message. / phone या message आवश्यक है।",
        },
      };
    }

    // Retrieve or create session
    let session = this.getActiveSession(phone);

    if (!session) {
      session = this.createSession(phone);
      this.logger.log(`New navigator session for ${phone} — id: ${session.sessionId}`);
    }

    // Check if user wants to restart ("hi", "hello", "नमस्ते", "0", "start")
    const normalised = message.trim().toLowerCase();
    if (["hi", "hello", "नमस्ते", "0", "start", "restart"].includes(normalised)) {
      session = this.createSession(phone);
      this.logger.log(`Session restarted for ${phone}`);
    }

    const { response, updatedSession } = this.flowService.processMessage(
      session,
      message
    );

    this.sessions.set(phone, updatedSession);

    return { sessionId: updatedSession.sessionId, response };
  }

  // ---------------------------------------------------------------------------
  // Session helpers
  // ---------------------------------------------------------------------------

  private getActiveSession(phone: string): NavigatorSession | null {
    const session = this.sessions.get(phone);
    if (!session) return null;

    const age = Date.now() - session.updatedAt.getTime();
    if (age > SESSION_TTL_MS) {
      this.sessions.delete(phone);
      this.logger.log(`Session expired for ${phone}`);
      return null;
    }

    return session;
  }

  private createSession(phone: string): NavigatorSession {
    const session: NavigatorSession = {
      sessionId: uuidv4(),
      phone,
      step: "start",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(phone, session);
    return session;
  }

  private evictExpiredSessions(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [phone, session] of this.sessions.entries()) {
      if (now - session.updatedAt.getTime() > SESSION_TTL_MS) {
        this.sessions.delete(phone);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.log(`Evicted ${evicted} expired navigator sessions`);
    }
  }
}
