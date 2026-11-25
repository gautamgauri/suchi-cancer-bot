/**
 * Publishing, one platform at a time, each step a conditional write.
 *
 *   approved --claim--> publishing --result--> published | failed | uncertain | dry_run
 *
 * The claim is a compare-and-swap on the post record. Only the writer whose
 * claim succeeds sends anything, so two clicks, two scheduler runs or a
 * redelivered request can never post twice. A platform that fails does not
 * stop the others. "failed" with a retryable reason goes back to "approved"
 * on a later tick, up to MAX_PUBLISH_ATTEMPTS. "uncertain" is never retried.
 */
import { Platform, PLATFORMS, PublishAttempt, SocialPost } from "./social.types";
import { mutatePost, SocialStore } from "./social-store";
import { PlatformClient, PublishOutcome } from "./platforms/platform-client";
import { assertLaneAllowed } from "./content/clinical-lane";

export const MAX_PUBLISH_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 15 * 60_000;
/** A claim older than this with no recorded result is treated as uncertain. */
export const STUCK_AFTER_MS = 15 * 60_000;
/** Approved posts not sent within this time (for example while paused) are not sent later. */
export const APPROVAL_SHELF_LIFE_MS = 7 * 86_400_000;

export type PublishMode = "live" | "dry_run" | "off";

export function publishMode(): PublishMode {
  const v = (process.env.SOCIAL_PUBLISH_MODE ?? "dry_run").trim().toLowerCase();
  return v === "live" || v === "off" ? v : "dry_run";
}

export interface PlatformResult {
  platform: Platform;
  state: SocialPost["platforms"][Platform]["state"];
  attempt?: PublishAttempt;
  permalink?: string;
  tokenProblem?: boolean;
  /** The outcome is known but the record was not updated. */
  recordNotSaved?: boolean;
}

export class SocialPublisher {
  constructor(
    private readonly store: SocialStore,
    private readonly clients: Record<Platform, PlatformClient>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Publish every platform of this post that is in the "approved" state, one
   * after another, so writers on the same record do not contend. A platform
   * whose step throws is reported and the next one still runs.
   */
  async publishApproved(id: string): Promise<PlatformResult[]> {
    const cur = await this.store.getPost(id);
    if (!cur) return [];
    if (cur.value.status !== "approved") return [];
    const targets = PLATFORMS.filter((p) => cur.value.platforms[p]?.state === "approved");
    const out: PlatformResult[] = [];
    for (const p of targets) {
      try {
        const r = await this.publishOne(id, p);
        if (r) out.push(r);
      } catch (err) {
        out.push({ platform: p, state: "approved", attempt: { at: this.now().toISOString(), outcome: "uncertain", error: `internal error: ${(err as Error)?.message ?? err}` } });
      }
    }
    return out;
  }

  private async publishOne(id: string, platform: Platform): Promise<PlatformResult | null> {
    if (await this.store.isPaused()) {
      return { platform, state: "approved", attempt: { at: this.now().toISOString(), outcome: "paused", error: "social posting is paused" } };
    }
    const mode = publishMode();
    if (mode === "off") {
      return { platform, state: "approved", attempt: { at: this.now().toISOString(), outcome: "paused", error: "SOCIAL_PUBLISH_MODE is off" } };
    }
    if (mode === "live" && !this.store.durable) {
      // Without the GCS store there is no shared record, so a second instance
      // could post the same thing. Live posting is refused.
      return { platform, state: "approved", attempt: { at: this.now().toISOString(), outcome: "paused", error: "live mode needs QUEUE_GCS_BUCKET; nothing is sent from the in-memory store" } };
    }

    // Claim. Only one writer gets past this point for this platform.
    let claimed: SocialPost | null = null;
    const claim = await mutatePost(this.store, id, (post) => {
      const r = post.platforms[platform];
      if (r.state !== "approved") return null;
      if (post.status !== "approved") return null;
      const approvedAt = post.approval?.usedAt ? Date.parse(post.approval.usedAt) : 0;
      if (this.now().getTime() - approvedAt > APPROVAL_SHELF_LIFE_MS) {
        r.state = "skipped";
        r.attempts.push({ at: this.now().toISOString(), outcome: "rejected", error: "approval older than seven days, not sent", retryable: false });
        return post;
      }
      // The owner approved what the email said would happen. A post offered
      // as a dry run is never sent live, and the other way round.
      if (post.offeredMode && post.offeredMode !== mode) {
        r.state = "skipped";
        r.attempts.push({ at: this.now().toISOString(), outcome: "rejected", error: "publish mode changed since approval, not sent", retryable: false });
        if (PLATFORMS.every((q) => !["approved", "publishing"].includes(post.platforms[q].state))) post.status = "done";
        return post;
      }
      r.state = "publishing";
      r.claimedAt = this.now().toISOString();
      claimed = post;
      return post;
    });
    if (!claim || !claim.changed || !claimed) return null;
    const post = claimed as SocialPost;
    const record = post.platforms[platform];
    if (record.state !== "publishing") return { platform, state: record.state };

    try {
      assertLaneAllowed({ lane: post.lane, article: post.article });
    } catch (err) {
      const at = this.now().toISOString();
      await mutatePost(this.store, id, (p) => {
        const r = p.platforms[platform];
        if (r.state !== "publishing") return null;
        r.state = "failed";
        r.attempts.push({ at, outcome: "rejected", error: (err as Error).message, retryable: false });
        return p;
      });
      return { platform, state: "failed" };
    }

    const client = this.clients[platform];
    const payload = { text: record.text, imageUrl: record.imageUrl };
    const at = this.now().toISOString();
    let outcome: PublishOutcome;
    if (mode === "dry_run") {
      outcome = { kind: "published", postId: "dry-run" };
    } else {
      try {
        outcome = await client.publish(payload);
      } catch (err) {
        outcome = { kind: "uncertain", error: `client threw: ${(err as Error)?.message ?? err}` };
      }
    }

    const attempt: PublishAttempt =
      mode === "dry_run"
        ? { at, outcome: "dry_run" }
        : outcome.kind === "published"
          ? { at, outcome: "published", httpStatus: outcome.httpStatus }
          : outcome.kind === "not_configured"
            ? { at, outcome: "not_configured", error: outcome.error, retryable: false }
            : outcome.kind === "rejected"
              ? { at, outcome: "rejected", error: outcome.error, httpStatus: outcome.httpStatus, retryable: outcome.retryable }
              : { at, outcome: "uncertain", error: outcome.error, httpStatus: outcome.httpStatus };

    const nextState: PlatformResult["state"] =
      mode === "dry_run" ? "dry_run"
        : outcome.kind === "published" ? "published"
          : outcome.kind === "uncertain" ? "uncertain"
            : "failed";

    let written: Awaited<ReturnType<typeof mutatePost>> = null;
    try {
      written = await mutatePost(this.store, id, (p) => {
      const r = p.platforms[platform];
      if (r.state !== "publishing") return null;
      r.state = nextState;
      r.attempts.push(attempt);
      if (mode === "dry_run") r.rendered = client.render(payload);
      if (outcome.kind === "published" && mode === "live") {
        r.platformPostId = outcome.postId;
        r.permalink = outcome.permalink;
        r.publishedAt = at;
      }
      if (PLATFORMS.every((q) => !["approved", "publishing"].includes(p.platforms[q].state) && !(p.platforms[q].state === "failed" && this.retryable(p, q)))) {
        p.status = "done";
      }
      return p;
      }, 12, true);
    } catch (err) {
      // The platform answered but the record could not be written. The claim
      // stays at "publishing", and the daily tick moves it to "uncertain"
      // after 15 minutes and asks the owner to check by hand.
      return { platform, state: "publishing", attempt: { ...attempt, error: `${attempt.error ?? attempt.outcome}, but the record could not be saved: ${(err as Error).message}` }, recordNotSaved: true };
    }
    if (!written || !written.changed) {
      return { platform, state: written?.post.platforms[platform]?.state ?? "publishing", attempt, recordNotSaved: true };
    }
    return {
      platform,
      state: nextState,
      attempt,
      permalink: outcome.kind === "published" && mode === "live" ? outcome.permalink : undefined,
      tokenProblem: outcome.kind === "rejected" ? outcome.tokenProblem : false,
    };
  }

  private retryable(post: SocialPost, platform: Platform): boolean {
    const r = post.platforms[platform];
    const last = r.attempts[r.attempts.length - 1];
    return r.state === "failed" && Boolean(last?.retryable) && r.attempts.filter((a) => a.outcome === "rejected").length < MAX_PUBLISH_ATTEMPTS;
  }

  /**
   * A platform left in "publishing" (the process stopped, or the result could
   * not be saved) may or may not have been posted. After STUCK_AFTER_MS it is
   * marked "uncertain" so the owner checks the platform by hand. Never retried.
   */
  async releaseStuck(): Promise<Array<{ id: string; title: string; platform: Platform }>> {
    const out: Array<{ id: string; title: string; platform: Platform }> = [];
    for (const post of await this.store.listPosts()) {
      for (const p of PLATFORMS) {
        const r = post.platforms[p];
        if (r?.state !== "publishing") continue;
        const since = Date.parse(r.claimedAt ?? post.approval?.usedAt ?? post.createdAt);
        if (this.now().getTime() - since < STUCK_AFTER_MS) continue;
        const res = await mutatePost(this.store, post.id, (cur) => {
          const c = cur.platforms[p];
          if (c.state !== "publishing") return null;
          c.state = "uncertain";
          c.attempts.push({ at: this.now().toISOString(), outcome: "uncertain", error: "left in publishing for more than 15 minutes, outcome unknown" });
          return cur;
        });
        if (res?.changed) out.push({ id: post.id, title: post.title, platform: p });
      }
    }
    return out;
  }

  /** Posts approved but not yet sent, for example while paused, within the seven-day rule. */
  async waitingApproved(): Promise<string[]> {
    const out: string[] = [];
    for (const post of await this.store.listPosts()) {
      if (post.status !== "approved") continue;
      if (!PLATFORMS.some((p) => post.platforms[p]?.state === "approved")) continue;
      out.push(post.id);
    }
    return out;
  }

  /** Put retryable failures back to "approved" once enough time has passed. Returns ids touched. */
  async requeueRetryable(): Promise<string[]> {
    const touched: string[] = [];
    for (const post of await this.store.listPosts()) {
      for (const p of PLATFORMS) {
        const r = post.platforms[p];
        const last = r?.attempts[r.attempts.length - 1];
        if (!r || r.state !== "failed" || !last?.retryable) continue;
        if (this.now().getTime() - Date.parse(last.at) < RETRY_AFTER_MS) continue;
        const res = await mutatePost(this.store, post.id, (cur) => {
          if (!this.retryable(cur, p)) return null;
          cur.platforms[p].state = "approved";
          cur.status = "approved";
          return cur;
        });
        if (res?.changed && !touched.includes(post.id)) touched.push(post.id);
      }
    }
    return touched;
  }
}
