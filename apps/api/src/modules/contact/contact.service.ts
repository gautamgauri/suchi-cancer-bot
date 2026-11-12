import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EmailService } from "../email/email.service";
import { ContactDto, SINGLE_LINE } from "./contact.dto";
import { ContactRateLimiter } from "./contact-rate-limiter";

/** Below this, a "person" filled in name, email and a message too fast to be real. */
export const CONTACT_MIN_ELAPSED_MS = 3000;

/** Loose shape check for recipient config; the SMTP server is the final judge. */
const EMAIL_SHAPE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export interface ContactRecipients {
  to: string;
  cc: string[];
}

/**
 * Recipients come ONLY from server env (CONTACT_FORM_TO, CONTACT_FORM_CC),
 * never from the request. CC accepts commas, semicolons or whitespace as
 * separators. Any malformed address makes the whole config invalid (null), so
 * the endpoint fails closed rather than mailing a partial list.
 */
export function readContactRecipients(env: NodeJS.ProcessEnv = process.env): ContactRecipients | null {
  const to = (env.CONTACT_FORM_TO ?? "").trim();
  if (!to || !EMAIL_SHAPE.test(to)) return null;
  const cc = (env.CONTACT_FORM_CC ?? "")
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  if (cc.some((a) => !EMAIL_SHAPE.test(a))) return null;
  return { to, cc: cc.filter((a) => a.toLowerCase() !== to.toLowerCase()) };
}

export interface ContactRequestContext {
  /** Non-identifying id: appears in the email and in the outcome log line, nothing else. */
  requestId: string;
}

export interface ContactResult {
  ok: true;
  requestId: string;
}

function fail(status: HttpStatus, code: string, message: string): never {
  throw new HttpException({ statusCode: status, code, message }, status);
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly email: EmailService,
    private readonly limiter: ContactRateLimiter,
  ) {}

  static newRequestId(): string {
    return randomUUID().slice(0, 8);
  }

  /**
   * Runs after ContactRequestGuard (origin, size, per-IP limit) and DTO
   * validation. Checks the honeypot, time on page and global send budget, then
   * sends ONE email (To + Cc from env, Reply-To the visitor). Nothing is
   * stored. Logs carry only an outcome and the request id: never the name,
   * email address or message.
   */
  async submit(dto: ContactDto, ctx: ContactRequestContext): Promise<ContactResult> {
    const outcome = (result: string) => this.logger.log(`contact form: outcome=${result} request=${ctx.requestId}`);

    const recipients = readContactRecipients();
    if (!recipients || !this.email.isConfigured()) {
      outcome("not_configured");
      fail(HttpStatus.SERVICE_UNAVAILABLE, "CONTACT_FORM_NOT_CONFIGURED", "The contact form is not available right now.");
    }

    if ((dto.website ?? "").trim() !== "") {
      outcome("rejected_honeypot");
      fail(HttpStatus.BAD_REQUEST, "CONTACT_REJECTED", "The message could not be accepted.");
    }
    if (dto.elapsedMs < CONTACT_MIN_ELAPSED_MS) {
      outcome("rejected_too_fast");
      fail(HttpStatus.BAD_REQUEST, "CONTACT_TOO_FAST", "Please wait a moment and send again.");
    }

    // Defence in depth: the DTO already enforces this when the ValidationPipe runs.
    const name = dto.name.trim();
    const replyTo = dto.email.trim();
    const message = dto.message.trim();
    if (!name || !message || !SINGLE_LINE.test(name) || !SINGLE_LINE.test(replyTo) || !EMAIL_SHAPE.test(replyTo)) {
      outcome("rejected_invalid");
      fail(HttpStatus.BAD_REQUEST, "CONTACT_INVALID", "Please check the form and try again.");
    }

    if (!this.limiter.tryReserveSend()) {
      outcome("rate_limited_global");
      fail(HttpStatus.TOO_MANY_REQUESTS, "CONTACT_RATE_LIMITED", "Too many messages right now. Please try again later.");
    }

    const sent = await this.email.sendEmail({
      to: recipients.to,
      cc: recipients.cc.length ? recipients.cc.join(", ") : undefined,
      replyTo,
      subject: `Website contact form message [${ctx.requestId}]`,
      text: [
        "A message was sent through the contact form on suchitracancercare.org.",
        "Reply to this email to answer the sender directly.",
        "",
        `Name: ${name}`,
        `Email: ${replyTo}`,
        "",
        "Message:",
        message,
        "",
        "--",
        `Reference: ${ctx.requestId}. The website does not keep a copy of this message.`,
      ].join("\n"),
    });

    if (!sent) {
      outcome("send_failed");
      fail(HttpStatus.BAD_GATEWAY, "CONTACT_SEND_FAILED", "The message could not be sent. Please email us instead.");
    }

    outcome("sent");
    return { ok: true, requestId: ctx.requestId };
  }
}
