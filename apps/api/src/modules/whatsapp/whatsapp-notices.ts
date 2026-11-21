// Fixed notices the WhatsApp channel sends without running the chat pipeline.
//
// Two cases reach here:
//   - a message with no readable text (voice note, image, document, ...), which
//     used to be dropped silently and left the sender without any reply
//   - a message Meta delivered long after it was sent, typically a redelivery
//     of the queue after an outage, which must not be answered as if fresh
//
// A stale text message that the emergency fast path or the safety rules flag
// never gets the stale notice. It runs the full pipeline (see
// WhatsAppService.replyWithNotice). The stale notice names no cause, because
// a late timestamp does not prove the service was down.
//
// The strings are fixed and carry no medical content. They are never produced
// by the LLM. Any change to them needs the owner's approval.

import { InboundMessage } from "./whatsapp.types";

export type NoticeKind = "unsupported_type" | "stale";

/** Sent when a message has no text the bot can read. Hindi first, then English. */
export const UNSUPPORTED_TYPE_NOTICE =
  "फ़िलहाल सुचि पर केवल टाइप किए हुए संदेश पढ़े जा सकते हैं। कृपया अपना सवाल टाइप करके भेजें।\n\n" +
  "Suchi can only read typed messages for now. Please type your question and send it.";

/** Sent when a message arrives too long after it was written to answer as fresh. */
export const STALE_MESSAGE_NOTICE =
  "क्षमा करें, आपके संदेश का उत्तर नहीं दिया जा सका। कृपया अपना सवाल दोबारा भेजें।\n\n" +
  "Sorry, your message was not answered. Please send your question again.";

export const NOTICE_TEXT: Record<NoticeKind, string> = {
  unsupported_type: UNSUPPORTED_TYPE_NOTICE,
  stale: STALE_MESSAGE_NOTICE,
};

/**
 * Message types that get the "typed messages only" notice. A voice note arrives
 * as "audio". Reactions, stickers and system events are left out on purpose:
 * they are not questions, and a reply to each one would read as noise.
 */
export const NOTICE_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  "audio",
  "image",
  "video",
  "document",
  "location",
  "contacts",
]);

/** One notice of each kind per contact inside this window. */
export const NOTICE_COOLDOWN_MS = 6 * 3_600_000;

export const DEFAULT_STALE_MESSAGE_MINUTES = 30;

/**
 * Age beyond which an inbound message is not run through the pipeline, from
 * WHATSAPP_STALE_MESSAGE_MINUTES. 0 switches the guard off. A missing, negative
 * or non-numeric value falls back to the default.
 */
export function staleThresholdMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WHATSAPP_STALE_MESSAGE_MINUTES;
  const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  const minutes = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STALE_MESSAGE_MINUTES;
  return minutes * 60_000;
}

/** Meta sends `timestamp` as epoch seconds in a string. Anything else is treated as unknown. */
export function parseSentAt(timestamp: string | undefined): number | undefined {
  if (!timestamp) return undefined;
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Which fixed notice, if any, replaces the pipeline for this message.
 *
 * A message without readable text gets the typed-messages notice whatever its
 * age, because that answer stays true. A text message is stale only when its
 * send time is known and older than the threshold. An unknown send time runs
 * the pipeline as before.
 */
export function noticeKindFor(
  msg: InboundMessage,
  nowMs: number = Date.now(),
  thresholdMs: number = staleThresholdMs(),
): NoticeKind | null {
  if (msg.unsupportedType) return "unsupported_type";
  if (thresholdMs > 0 && msg.sentAt !== undefined && nowMs - msg.sentAt * 1000 > thresholdMs) {
    return "stale";
  }
  return null;
}

/**
 * Per-contact cooldown for the fixed notices, so a burst of photos or a
 * redelivered queue produces one reply.
 *
 * Held in memory on purpose. The contact id is a phone number, and the only
 * durable table this channel writes freely (the inbound ledger) must not hold
 * one. The cost is that the limit is per instance and is forgotten on restart,
 * so the worst case is one extra notice per instance.
 */
export class NoticeLimiter {
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number = NOTICE_COOLDOWN_MS,
    private readonly maxEntries: number = 5000,
  ) {}

  /** True, and the slot is taken, when this contact has not had this notice inside the window. */
  tryAcquire(waId: string, kind: NoticeKind, nowMs: number = Date.now()): boolean {
    const key = `${kind}:${waId}`;
    const last = this.lastSent.get(key);
    if (last !== undefined && nowMs - last < this.cooldownMs) return false;
    if (this.lastSent.size >= this.maxEntries) this.prune(nowMs);
    this.lastSent.set(key, nowMs);
    return true;
  }

  /** Give the slot back when the notice could not be sent, so the next message may try again. */
  release(waId: string, kind: NoticeKind): void {
    this.lastSent.delete(`${kind}:${waId}`);
  }

  private prune(nowMs: number): void {
    for (const [key, at] of this.lastSent) {
      if (nowMs - at >= this.cooldownMs) this.lastSent.delete(key);
    }
    // Still full of live entries: drop the oldest so the map stays bounded.
    if (this.lastSent.size >= this.maxEntries) {
      const oldest = this.lastSent.keys().next().value;
      if (oldest !== undefined) this.lastSent.delete(oldest);
    }
  }
}
