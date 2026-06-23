import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ChatService } from "../chat/chat.service";
import { SessionsService } from "../sessions/sessions.service";
import { detectLocale, formatForWhatsApp } from "./whatsapp-format";
import { InboundMessage, MetaMessage, MetaWebhookBody } from "./whatsapp.types";

const SEEN_CACHE_CAP = 1000;
const FALLBACK_REPLY =
  "Sorry, something went wrong on our side. Please try sending your message again.";

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  // In-memory de-dup of recently handled message ids (FR-WA-007). Meta retries
  // a webhook until it gets a 200; retries usually hit the same instance.
  private readonly seenWamids = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly sessions: SessionsService,
  ) {}

  /** True only when every Meta credential is present — otherwise the channel fails safe. */
  isConfigured(): boolean {
    return !!(
      process.env.META_WABA_PHONE_NUMBER_ID &&
      process.env.META_WABA_TOKEN &&
      process.env.META_APP_SECRET &&
      process.env.WHATSAPP_VERIFY_TOKEN
    );
  }

  // ---------------------------------------------------------------------------
  // Webhook verification
  // ---------------------------------------------------------------------------

  /** GET handshake (FR-WA-004): echo hub.challenge when the verify token matches. */
  verifyHandshake(mode?: string, token?: string, challenge?: string): string {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === "subscribe" && expected && token === expected) {
      return challenge ?? "";
    }
    throw new ForbiddenException("WhatsApp webhook verification failed");
  }

  /** POST signature check (FR-WA-005): HMAC-SHA256 of the raw body with META_APP_SECRET. */
  verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret || !rawBody || !signatureHeader) return false; // fail closed
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---------------------------------------------------------------------------
  // Inbound parsing
  // ---------------------------------------------------------------------------

  parseInbound(body: MetaWebhookBody): InboundMessage[] {
    const out: InboundMessage[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue; // statuses-only events ignored

        const nameByWaId = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
        }

        for (const m of value.messages) {
          const text = extractText(m);
          if (!m.id || !m.from || !text) continue; // unsupported types (image/audio/...) skipped in v1
          out.push({ wamid: m.id, from: m.from, text, profileName: nameByWaId.get(m.from) });
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Processing (async — never blocks the webhook ACK, FR-WA-006)
  // ---------------------------------------------------------------------------

  async processInbound(messages: InboundMessage[]): Promise<void> {
    for (const msg of messages) {
      if (this.alreadySeen(msg.wamid)) {
        this.logger.debug(`Duplicate WhatsApp message ${msg.wamid} ignored`);
        continue;
      }
      this.markSeen(msg.wamid);

      try {
        const locale = detectLocale(msg.text);
        let sessionId = await this.resolveSession(msg.from, locale);
        let result;
        try {
          result = await this.chat.handle({ sessionId, channel: "whatsapp", locale, userText: msg.text } as any);
        } catch (err: any) {
          // Self-heal a stale/deleted session (the stored sessionId no longer
          // exists in the DB) — mint a fresh session and retry ONCE. Without
          // this the contact is wedged on the fallback reply until the TTL.
          if (isInvalidSessionError(err)) {
            this.logger.warn(`Stale session ${sessionId} for WhatsApp contact — re-minting and retrying`);
            sessionId = await this.resolveSession(msg.from, locale, true);
            result = await this.chat.handle({ sessionId, channel: "whatsapp", locale, userText: msg.text } as any);
          } else {
            throw err;
          }
        }
        await this.sendText(msg.from, result.responseText);
      } catch (err: any) {
        this.logger.error(`Failed to process WhatsApp message ${msg.wamid}: ${err?.message}`, err?.stack);
        await this.sendText(msg.from, FALLBACK_REPLY).catch(() => undefined);
      }
    }
  }

  /**
   * Reuse the active session for a contact, or mint a fresh one past the
   * inactivity window (FR-WA-009). Pass `forceNew` to always mint — used to
   * self-heal when the stored session has been deleted from the DB.
   */
  async resolveSession(waId: string, locale: string, forceNew = false): Promise<string> {
    const ttlMs = (Number(process.env.WHATSAPP_SESSION_TTL_HOURS) || 24) * 3_600_000;
    const now = new Date();

    if (!forceNew) {
      const existing = await this.prisma.whatsAppContact.findUnique({ where: { waId } });
      if (existing && now.getTime() - existing.lastActiveAt.getTime() < ttlMs) {
        await this.prisma.whatsAppContact.update({
          where: { waId },
          data: { lastActiveAt: now, locale },
        });
        return existing.sessionId;
      }
    }

    const session = await this.sessions.create({ channel: "whatsapp", locale });
    await this.prisma.whatsAppContact.upsert({
      where: { waId },
      create: { waId, sessionId: session.id, locale, lastActiveAt: now },
      update: { sessionId: session.id, locale, lastActiveAt: now },
    });
    return session.id;
  }

  // ---------------------------------------------------------------------------
  // Outbound (FR-WA-010)
  // ---------------------------------------------------------------------------

  async sendText(to: string, text: string): Promise<void> {
    const phoneNumberId = process.env.META_WABA_PHONE_NUMBER_ID;
    const token = process.env.META_WABA_TOKEN;
    if (!phoneNumberId || !token) {
      this.logger.warn("WhatsApp outbound skipped — META_WABA_PHONE_NUMBER_ID / META_WABA_TOKEN not configured");
      return;
    }
    const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

    for (const body of formatForWhatsApp(text)) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: true, body },
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        this.logger.error(`WhatsApp send failed (${res.status}): ${errText.slice(0, 200)}`);
        return; // stop sending further parts on failure
      }
    }
  }

  // ---------------------------------------------------------------------------
  // De-dup cache
  // ---------------------------------------------------------------------------

  private alreadySeen(wamid: string): boolean {
    return this.seenWamids.has(wamid);
  }

  private markSeen(wamid: string): void {
    this.seenWamids.add(wamid);
    this.seenOrder.push(wamid);
    if (this.seenOrder.length > SEEN_CACHE_CAP) {
      const evicted = this.seenOrder.shift();
      if (evicted) this.seenWamids.delete(evicted);
    }
  }
}

/**
 * True when ChatService rejected the inbound because the stored sessionId no
 * longer maps to a Session row (`throw new BadRequestException("Invalid
 * sessionId")` in chat.service). Drives the one-shot re-mint in processInbound.
 */
function isInvalidSessionError(err: any): boolean {
  return /invalid\s*sessionid/i.test(err?.message ?? "");
}

/** Pull plain text out of a message, supporting text + interactive replies (button/list). */
function extractText(m: MetaMessage): string | null {
  if (m.type === "text") return m.text?.body?.trim() || null;
  if (m.type === "interactive") {
    return (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title)?.trim() || null;
  }
  if (m.type === "button") return m.button?.text?.trim() || null;
  return null;
}
