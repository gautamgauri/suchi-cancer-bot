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
  ServiceUnavailableException,
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
   * Inbound messages (FR-WA-005/006/007). Verify the signature, durably record
   * every message, then ACK 200 and run the pipeline asynchronously — the reply
   * is sent out-of-band via the Graph API, never in this HTTP response.
   *
   * The durable claim is awaited on purpose: acking before the message is on
   * disk means an instance that restarts mid-pipeline loses a patient message
   * for good, because Meta does not retry an event it has already been 200'd
   * for. Claiming is a single indexed INSERT, well inside Meta's timeout.
   */
  @Post("webhook")
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string,
    @Body() body: MetaWebhookBody,
  ): Promise<{ received: number; accepted: number }> {
    if (!this.svc.verifySignature(req.rawBody, signature)) {
      throw new ForbiddenException("Invalid webhook signature");
    }
    const messages = this.svc.parseInbound(body);
    const { claimed, failure } = await this.svc.claimInbound(messages);

    // Fire-and-forget: do not await — the ACK must return inside Meta's timeout.
    // Only claimed messages are processed, so a retry cannot double-reply.
    void this.svc.processClaimed(claimed).catch(() => undefined);

    if (failure) {
      // Do NOT ack: a 5xx makes Meta redeliver the batch. Messages already
      // claimed above are being processed and will de-dup out of the retry.
      throw new ServiceUnavailableException("Could not record inbound message");
    }
    return { received: messages.length, accepted: claimed.length };
  }
}
