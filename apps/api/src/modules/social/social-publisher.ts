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
}

export class SocialPublisher {
  constructor(
    private readonly store: SocialStore,
    private readonly clients: Record<Platform, PlatformClient>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Publish every platform of this post that is in the "approved" state. */
  async publishApproved(id: string): Promise<PlatformResult[]> {
    const cur = await this.store.getPost(id);
    if (!cur) return [];
    const targets = PLATFORMS.filter((p) => cur.value.platforms[p]?.state === "approved");
    const settled = await Promise.allSettled(targets.map((p) => this.publishOne(id, p)));
    return settled.map((s, i) =>
      s.status === "fulfilled" ? s.value : { platform: targets[i], state: "approved" as const, attempt: { at: this.now().toISOString(), outcome: "uncertain" as const, error: `internal error: ${(s.reason as Error)?.message ?? s.reason}` } },
    ).filter((r): r is PlatformResult => r !== null);
  }

  private async publishOne(id: string, platform: Platform): Promise<PlatformResult | null> {
    if (await this.store.isPaused()) {
      return { platform, state: "approved", attempt: { at: this.now().toISOString(), outcome: "paused", error: "social posting is paused" } };
    }
    const mode = publishMode();
    if (mode === "off") {
      return { platform, state: "approved", attempt: { at: this.now().toISOString(), outcome: "paused", error: "SOCIAL_PUBLISH_MODE is off" } };
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
      r.state = "publishing";
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

    const written = await mutatePost(this.store, id, (p) => {
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
    });
    void written;
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
