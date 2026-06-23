import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { WhatsAppService } from "./whatsapp.service";
import { MetaWebhookBody } from "./whatsapp.types";

@Controller("whatsapp")
export class WhatsAppController {
  constructor(private readonly svc: WhatsAppService) {}

  /** Meta verification handshake (FR-WA-004). Returns the challenge as plain text. */
  @Get("webhook")
  verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ): string {
    return this.svc.verifyHandshake(mode, token, challenge);
  }

  /**
   * Inbound messages (FR-WA-005/006). Verify the signature, then ACK 200
   * immediately and process asynchronously — the reply is sent out-of-band
   * via the Graph API, never in this HTTP response.
   */
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string,
    @Body() body: MetaWebhookBody,
  ): { received: number } {
    if (!this.svc.verifySignature(req.rawBody, signature)) {
      throw new ForbiddenException("Invalid webhook signature");
    }
    const messages = this.svc.parseInbound(body);
    // Fire-and-forget: do not await — the ACK must return inside Meta's timeout.
    void this.svc.processInbound(messages).catch(() => undefined);
    return { received: messages.length };
  }
}
