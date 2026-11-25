/**
 * Social distribution: plan, gate, ask the owner, publish, record.
 *
 * Daily tick (Cloud Scheduler, POST /v1/social/tick):
 *   1. Check credentials and email the owner about anything close to lapsing.
 *   2. Put retryable platform failures back in line and publish them.
 *   3. Prepare the calendar items due today. Each gets per-platform drafts,
 *      each draft passes the voice gate or is held, and the owner receives
 *      one email showing every platform's exact text and image.
 *   4. Re-check articles waiting for clinical review.
 *   5. Mark unanswered approvals as expired.
 *
 * The owner's click opens a review page (GET, changes nothing). The publish
 * button on that page (POST) is the only thing that can approve a post.
 */
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { LlmService } from "../llm/llm.service";
import { EmailService } from "../email/email.service";
import { ContentBrief, Platform, PLATFORMS, PlatformRecord, SocialPost } from "./social.types";
import { createSocialStore, mutatePost, SocialStore } from "./social-store";
import { PlatformClient } from "./platforms/platform-client";
import { FacebookClient, InstagramClient } from "./platforms/meta.clients";
import { LinkedInClient, XClient, xEnabled } from "./platforms/linkedin-x.clients";
import { CALENDAR, CalendarItem, cardUrl } from "./content/calendar";
import { assertLaneAllowed, clinicalBriefFromArticle } from "./content/clinical-lane";
import { gateDraft, describeViolations } from "./voice/draft-gate";
import { generateDraft, Llm } from "./social-generator";
import { contentHashOf, signApprovalToken, verifyApprovalToken, ApprovalSecretMissingError } from "./approval-token";
import { PlatformResult, publishMode, PublishMode, SocialPublisher } from "./social-publisher";
import { checkLinkedIn, checkMeta, checkX, needsAlert, PlatformHealth, secretManagerCreatedAt, SecretCreatedAt } from "./token-health";
import { approvalEmailHtml, calendarEmptyHtml, heldEmailHtml, resultHtml, stuckHtml, tokenAlertHtml } from "./social-html";
import { FetchLike } from "./platforms/platform-client";

export const API_PUBLIC_BASE = "https://suchi-api-lxiveognla-uc.a.run.app/v1";
/** Shown on Instagram when a brief has no card of its own. */
export const GENERIC_CARD = { file: "suchi-generic.jpg", text: "Suchi, cancer information for patients and caregivers across India." };

export interface SocialDeps {
  store: SocialStore;
  clients: Record<Platform, PlatformClient>;
  now: () => Date;
  fetchFn: FetchLike;
  secretCreatedAt: SecretCreatedAt;
  /** Reads an object from the queue bucket, e.g. content-drafts/<slug>.md. */
  readQueueObject: (name: string) => Promise<string | null>;
}

export const SOCIAL_DEPS = "SOCIAL_DEPS";

function defaultClients(): Record<Platform, PlatformClient> {
  return { linkedin: new LinkedInClient(), facebook: new FacebookClient(), instagram: new InstagramClient(), x: new XClient() };
}

async function readQueueObjectFromGcs(name: string): Promise<string | null> {
  const bucket = process.env.QUEUE_GCS_BUCKET;
  if (!bucket) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Storage } = require("@google-cloud/storage");
    const [buf] = await new Storage({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "gen-lang-client-0202543132" }).bucket(bucket).file(name).download();
    return (buf as Buffer).toString("utf-8");
  } catch {
    return null;
  }
}

/** The generator writes posts that have no hand-written text. Off unless "true". */
export function generatorEnabled(): boolean {
  return process.env.SOCIAL_GENERATOR_ENABLED === "true";
}

/**
 * Verify the token against the post's content as it is now, recomputed from
 * the stored text and images, so an edit to the stored record after the email
 * went out invalidates the approval.
 */
function verifyAgainstContent(token: string | undefined, post: SocialPost, now: Date) {
  return verifyApprovalToken(token, { id: post.id, contentHash: contentHashOf(post) }, now);
}

/** YYYY-MM-DD in India. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** ok with post (and results after a decision), or not ok with a reason. */
export interface DecisionResult {
  ok: boolean;
  reason?: string;
  post?: SocialPost;
  results?: PlatformResult[];
}

export interface TickReport {
  paused: boolean;
  mode: PublishMode;
  tokens: PlatformHealth[];
  alertsSent: number;
  retried: string[];
  /** Approved posts sent by this tick, for example after a pause. */
  resumed: string[];
  /** Platforms moved from "publishing" to "uncertain". */
  stuck: Array<{ id: string; title: string; platform: Platform }>;
  /** Posts whose failed approval email was reported to the owner. */
  emailFailures: string[];
  prepared: Array<{ id: string; status: string }>;
  expired: string[];
  /** True on the one tick that told the owner the calendar has run out. */
  calendarEmptySent?: boolean;
}

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly deps: SocialDeps;
  readonly publisher: SocialPublisher;

  constructor(
    private readonly llm: LlmService,
    private readonly email: EmailService,
    @Optional() @Inject(SOCIAL_DEPS) deps?: Partial<SocialDeps>,
  ) {
    this.deps = {
      store: deps?.store ?? createSocialStore(),
      clients: deps?.clients ?? defaultClients(),
      now: deps?.now ?? (() => new Date()),
      fetchFn: deps?.fetchFn ?? fetch,
      secretCreatedAt: deps?.secretCreatedAt ?? secretManagerCreatedAt(),
      readQueueObject: deps?.readQueueObject ?? readQueueObjectFromGcs,
    };
    this.publisher = new SocialPublisher(this.deps.store, this.deps.clients, this.deps.now);
  }

  get store(): SocialStore {
    return this.deps.store;
  }

  private ownerEmail(): string | null {
    return process.env.DAILY_REPORT_EMAIL?.trim() || null;
  }

  // -------------------------------------------------------------------------
  // Building posts
  // -------------------------------------------------------------------------

  /** Which platforms may be offered now, and why not when they may not. */
  availability(mode: PublishMode = publishMode()): Record<Platform, { offer: boolean; reason?: string }> {
    const out = {} as Record<Platform, { offer: boolean; reason?: string }>;
    for (const p of PLATFORMS) {
      const client = this.deps.clients[p];
      if (mode === "dry_run") out[p] = { offer: true };
      else if (p === "x" && !xEnabled()) out[p] = { offer: false, reason: "X is switched off" };
      else if (!client.isConfigured()) out[p] = { offer: false, reason: `${p} credentials are not configured` };
      else out[p] = { offer: true };
    }
    return out;
  }

  /** Build a post without storing it. Used by the tick and by the preview. */
  async buildPost(id: string, brief: ContentBrief, opts: { date?: string; card?: { file: string; text: string }; drafts?: CalendarItem["drafts"]; mode?: PublishMode } = {}): Promise<SocialPost> {
    const now = this.deps.now().toISOString();
    const post: SocialPost = {
      id,
      lane: brief.lane,
      topicId: brief.topicId,
      title: brief.title,
      createdAt: now,
      sources: brief.facts,
      platforms: {} as Record<Platform, PlatformRecord>,
      status: "held_for_owner",
      contentHash: "",
      heldReasons: [],
      date: opts.date,
      article: brief.article,
    };

    try {
      assertLaneAllowed(brief);
    } catch (err) {
      for (const p of PLATFORMS) post.platforms[p] = { state: "skipped", text: "", attempts: [] };
      post.heldReasons!.push((err as Error).message);
      return post;
    }

    const avail = this.availability(opts.mode);
    const card = opts.card ?? GENERIC_CARD;
    for (const p of PLATFORMS) {
      const base: PlatformRecord = { state: "draft", text: "", attempts: [] };
      if (p === "instagram") {
        base.cardText = card.text;
        base.imageUrl = cardUrl(card.file);
      }
      if (!avail[p].offer) {
        post.platforms[p] = { ...base, state: "skipped" };
        post.heldReasons!.push(`${p}: ${avail[p].reason}`);
        continue;
      }
      const written = opts.drafts?.[p];
      if (written) {
        const gate = gateDraft(p, written.text, brief, base.cardText);
        post.platforms[p] = {
          ...base,
          text: written.text,
          state: gate.passed ? "offered" : "held",
          voice: { passed: gate.passed, violations: describeViolations(gate.violations), score: gate.score.total, attempts: 1 },
        };
        continue;
      }
      if (!generatorEnabled()) {
        post.platforms[p] = { ...base, state: "held", voice: { passed: false, violations: ["no hand-written text, and the generator is off (SOCIAL_GENERATOR_ENABLED)"], score: 0, attempts: 0 } };
        post.heldReasons!.push(`${p}: no hand-written text, and the generator is off`);
        continue;
      }
      const gen = await generateDraft(this.llm as unknown as Llm, p, brief, base.cardText);
      if ("gate" in gen) {
        post.platforms[p] = { ...base, text: gen.text, state: "offered", voice: { passed: true, violations: [], score: gen.gate.score.total, attempts: gen.attempts } };
      } else {
        post.platforms[p] = {
          ...base,
          text: gen.last?.text ?? "",
          state: "held",
          voice: { passed: false, violations: [gen.error, ...(gen.last ? describeViolations(gen.last.gate.violations) : [])], score: gen.last?.gate.score.total ?? 0, attempts: gen.attempts },
        };
        post.heldReasons!.push(`${p}: ${gen.error}`);
      }
    }
    post.contentHash = contentHashOf(post);
    post.status = PLATFORMS.some((p) => post.platforms[p].state === "offered") ? "awaiting_approval" : "held_for_owner";
    return post;
  }

  /** Create the post if it does not exist yet, then email the owner. Idempotent per id. */
  async prepareAndOffer(id: string, brief: ContentBrief, opts: { date?: string; card?: { file: string; text: string }; drafts?: CalendarItem["drafts"] } = {}): Promise<{ id: string; status: string }> {
    if (await this.deps.store.getPost(id)) return { id, status: "exists" };
    const mode = publishMode();
    const post = await this.buildPost(id, brief, { ...opts, mode });

    let token: string | null = null;
    let expiresAt: Date | null = null;
    const owner = this.ownerEmail();
    if (post.status === "awaiting_approval") {
      try {
        const signed = signApprovalToken(post.id, post.contentHash, this.deps.now());
        token = signed.token;
        expiresAt = signed.expiresAt;
        post.approval = { issuedAt: this.deps.now().toISOString(), expiresAt: expiresAt.toISOString() };
      } catch (err) {
        if (!(err instanceof ApprovalSecretMissingError)) throw err;
        post.status = "held_for_owner";
        post.heldReasons!.push(err.message);
      }
      if (!owner) {
        post.status = "held_for_owner";
        post.heldReasons!.push("DAILY_REPORT_EMAIL is not set, so there is nobody to approve it");
      }
    }

    post.offeredMode = mode;
    if (!(await this.deps.store.createPost(post))) return { id, status: "exists" };

    if (post.status === "awaiting_approval" && token && expiresAt && owner) {
      const reviewUrl = `${API_PUBLIC_BASE}/social/review/${encodeURIComponent(post.id)}?t=${encodeURIComponent(token)}`;
      const sent = await this.email.sendEmail({
        to: owner,
        subject: `For your approval: social post, ${post.title}`,
        html: approvalEmailHtml(post, reviewUrl, mode, expiresAt),
      }).catch(() => false);
      if (!sent) {
        // Nobody can approve a post whose link never arrived. Hold it, and
        // the next tick tells the owner.
        await mutatePost(this.deps.store, id, (p) => {
          if (p.status !== "awaiting_approval") return null;
          p.status = "held_for_owner";
          p.emailFailedAt = this.deps.now().toISOString();
          p.heldReasons = [...(p.heldReasons ?? []), "the approval email could not be sent"];
          for (const q of PLATFORMS) if (p.platforms[q].state === "offered") p.platforms[q].state = "skipped";
          return p;
        });
        this.logger.error(`Approval email for social post ${id} could not be sent. The post is held.`);
        return { id, status: "held_for_owner" };
      }
    } else if (owner) {
      await this.email.sendEmail({ to: owner, subject: `Social post held: ${post.title}`, html: heldEmailHtml(post) });
    }
    this.logger.log(`Social post ${id} prepared: ${post.status}`);
    return { id, status: post.status };
  }

  // -------------------------------------------------------------------------
  // Approval
  // -------------------------------------------------------------------------

  /** For the review page. Never changes anything. */
  async getForReview(id: string, token: string | undefined): Promise<DecisionResult> {
    const cur = await this.deps.store.getPost(id);
    if (!cur) return { ok: false, reason: "not_found" };
    const post = cur.value;
    if (post.approval?.usedAt) {
      // Decided already. The token is checked against the hash it was issued
      // for, since the platforms' states have moved on since.
      const signed = verifyApprovalToken(token, post, this.deps.now());
      return { ok: false, reason: signed.ok || signed.reason === "expired" ? "already_decided" : signed.reason, post };
    }
    const check = verifyAgainstContent(token, post, this.deps.now());
    if (!check.ok) return { ok: false, reason: check.reason, post };
    if (post.status !== "awaiting_approval") return { ok: false, reason: post.status, post };
    if (post.offeredMode && post.offeredMode !== publishMode()) return { ok: false, reason: "mode_changed", post };
    return { ok: true, post };
  }

  /**
   * The publish button. Verifies the token, marks it used in the same
   * conditional write that approves the chosen platforms, then publishes.
   */
  async decide(id: string, token: string | undefined, decision: "approve" | "reject", platforms: Platform[]): Promise<DecisionResult> {
    const pre = await this.getForReview(id, token);
    if (!pre.ok) return pre;

    let reason: string | null = null;
    const res = await mutatePost(this.deps.store, id, (post) => {
      if (post.approval?.usedAt || post.status !== "awaiting_approval") { reason = "already_decided"; return null; }
      const check = verifyAgainstContent(token, post, this.deps.now());
      if (!check.ok) { reason = check.reason; return null; }
      if (post.offeredMode && post.offeredMode !== publishMode()) { reason = "mode_changed"; return null; }
      const at = this.deps.now().toISOString();
      post.approval = { ...(post.approval ?? { issuedAt: at, expiresAt: at }), usedAt: at, decision: decision === "approve" ? "approved" : "rejected", platforms };
      if (decision === "reject") {
        post.status = "rejected";
        for (const p of PLATFORMS) if (post.platforms[p].state === "offered") post.platforms[p].state = "skipped";
        return post;
      }
      const chosen = platforms.filter((p) => post.platforms[p]?.state === "offered");
      if (chosen.length === 0) { reason = "no_platform_chosen"; return null; }
      for (const p of PLATFORMS) {
        if (post.platforms[p].state !== "offered") continue;
        post.platforms[p].state = chosen.includes(p) ? "approved" : "skipped";
      }
      post.status = "approved";
      return post;
    });
    if (!res) return { ok: false, reason: "not_found" };
    if (!res.changed) return { ok: false, reason: reason ?? "already_decided", post: res.post };
    if (decision === "reject") return { ok: true, post: res.post, results: [] };

    const results = await this.publisher.publishApproved(id);
    const after = (await this.deps.store.getPost(id))?.value ?? res.post;
    await this.reportResults(after, results);
    return { ok: true, post: after, results };
  }

  private async reportResults(post: SocialPost, results: PlatformResult[]): Promise<void> {
    const owner = this.ownerEmail();
    if (!owner || results.length === 0) return;
    const anyBad = results.some((r) => r.state === "failed" || r.state === "uncertain");
    const allDry = results.every((r) => r.state === "dry_run");
    await this.email.sendEmail({
      to: owner,
      subject: `${allDry ? "Social post dry run recorded, nothing sent" : anyBad ? "Social post partly sent" : "Social post sent"}: ${post.title}`,
      html: resultHtml(post, results),
    }).catch(() => undefined);
    if (results.some((r) => r.tokenProblem)) {
      await this.email.sendEmail({
        to: owner,
        subject: "Social posting: a platform rejected its token",
        html: tokenAlertHtml(results.filter((r) => r.tokenProblem).map((r) => ({ platform: r.platform, status: "invalid" as const, detail: r.attempt?.error ?? "rejected the token" }))),
      }).catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Daily tick
  // -------------------------------------------------------------------------

  async checkTokens(): Promise<PlatformHealth[]> {
    const now = this.deps.now();
    const [li, meta] = await Promise.all([checkLinkedIn(this.deps.secretCreatedAt, now), checkMeta(this.deps.fetchFn, now)]);
    return [li, ...meta, checkX()];
  }

  /** Send each alert stage once. Returns how many platforms were in the email. */
  async alertTokens(health: PlatformHealth[]): Promise<number> {
    const owner = this.ownerEmail();
    const due = health.filter((h) => needsAlert(h) && h.alertKey);
    if (!owner || due.length === 0) return 0;
    const state = await this.deps.store.getState<{ sent: string[] }>("token-alerts");
    const sent = new Set(state?.value.sent ?? []);
    const fresh = due.filter((h) => !sent.has(h.alertKey!));
    if (fresh.length === 0) return 0;
    await this.email.sendEmail({ to: owner, subject: "Social posting: credentials need attention", html: tokenAlertHtml(fresh) });
    const next = { sent: [...sent, ...fresh.map((h) => h.alertKey!)].slice(-200) };
    await this.deps.store.putState("token-alerts", next, state?.version ?? null).catch(() => false);
    return fresh.length;
  }

  async tick(): Promise<TickReport> {
    const mode = publishMode();
    const paused = await this.deps.store.isPaused();
    const report: TickReport = { paused, mode, tokens: [], alertsSent: 0, retried: [], resumed: [], stuck: [], emailFailures: [], prepared: [], expired: [] };

    try {
      report.tokens = await this.checkTokens();
      report.alertsSent = await this.alertTokens(report.tokens);
    } catch (err) {
      this.logger.error(`Token check failed: ${(err as Error).message}`);
    }
    report.stuck = await this.publisher.releaseStuck();
    if (report.stuck.length) await this.reportStuck(report.stuck);
    report.emailFailures = await this.reportEmailFailures();
    if (paused || mode === "off") return report;

    report.retried = await this.publisher.requeueRetryable();
    // Posts approved while paused, or whose send was interrupted, are sent now,
    // within the seven-day rule the publisher applies.
    const waiting = await this.publisher.waitingApproved();
    report.resumed = waiting.filter((id) => !report.retried.includes(id));
    for (const id of [...report.retried, ...report.resumed]) {
      const results = await this.publisher.publishApproved(id);
      const post = (await this.deps.store.getPost(id))?.value;
      if (post) await this.reportResults(post, results);
    }

    const today = istDate(this.deps.now());
    const yesterday = istDate(new Date(this.deps.now().getTime() - 86_400_000));
    for (const item of CALENDAR.filter((i) => i.date === today || i.date === yesterday)) {
      report.prepared.push(await this.prepareAndOffer(`${item.date}-${item.brief.topicId}`, item.brief, { date: item.date, card: item.card, drafts: item.drafts }));
    }
    if (!CALENDAR.some((i) => i.date >= today)) report.calendarEmptySent = await this.reportCalendarEmpty();

    report.prepared.push(...(await this.recheckClinicalWaiting()));
    report.expired = await this.expireStale();
    return report;
  }

  /** Tell the owner once that no calendar items are left. */
  private async reportCalendarEmpty(): Promise<boolean> {
    const owner = this.ownerEmail();
    if (!owner) return false;
    const lastDate = CALENDAR.length ? CALENDAR.map((i) => i.date).sort().slice(-1)[0] : null;
    const key = "calendar-empty";
    const cur = await this.deps.store.getState<{ lastDate: string | null }>(key);
    if (cur && cur.value.lastDate === lastDate) return false;
    // Claim first, so two instances cannot both send it.
    if (!(await this.deps.store.putState(key, { lastDate }, cur?.version ?? null).catch(() => false))) return false;
    await this.email.sendEmail({ to: owner, subject: "Social posting: the calendar has no posts left", html: calendarEmptyHtml(lastDate) }).catch(() => undefined);
    return true;
  }

  private async reportStuck(stuck: Array<{ id: string; title: string; platform: Platform }>): Promise<void> {
    const owner = this.ownerEmail();
    if (!owner) return;
    await this.email.sendEmail({
      to: owner,
      subject: "Social posting: please check a post by hand",
      html: stuckHtml(stuck),
    }).catch(() => undefined);
  }

  /** Posts held because their approval email failed, not yet reported. */
  private async reportEmailFailures(): Promise<string[]> {
    const owner = this.ownerEmail();
    if (!owner) return [];
    const failed = (await this.deps.store.listPosts()).filter((p) => p.emailFailedAt && !p.emailFailureReported);
    const out: string[] = [];
    for (const post of failed) {
      const ok = await this.email.sendEmail({ to: owner, subject: `Social post held, its approval email did not send: ${post.title}`, html: heldEmailHtml(post) }).catch(() => false);
      if (!ok) continue;
      await mutatePost(this.deps.store, post.id, (p) => (p.emailFailureReported ? null : { ...p, emailFailureReported: true }));
      out.push(post.id);
    }
    return out;
  }

  private async expireStale(): Promise<string[]> {
    const out: string[] = [];
    const now = this.deps.now().getTime();
    for (const post of await this.deps.store.listPosts()) {
      if (post.status !== "awaiting_approval" || !post.approval?.expiresAt) continue;
      if (Date.parse(post.approval.expiresAt) > now) continue;
      const r = await mutatePost(this.deps.store, post.id, (p) => {
        if (p.status !== "awaiting_approval" || p.approval?.usedAt) return null;
        p.status = "expired";
        for (const q of PLATFORMS) if (p.platforms[q].state === "offered") p.platforms[q].state = "skipped";
        return p;
      });
      if (r?.changed) out.push(post.id);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Clinical lane
  // -------------------------------------------------------------------------

  /**
   * Called when an article is approved in the content pipeline. Prepares a
   * clinical post only if the article is marked reviewed. Otherwise the slug
   * waits in a list that the daily tick re-checks, so the lane switches on
   * for that article on the day its status changes.
   */
  async queueFromArticle(slug: string, articlePath: string): Promise<{ status: string; reason?: string }> {
    const md = await this.deps.readQueueObject(`content-drafts/${slug}.md`);
    if (!md) return { status: "no_article", reason: `content-drafts/${slug}.md could not be read` };
    const check = clinicalBriefFromArticle(slug, md, articlePath, istDate(this.deps.now()));
    if (!check.allowed) {
      await this.addClinicalWaiting(slug, articlePath);
      this.logger.log(`Clinical post for "${slug}" waits for review: ${check.reason}`);
      return { status: "waiting_for_review", reason: check.reason };
    }
    const r = await this.prepareAndOffer(`article-${slug}`, check.brief, {});
    await this.removeClinicalWaiting(slug);
    return { status: r.status };
  }

  private async addClinicalWaiting(slug: string, articlePath: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const cur = await this.deps.store.getState<{ articles: Array<{ slug: string; path: string }> }>("clinical-waiting");
      const list = cur?.value.articles ?? [];
      if (list.some((a) => a.slug === slug)) return;
      if (await this.deps.store.putState("clinical-waiting", { articles: [...list, { slug, path: articlePath }] }, cur?.version ?? null)) return;
    }
  }

  private async removeClinicalWaiting(slug: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const cur = await this.deps.store.getState<{ articles: Array<{ slug: string; path: string }> }>("clinical-waiting");
      if (!cur || !cur.value.articles.some((a) => a.slug === slug)) return;
      if (await this.deps.store.putState("clinical-waiting", { articles: cur.value.articles.filter((a) => a.slug !== slug) }, cur.version)) return;
    }
  }

  private async recheckClinicalWaiting(): Promise<Array<{ id: string; status: string }>> {
    const cur = await this.deps.store.getState<{ articles: Array<{ slug: string; path: string }> }>("clinical-waiting");
    const out: Array<{ id: string; status: string }> = [];
    for (const a of cur?.value.articles ?? []) {
      const md = await this.deps.readQueueObject(`content-drafts/${a.slug}.md`);
      if (!md) continue;
      const check = clinicalBriefFromArticle(a.slug, md, a.path, istDate(this.deps.now()));
      if (!check.allowed) continue;
      const r = await this.prepareAndOffer(`article-${a.slug}`, check.brief, {});
      await this.removeClinicalWaiting(a.slug);
      out.push(r);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Preview, pause, records
  // -------------------------------------------------------------------------

  /** Exactly what would be posted for a calendar date, per platform, without storing or sending. */
  async preview(date: string): Promise<Array<{ id: string; status: string; platforms: Record<string, unknown> }>> {
    const out = [];
    for (const item of CALENDAR.filter((i) => i.date === date)) {
      const post = await this.buildPost(`${item.date}-${item.brief.topicId}`, item.brief, { date: item.date, card: item.card, drafts: item.drafts, mode: "dry_run" });
      const platforms: Record<string, unknown> = {};
      for (const p of PLATFORMS) {
        const r = post.platforms[p];
        platforms[p] = { state: r.state, voice: r.voice, request: r.text ? this.deps.clients[p].render({ text: r.text, imageUrl: r.imageUrl }) : null, cardText: r.cardText };
      }
      out.push({ id: post.id, status: post.status, platforms });
    }
    return out;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.deps.store.setPaused(paused);
  }

  /** What was posted where and when, newest first. */
  async records(): Promise<Array<Record<string, unknown>>> {
    const posts = await this.deps.store.listPosts();
    return posts
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({
        id: p.id,
        title: p.title,
        lane: p.lane,
        status: p.status,
        approvedAt: p.approval?.usedAt,
        platforms: Object.fromEntries(PLATFORMS.map((q) => [q, { state: p.platforms[q]?.state, postId: p.platforms[q]?.platformPostId, permalink: p.platforms[q]?.permalink, publishedAt: p.platforms[q]?.publishedAt, lastError: p.platforms[q]?.attempts.slice(-1)[0]?.error }])),
      }));
  }
}
