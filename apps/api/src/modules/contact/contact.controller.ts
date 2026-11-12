import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { ContactDto } from "./contact.dto";
import { contactClientIp, isContactOriginAllowed } from "./contact-request";
import { ContactRateLimiter } from "./contact-rate-limiter";
import { ContactResult, ContactService } from "./contact.service";

/** Generous for 5000 characters of Devanagari (3 bytes each in UTF-8) plus JSON. */
export const CONTACT_MAX_BODY_BYTES = 24 * 1024;

/**
 * Runs before validation (guards precede pipes), so every attempt is checked
 * and counted before any field is looked at: origin allow-list, body cap,
 * per-IP rate limit. The app-wide JSON parser already refuses bodies over
 * 100 kB; CONTACT_MAX_BODY_BYTES is the tighter, route-level cap.
 */
@Injectable()
export class ContactRequestGuard implements CanActivate {
  private readonly logger = new Logger(ContactRequestGuard.name);

  constructor(private readonly limiter: ContactRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (!isContactOriginAllowed(typeof origin === "string" ? origin : undefined)) {
      throw new HttpException(
        { statusCode: HttpStatus.FORBIDDEN, code: "CONTACT_ORIGIN_NOT_ALLOWED", message: "Origin not allowed." },
        HttpStatus.FORBIDDEN,
      );
    }
    const declared = Number(req.headers["content-length"]);
    const size = Number.isFinite(declared) ? declared : Buffer.byteLength(JSON.stringify(req.body ?? {}));
    if (size > CONTACT_MAX_BODY_BYTES) {
      throw new HttpException(
        { statusCode: HttpStatus.PAYLOAD_TOO_LARGE, code: "CONTACT_TOO_LARGE", message: "The message is too long." },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (!this.limiter.tryAttempt(contactClientIp(req))) {
      this.logger.log("contact form: outcome=rate_limited_ip");
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: "CONTACT_RATE_LIMITED",
          message: "Too many messages from this connection. Please try again later.",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * Public contact form for suchitracancercare.org (no auth). Abuse controls, in
 * order: origin allow-list, body cap and per-IP rate limit (guard), DTO
 * validation (global ValidationPipe), then in the service the honeypot,
 * minimum time on page and a global send budget.
 */
@Controller("contact")
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ContactRequestGuard)
  async submit(@Body() dto: ContactDto): Promise<ContactResult> {
    return this.contact.submit(dto, { requestId: ContactService.newRequestId() });
  }
}
