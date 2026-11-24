import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ChatService } from "../chat/chat.service";
import { cleanResponseForDisplay } from "../chat/display-text-cleaner";
import {
  DeterministicSafetyReply,
  SAFETY_SESSION_LOOKUP_BOUND_MS,
  SafetyScreenDeps,
  buildSessionFreeSafetyReply,
  errorTag,
  flaggedByDeterministicSafetyChecks,
  withinBound,
} from "../chat/deterministic-safety";
import { SessionsService } from "../sessions/sessions.service";
import { SafetyService } from "../safety/safety.service";
import { AbstentionService } from "../abstention/abstention.service";
import { EmpathyDetector } from "../chat/empathy-detector";
import { detectLocale, formatForWhatsApp } from "./whatsapp-format";
import {
  CAPTION_MEDIA_TYPES,
  NOTICE_MESSAGE_TYPES,
  NOTICE_TEXT,
  NoticeLimiter,
  noticeKindFor,
  parseSentAt,
} from "./whatsapp-notices";
import { InboundMessage, MetaMessage, MetaWebhookBody } from "./whatsapp.types";

const FALLBACK_REPLY =
  "Sorry, something went wrong on our side. Please try sending your message again.";

/** Ledger row marker in `AnalyticsEvent.eventName` (see `claimInbound`). */
export const INBOUND_LEDGER_EVENT = "whatsapp_inbound";

/**
 * Deterministic primary key for a wamid's ledger row. Because it is the table's
 * PRIMARY KEY, the INSERT itself is the atomic cross-instance de-dup check
 * (FR-WA-007) — no read-then-write race between Cloud Run instances.
 */
export function inboundLedgerId(wamid: string): string {
  return `wa-inbound:${wamid}`;
}

/** Postgres/Prisma unique-constraint violation — i.e. "another instance already claimed this". */
function isUniqueViolation(err: any): boolean {
  return err?.code === "P2002" || err?.code === "23505";
}

/**
 * Raised when a reply could not be handed to the Graph API — missing outbound
 * credentials or a non-2xx send.
 *
 * This exists because `sendText` used to swallow both cases (a `warn`/`error`
 * log and an early `return`), so `processOne` went on to mark the inbound
 * ledger row `processed` for a turn that delivered nothing. A channel sending
 * zero replies was therefore indistinguishable from a healthy one in the only
 * durable record we keep — which is how the live number could answer nobody
 * for weeks without the ledger showing it (issue #231).
 *
 * `partsSent` is how many chunks made it out before the failure, so the caller
 * can tell "nothing was delivered" from "the patient got a truncated reply".
 *
 * The message never carries Meta's response body. It holds the HTTP status and
 * Meta's numeric error code only, because it is copied into the ledger.
 */
export class WhatsAppDeliveryError extends Error {
  constructor(
    message: string,
    readonly partsSent: number,
    readonly kind: "config" | "network" | "http" = "http",
    readonly httpStatus?: number,
    readonly metaErrorCode?: number,
  ) {
    super(message);
    this.name = "WhatsAppDeliveryError";
  }

  /**
   * A failure worth one more attempt: the connection broke, Meta throttled us
   * (429) or the Graph API had a server error (5xx). Missing credentials, 401
   * and 403 will not heal in a second, so they are never retried.
   */
  get retryable(): boolean {
    if (this.kind === "network") return true;
    if (this.kind !== "http" || this.httpStatus === undefined) return false;
    return this.httpStatus === 429 || this.httpStatus >= 500;
  }
}

/** Meta's numeric `error.code` from a Graph API error body, if it has one. */
function metaErrorCodeOf(body: string): number | undefined {
  try {
    const code = JSON.parse(body)?.error?.code;
    return typeof code === "number" ? code : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How long a session lookup that missed the safety bound may still take for
 * the turn to be stored afterwards (PR #202).
 */
export const LATE_SESSION_WAIT_MS = 60_000;

/** A session lookup that failed or missed the safety bound. `cause` is the underlying error. */
class SessionUnresolvedError extends Error {
  readonly code: string;
  constructor(readonly cause: any) {
    super("WhatsApp session not resolved");
    this.name = "SessionUnresolvedError";
    this.code = String(cause?.code ?? cause?.name ?? "unknown");
  }
}

/** Per-request bound on a POST to the Graph API. A hung request becomes a network failure. */
export const SEND_TIMEOUT_MS = 15_000;

/**
 * Bound on the caption note (see sendCaptionNote). It gets one attempt with
 * no retry and is abandoned after this long, so the contact's queue is freed.
 */
export const CAPTION_NOTE_TIMEOUT_MS = 5_000;

/**
 * Ledger fields for the caption note. `captionNoteSent` says whether it went
 * out. When it did not, `captionNoteSkipped` gives the reason it was not tried
 * (a safety reply, a degraded reply or the cooldown), and `captionNoteFailed`
 * marks a send that was tried and failed or was abandoned.
 */
type CaptionNoteRecord = {
  captionNote: true;
  captionNoteSent: boolean;
  captionNoteSkipped?: "safety_reply" | "degraded_reply" | "cooldown";
  captionNoteFailed?: true;
};

interface SendOptions {
  /** Retry a transient first-part failure once. Default true. */
  retry?: boolean;
  /** Per-request timeout. Default SEND_TIMEOUT_MS. */
  timeoutMs?: number;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  /**
   * One promise chain per contact, so a burst of messages from the same person
   * is processed strictly one at a time (issue #94).
   *
   * Each webhook POST kicks off its own fire-and-forget `processClaimed`, so
   * without this a user tapping out four quick messages puts four full chat
   * turns for one session in flight simultaneously. That is not merely slow:
   * the turns interleave on shared session state (greeting step, emotional
   * state, `WhatsAppContact.sessionId`) and pile onto the same Prisma pool,
   * which is what pushed a turn past `ChatService`'s 30s pre-RAG budget on
   * 2026-09-06.
   *
   * Instance-local by design — Cloud Run can route a burst to several
   * instances, so this bounds the common case (one contact, one instance)
   * rather than guaranteeing global ordering. The wamid ledger, not this map,
   * is what guarantees at-most-once processing.
   */
  private readonly contactQueues = new Map<string, Promise<void>>();

  /** Per-contact cooldown for the fixed notices (see whatsapp-notices.ts). */
  private readonly noticeLimiter = new NoticeLimiter();

  /** Pause before the single retry of a first part that failed transiently. */
  retryDelayMs = 1_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly sessions: SessionsService,
    private readonly safety: SafetyService,
    private readonly abstention: AbstentionService,
    private readonly empathy: EmpathyDetector,
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

  /**
   * POST signature check (FR-WA-005): HMAC-SHA256 of the raw body with
   * META_APP_SECRET. Still fails closed — but says why.
   *
   * A dropped or rotated `META_APP_SECRET` rejects every inbound message at
   * this gate, before parsing, before the ledger, before anything else leaves a
   * trace. There is no global exception filter in this app, so the resulting
   * 403s carry no application log naming the WhatsApp webhook: from the outside
   * it is indistinguishable from a channel that simply stopped answering
   * (issue #231). Never logs the secret, the signature or the body.
   */
  verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!secret) {
      this.logger.error("WhatsApp webhook rejected: META_APP_SECRET not configured");
      return false;
    }
    if (!rawBody || !signatureHeader) {
      // Most likely an unsigned probe of the public endpoint, not a fault.
      this.logger.warn(
        `WhatsApp webhook rejected: ${!rawBody ? "raw body unavailable" : "x-hub-signature-256 header missing"}`,
      );
      return false;
    }
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    if (!ok) {
      // `warn`, because anyone can POST a bad signature to this public
      // endpoint. A missing secret above stays at `error`: that is our fault.
      this.logger.warn(
        "WhatsApp webhook rejected: x-hub-signature-256 does not match META_APP_SECRET — " +
          "inbound messages are being dropped at the signature gate",
      );
    }
    return ok;
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
          if (!m.id || !m.from) continue;
          const text = extractText(m);
          const base = {
            wamid: m.id,
            from: m.from,
            profileName: nameByWaId.get(m.from),
            sentAt: parseSentAt(m.timestamp),
          };
          if (text) {
            out.push({ ...base, text, ...(m.type && CAPTION_MEDIA_TYPES.has(m.type) ? { captionMediaType: m.type } : {}) });
          } else if (m.type && NOTICE_MESSAGE_TYPES.has(m.type)) {
            // No readable text (voice note, image, document, ...). Kept so the
            // sender gets the fixed "typed messages only" notice. Never reaches
            // ChatService. Reactions, stickers and empty texts are still dropped.
            out.push({ ...base, text: "", unsupportedType: m.type });
          }
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Durable claim (runs BEFORE the webhook ACK)
  // ---------------------------------------------------------------------------

  /**
   * Durably record each verified inbound message *before* the webhook is
   * acknowledged, and claim it for this instance.
   *
   * Both properties come from one INSERT into the `AnalyticsEvent` ledger keyed
   * by `inboundLedgerId(wamid)`:
   *
   * 1. **Durability (P1):** once the row is committed the message is on disk, so
   *    an instance that dies mid-pipeline leaves an auditable `status:"received"`
   *    row instead of losing the message silently. If the write fails we do *not*
   *    ack, so Meta retries rather than dropping the message.
   * 2. **Cross-instance de-dup (P2 / FR-WA-007):** the PK makes the insert the
   *    atomic uniqueness check. A Meta retry routed to any of the N instances
   *    (or arriving after a restart) loses the race and is skipped, so
   *    ChatService is invoked at most once per wamid.
   *
   * Never throws: the caller needs the claimed subset even when a later message
   * in the batch fails, so the failure is returned instead.
   */
  async claimInbound(
    messages: InboundMessage[],
  ): Promise<{ claimed: InboundMessage[]; failure?: Error }> {
    const claimed: InboundMessage[] = [];
    for (const msg of messages) {
      try {
        await this.prisma.analyticsEvent.create({
          data: {
            id: inboundLedgerId(msg.wamid),
            eventName: INBOUND_LEDGER_EVENT,
            // Metadata only — no message text and no phone number. This table is
            // outside the 90-day message purge (docs/PRIVACY_RETENTION.md).
            payload: {
              wamid: msg.wamid,
              status: "received",
              receivedAt: new Date().toISOString(),
              textLength: msg.text.length,
              ...(msg.unsupportedType || msg.captionMediaType
                ? { messageType: msg.unsupportedType ?? msg.captionMediaType }
                : {}),
              ...(msg.sentAt ? { sentAt: new Date(msg.sentAt * 1000).toISOString() } : {}),
            },
          },
        });
        claimed.push(msg);
      } catch (err: any) {
        if (isUniqueViolation(err)) {
          this.logger.debug(`Duplicate WhatsApp message ${msg.wamid} ignored (already claimed)`);
          continue;
        }
        this.logger.error(
          `Failed to durably record WhatsApp message ${msg.wamid}: ${err?.message}`,
          err?.stack,
        );
        return { claimed, failure: err instanceof Error ? err : new Error(String(err)) };
      }
    }
    return { claimed };
  }

  /**
   * Close out a ledger row. Best-effort: a bookkeeping failure must not affect
   * the reply.
   *
   * `status:"processed"` means the reply was accepted by the Graph API, not
   * merely that the chat turn returned — `sendText` throws on a failed send, so
   * the catch in `processOne` records `failed` instead. `failedStage` says
   * which half broke, so "the pipeline is down" and "the pipeline ran but the
   * outbound channel is dead" are distinguishable without Cloud Run logs
   * (issue #231).
   *
   * `notice` marks a row answered with a fixed notice (see whatsapp-notices.ts)
   * on both the success and the failure path.
   */
  private async markLedger(
    wamid: string,
    status: "processed" | "failed",
    error?: string,
    failedStage?: "pipeline" | "delivery",
    delivery?: { partsSent?: number; httpStatus?: number; metaErrorCode?: number },
    notice?: { notice: string; noticeSent: boolean; [field: string]: string | boolean },
  ): Promise<void> {
    try {
      const existing = await this.prisma.analyticsEvent.findUnique({
        where: { id: inboundLedgerId(wamid) },
      });
      await this.prisma.analyticsEvent.update({
        where: { id: inboundLedgerId(wamid) },
        data: {
          payload: {
            ...((existing?.payload as Record<string, unknown> | null) ?? {}),
            status,
            completedAt: new Date().toISOString(),
            // Error class/message only — never the user's text.
            ...(error ? { error: error.slice(0, 200) } : {}),
            ...(failedStage ? { failedStage } : {}),
            // Numbers only. Meta's response body text is never stored here.
            ...(delivery?.partsSent !== undefined ? { partsSent: delivery.partsSent } : {}),
            ...(delivery?.httpStatus !== undefined ? { httpStatus: delivery.httpStatus } : {}),
            ...(delivery?.metaErrorCode !== undefined ? { metaErrorCode: delivery.metaErrorCode } : {}),
            // A notice row is "processed" even when the cooldown suppressed the
            // reply. noticeSent says whether anything went out.
            ...(notice ?? {}),
          },
        },
      });
    } catch (err: any) {
      this.logger.warn(`Could not update WhatsApp ledger for ${wamid}: ${err?.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Processing (async — never blocks the webhook ACK, FR-WA-006)
  // ---------------------------------------------------------------------------

  /** Claim then process. Convenience wrapper; the webhook calls the two halves separately. */
  async processInbound(messages: InboundMessage[]): Promise<void> {
    const { claimed } = await this.claimInbound(messages);
    await this.processClaimed(claimed);
  }

  /**
   * Run already-claimed messages through the full chat pipeline. Every message
   * still goes through `ChatService.handle({channel:"whatsapp"})` — safety,
   * evidence-gate and citation rules are unchanged (FR-WA-001).
   */
  async processClaimed(messages: InboundMessage[]): Promise<void> {
    // Same contact → strictly sequential; different contacts → still parallel.
    await Promise.all(messages.map((msg) => this.enqueueForContact(msg)));
  }

  /**
   * Append one message to its contact's queue and return a promise for its
   * completion. Ordering follows the order of the batch, because the chain is
   * extended synchronously here.
   */
  private enqueueForContact(msg: InboundMessage): Promise<void> {
    const previous = this.contactQueues.get(msg.from) ?? Promise.resolve();
    // `processOne` never rejects, but chain defensively either way so one
    // failure cannot wedge every later message from the same contact.
    const next = previous.then(
      () => this.processOne(msg),
      () => this.processOne(msg),
    );
    this.contactQueues.set(msg.from, next);
    void next.finally(() => {
      // Drop the entry once this is the tail, so the map cannot grow unbounded.
      if (this.contactQueues.get(msg.from) === next) this.contactQueues.delete(msg.from);
    });
    return next;
  }

  /**
   * Answer a message that must not run the pipeline with a fixed notice: one
   * with no readable text, or one delivered long after it was sent (Meta
   * redelivers its queue after an outage). Returns false for an ordinary
   * message. At most one notice of each kind per contact inside the cooldown,
   * so a burst of photos or a redelivered backlog produces one reply. Uses the
   * normal send path and closes the ledger row. ChatService is never called.
   */
  private async replyWithNotice(msg: InboundMessage): Promise<boolean> {
    const kind = noticeKindFor(msg);
    if (!kind) return false;
    // AGENTS.md, section 1, rule 1: nothing may short-circuit in front of the safety path.
    // A stale text that any of the pipeline's deterministic pre-LLM checks
    // would turn into a safety, urgent or mental-health template runs the full
    // pipeline, so the sender gets the approved reply, however late. Only a
    // message every check passes as normal may get the stale notice.
    if (kind === "stale" && this.flaggedBySafetyChecks(msg.text)) {
      this.logger.warn(`Stale WhatsApp message ${msg.wamid} flagged by the safety checks: running the pipeline`);
      return false;
    }
    let noticeSent = false;
    if (this.noticeLimiter.tryAcquire(msg.from, kind)) {
      try {
        // sendText has already retried a transient first-part failure once.
        await this.sendText(msg.from, NOTICE_TEXT[kind]);
      } catch (err: any) {
        // Free the slot so the contact's next message can get the notice.
        this.noticeLimiter.release(msg.from, kind);
        this.logger.error(`Failed to send the ${kind} notice for WhatsApp message ${msg.wamid}: ${err?.message}`);
        await this.markFailed(msg.wamid, err, { notice: kind, noticeSent: false });
        // No fallback reply. The notice is already the fixed reply, and a
        // failed send means the outbound channel itself is down.
        return true;
      }
      noticeSent = true;
      this.logger.log(`WhatsApp message ${msg.wamid} answered with the ${kind} notice (pipeline not run)`);
    } else {
      this.logger.log(`WhatsApp message ${msg.wamid} not answered: ${kind} notice already sent to this contact`);
    }
    await this.markLedger(msg.wamid, "processed", undefined, undefined, undefined, { notice: kind, noticeSent });
    return true;
  }

  /** The pipeline's text-only safety checks, with this service's instances. */
  private get safetyScreenDeps(): SafetyScreenDeps {
    return { safety: this.safety, abstention: this.abstention, empathy: this.empathy };
  }

  /**
   * After the pipeline has answered a captioned image, video or document, tell
   * the sender the attachment itself was not read. Called only once the answer
   * was accepted by Meta and recorded, so it never comes before or in place of
   * it, and the ledger never waits on it.
   *
   * Skipped, without taking a limiter slot, after a safety reply (any
   * classification other than "normal"), so the safety reply and its helpline
   * numbers stay the last message on screen. Also skipped after a degraded
   * reply: ChatService sets `error` only on its budget-exhausted templates
   * ("budget_exhausted_before_llm" and "budget_exhausted_before_rag").
   *
   * At most one per contact inside the cooldown. One attempt, no retry, and
   * abandoned after CAPTION_NOTE_TIMEOUT_MS, so the contact's queue is freed
   * quickly. Never throws: any failure frees the slot and returns
   * captionNoteSent false. No fallback reply is ever sent for it.
   */
  private async sendCaptionNote(
    msg: InboundMessage,
    result: { error?: unknown; safety?: { classification?: string } },
  ): Promise<CaptionNoteRecord> {
    if (result.error) return { captionNote: true, captionNoteSent: false, captionNoteSkipped: "degraded_reply" };
    if (result.safety?.classification !== "normal") {
      return { captionNote: true, captionNoteSent: false, captionNoteSkipped: "safety_reply" };
    }
    let acquired = false;
    try {
      acquired = this.noticeLimiter.tryAcquire(msg.from, "caption_media");
      if (!acquired) return { captionNote: true, captionNoteSent: false, captionNoteSkipped: "cooldown" };
      await this.sendText(msg.from, NOTICE_TEXT.caption_media, { retry: false, timeoutMs: CAPTION_NOTE_TIMEOUT_MS });
      return { captionNote: true, captionNoteSent: true };
    } catch (err: any) {
      try {
        if (acquired) this.noticeLimiter.release(msg.from, "caption_media");
      } catch {
        // Nothing more to do. The slot expires with the cooldown.
      }
      // The delivery error carries the HTTP status and Meta's code only.
      this.logger.warn(`Failed to send the caption note for WhatsApp message ${msg.wamid}: ${err?.message}`);
      return { captionNote: true, captionNoteSent: false, captionNoteFailed: true };
    }
  }

  /**
   * Add the caption note's outcome to an answered turn's ledger row. Adds the
   * note fields only, so `status` and `partsSent` keep describing the answer.
   * Best effort: a failed write is logged and the turn carries on.
   */
  private async recordCaptionNote(wamid: string, note: CaptionNoteRecord): Promise<void> {
    try {
      const existing = await this.prisma.analyticsEvent.findUnique({ where: { id: inboundLedgerId(wamid) } });
      const payload = (existing?.payload as Record<string, unknown> | null) ?? {};
      await this.prisma.analyticsEvent.update({
        where: { id: inboundLedgerId(wamid) },
        // The existing fields are spread last, so status and partsSent cannot change.
        data: { payload: { ...note, ...payload } },
      });
    } catch (err: any) {
      this.logger.warn(`Could not record the caption note for WhatsApp message ${wamid}: ${err?.message}`);
    }
  }

  /**
   * True when any of the deterministic, text-only checks `ChatService.handle`
   * runs before the LLM would send the turn to a safety, urgent or
   * mental-health template:
   *   1. emergency fast path (red-flag escalation)
   *   2. safety rules (self-harm, emergency, refusals, misinformation)
   *   3. urgency indicators (urgent S2 template)
   *   4. mental-health screen (MH1 crisis, MH2/MH3 support templates)
   * The logic lives once, in chat/deterministic-safety.ts, which checks both
   * the raw text and the spell-corrected text the pipeline actually screens.
   */
  private flaggedBySafetyChecks(text: string): boolean {
    return flaggedByDeterministicSafetyChecks(text, this.safetyScreenDeps);
  }

  /** Run one already-claimed message through the chat pipeline. Never throws. */
  private async processOne(msg: InboundMessage): Promise<void> {
    // When this turn started, for the late audit rows of a no-session reply.
    const receivedAt = new Date();
    try {
      if (await this.replyWithNotice(msg)) return;
      const locale = detectLocale(msg.text);
      // The deterministic safety screen needs only the text. If it fires and
      // the session cannot be resolved (database down, pool exhausted), the
      // contact still gets the emergency, self-harm or crisis template
      // instead of the generic failure reply (PR #202).
      const safetyFallback = buildSessionFreeSafetyReply(
        { userText: msg.text, channel: "whatsapp", locale },
        this.safetyScreenDeps,
      );
      // Resolve the session. A safety turn waits at most a short, fixed time.
      // The raw promise is kept so that a late session can still store the turn.
      const resolve = async (forceNew: boolean): Promise<string> => {
        const resolving = this.resolveSession(msg.from, locale, forceNew);
        if (!safetyFallback) return resolving;
        try {
          return await withinBound(resolving, SAFETY_SESSION_LOOKUP_BOUND_MS, "whatsapp:resolveSession");
        } catch (err) {
          throw Object.assign(new SessionUnresolvedError(err), { resolving });
        }
      };
      let sessionId: string;
      try {
        sessionId = await resolve(false);
      } catch (err: any) {
        if (!safetyFallback) throw err;
        await this.sendSafetyFallback(msg, safetyFallback, err, receivedAt);
        return;
      }
      let result;
      try {
        result = await this.chat.handle({ sessionId, channel: "whatsapp", locale, userText: msg.text });
      } catch (err: any) {
        // Self-heal a stale/deleted session (the stored sessionId no longer
        // exists in the DB) — mint a fresh session and retry ONCE. Without
        // this the contact is wedged on the fallback reply until the TTL.
        if (isInvalidSessionError(err)) {
          this.logger.warn(`Stale session ${sessionId} for WhatsApp contact — re-minting and retrying`);
          try {
            sessionId = await resolve(true);
          } catch (mintErr: any) {
            if (!safetyFallback) throw mintErr;
            await this.sendSafetyFallback(msg, safetyFallback, mintErr, receivedAt);
            return;
          }
          result = await this.chat.handle({ sessionId, channel: "whatsapp", locale, userText: msg.text });
        } else {
          throw err;
        }
      }
      // Citations are for auditors, not readers (OD-003). The HTTP path strips
      // markers in ChatController; this channel bypasses the controller, so it
      // must strip them itself or raw `[citation:...]` ids reach the patient
      // (issue #116). The raw text stays in the DB for evaluation.
      const partsSent = await this.sendText(msg.from, cleanResponseForDisplay(result.responseText));
      // The answer is recorded before any note work, so the row never waits on the note.
      await this.markLedger(msg.wamid, "processed", undefined, undefined, { partsSent });
      if (msg.captionMediaType) {
        await this.recordCaptionNote(msg.wamid, await this.sendCaptionNote(msg, result));
      }
    } catch (err: any) {
      const delivery = err instanceof WhatsAppDeliveryError;
      this.logger.error(`Failed to process WhatsApp message ${msg.wamid}: ${err?.message}`, err?.stack);
      await this.markFailed(msg.wamid, err);
      // `sendText` has already retried a transient first-part failure once.
      // A delivery failure here means the outbound channel itself is down (missing
      // or rejected credentials, Graph outage). Pushing the fallback down the
      // same channel cannot reach the patient, and after a partial send it
      // would leave them a truncated answer followed by an apology.
      if (delivery) return;
      await this.sendText(msg.from, FALLBACK_REPLY).catch(() => undefined);
    }
  }

  /**
   * Send the session-free safety template for a message whose session could
   * not be resolved (PR #202). Same send and ledger path as a pipeline reply.
   * The ledger row is marked as answered by `safety_fallback`. If the send
   * fails, the row is marked failed and nothing else is sent: the generic
   * failure reply never follows a safety template. Never throws. The log line
   * carries the wamid and an error code, never the message text.
   */
  private async sendSafetyFallback(
    msg: InboundMessage,
    reply: DeterministicSafetyReply,
    cause: any,
    receivedAt: Date,
  ): Promise<void> {
    this.logger.error(
      `[safety-fallback] could not resolve the WhatsApp session for ${msg.wamid} (${errorTag(cause?.cause ?? cause)}); ` +
        `sending the ${reply.label} template without a session`,
    );
    // The gate and classification go in the ledger row, never the text.
    const note = {
      notice: "safety_fallback",
      noticeSent: false,
      safetyGate: reply.label,
      safetyClassification: reply.safety.classification,
    };
    let partsSent: number;
    try {
      partsSent = await this.sendText(msg.from, cleanResponseForDisplay(reply.responseText));
    } catch (sendErr: any) {
      this.logger.error(`Failed to send the safety template for WhatsApp message ${msg.wamid}: ${sendErr?.message}`);
      await this.markFailed(msg.wamid, sendErr, note);
      this.storeWhenSessionArrives(msg, reply, cause, { receivedAt, repliedAt: new Date() });
      return;
    }
    // The reply time, taken as soon as Meta accepted it.
    const repliedAt = new Date();
    await this.markLedger(msg.wamid, "processed", undefined, undefined, { partsSent }, { ...note, noticeSent: true });
    this.storeWhenSessionArrives(msg, reply, cause, { receivedAt, repliedAt });
  }

  /**
   * If the session lookup that timed out does settle with a session, store
   * the turn the healthy path would have stored (user message, reply,
   * SafetyEvent and, for a crisis, the review flag), in the background with
   * bounded single attempts. If it fails, or does not settle within
   * LATE_SESSION_WAIT_MS, log that the turn has no stored record, with the
   * wamid and an error code only.
   */
  private storeWhenSessionArrives(
    msg: InboundMessage,
    reply: DeterministicSafetyReply,
    cause: any,
    times: { receivedAt: Date; repliedAt: Date },
  ): void {
    const resolving: Promise<string> | undefined = cause?.resolving;
    const noRecord = (err: any) =>
      this.logger.error(
        `[safety-fallback] WhatsApp message ${msg.wamid} has no stored record (${errorTag(err)}); only the ledger row describes it`,
      );
    if (!resolving) {
      noRecord(cause);
      return;
    }
    void withinBound(resolving, LATE_SESSION_WAIT_MS, "whatsapp:lateSession").then((sessionId) => {
      try {
        this.chat.recordSessionFreeSafetyTurn(sessionId, { userText: msg.text, channel: "whatsapp" }, reply, times);
      } catch (err) {
        noRecord(err);
      }
    }, noRecord);
  }

  /** Record a failed turn, splitting a delivery failure from a pipeline one. */
  private async markFailed(
    wamid: string,
    err: any,
    notice?: { notice: string; noticeSent: boolean; [field: string]: string | boolean },
  ): Promise<void> {
    const delivery = err instanceof WhatsAppDeliveryError;
    await this.markLedger(
      wamid,
      "failed",
      err?.message,
      delivery ? "delivery" : "pipeline",
      delivery ? { partsSent: err.partsSent, httpStatus: err.httpStatus, metaErrorCode: err.metaErrorCode } : undefined,
      notice,
    );
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

  /**
   * Hand a reply to the Graph API and return how many parts Meta accepted.
   * Throws `WhatsAppDeliveryError` if anything stops it reaching Meta — callers
   * must not treat a return-without-send as success (issue #231).
   *
   * One transient failure (network, 429, 5xx) on the first part is retried
   * once after `retryDelayMs`. Only the first part, and only while nothing has
   * been accepted, so a retry never repeats a part Meta already took. A
   * failure on a later part is not retried, because the patient already holds
   * the start of the reply.
   */
  async sendText(to: string, text: string, opts: SendOptions = {}): Promise<number> {
    const retry = opts.retry ?? true;
    const timeoutMs = opts.timeoutMs ?? SEND_TIMEOUT_MS;
    const phoneNumberId = process.env.META_WABA_PHONE_NUMBER_ID;
    const token = process.env.META_WABA_TOKEN;
    if (!phoneNumberId || !token) {
      throw new WhatsAppDeliveryError(
        "WhatsApp outbound not configured — META_WABA_PHONE_NUMBER_ID / META_WABA_TOKEN missing",
        0,
        "config",
      );
    }
    const version = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

    let partsSent = 0;
    for (const body of formatForWhatsApp(text)) {
      try {
        await this.postPart(url, token, to, body, partsSent, timeoutMs);
      } catch (err) {
        if (!retry || !(err instanceof WhatsAppDeliveryError) || !err.retryable || partsSent !== 0) throw err;
        this.logger.warn(`${err.message}. Retrying the first part once in ${this.retryDelayMs} ms`);
        await sleep(this.retryDelayMs);
        await this.postPart(url, token, to, body, partsSent, timeoutMs);
      }
      partsSent++;
    }
    return partsSent;
  }

  /**
   * POST one part. Throws `WhatsAppDeliveryError` unless Meta answers 2xx.
   *
   * The request is aborted after `timeoutMs`. Without a bound a hung request
   * held the contact's queue, so the next message (possibly an emergency)
   * waited behind it. An abort makes fetch reject, which the catch below
   * classifies as a network failure like any other. The timer is a plain
   * setTimeout, which the specs can drive with fake timers.
   */
  private async postPart(
    url: string,
    token: string,
    to: string,
    body: string,
    partsSent: number,
    timeoutMs: number = SEND_TIMEOUT_MS,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      await this.postPartWithSignal(url, token, to, body, partsSent, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async postPartWithSignal(
    url: string,
    token: string,
    to: string,
    body: string,
    partsSent: number,
    signal: AbortSignal,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(url, {
        signal,
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
    } catch (err: any) {
      // DNS, TLS or connection failure: fetch rejects before any HTTP
      // response exists. The reply did not leave the box, so this is a
      // delivery failure like a non-2xx send. Left as a native error it was
      // recorded as failedStage "pipeline" and the fallback was pushed down
      // the same dead channel.
      throw new WhatsAppDeliveryError(
        `WhatsApp send failed (network): ${String(err?.message ?? err).slice(0, 200)}`,
        partsSent,
        "network",
      );
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const metaErrorCode = metaErrorCodeOf(errText);
      // Meta's body goes to the log for the operator. It stays out of the
      // error message, which is copied into the ledger.
      this.logger.warn(`WhatsApp Graph API error body (${res.status}): ${errText.slice(0, 200)}`);
      // Stop sending further parts, and surface it — a 401/403 on the system
      // user token silently kills every reply on the live number.
      throw new WhatsAppDeliveryError(
        `WhatsApp send failed (${res.status}${metaErrorCode !== undefined ? `, Meta code ${metaErrorCode}` : ""})`,
        partsSent,
        "http",
        res.status,
        metaErrorCode,
      );
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
  // A typed caption on media is the sender's words. It runs the normal
  // pipeline (and the safety checks). Only caption-less media gets the
  // typed-messages notice.
  if (m.type === "image") return m.image?.caption?.trim() || null;
  if (m.type === "video") return m.video?.caption?.trim() || null;
  if (m.type === "document") return m.document?.caption?.trim() || null;
  return null;
}
