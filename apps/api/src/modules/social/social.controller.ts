import { Body, Controller, Get, HttpCode, Logger, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";
import { SchedulerOidcGuard } from "../../common/guards/scheduler-oidc.guard";
import { SocialService, API_PUBLIC_BASE } from "./social.service";
import { parsePlatformSelection } from "./approval-token";
import { publishMode } from "./social-publisher";
import { messagePageHtml, reviewPageHtml, resultHtml } from "./social-html";

/**
 * The review page needs the card images from the site, which the default
 * helmet policy blocks. Everything else stays shut.
 */
const REVIEW_CSP =
  "default-src 'none'; img-src https://suchitracancercare.org https://i.ytimg.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const REASONS: Record<string, string> = {
  not_found: "This post could not be found.",
  malformed: "This link is not valid.",
  bad_signature: "This link is not valid.",
  wrong_post: "This link is not valid.",
  expired: "This link has expired. Nothing was posted.",
  content_changed: "The post changed after this link was made. Nothing was posted.",
  no_secret: "Approval links are switched off because no signing secret is set. Nothing was posted.",
  already_decided: "A decision has already been made on this post. Nothing more will be posted from this link.",
  no_platform_chosen: "No platform was ticked, so nothing was posted. The link still works if you want to go back and choose.",
  rejected: "This post was turned down earlier.",
  mode_changed: "Posting was switched between dry run and live after this post was offered, so this link no longer works. Nothing was posted. A new offer is needed.",
  expired_status: "This post was not approved in time.",
  held_for_owner: "This post was held and cannot be approved.",
  approved: "This post has already been approved.",
  done: "This post has already been handled.",
};

// Note: the global prefix v1 is added in main.ts. Do not repeat it here.
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller("social")
export class SocialController {
  private readonly logger = new Logger(SocialController.name);
  constructor(private readonly social: SocialService) {}

  /** Linked from the approval email. Shows the posts and a publish button. Changes nothing. */
  @Get("review/:id")
  async review(@Param("id") id: string, @Query("t") token: string | undefined, @Res() res: Response): Promise<void> {
    res.setHeader("Content-Security-Policy", REVIEW_CSP);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const r = await this.social.getForReview(id, token);
    if (!r.ok) {
      res.status(r.reason === "not_found" ? 404 : 200).send(messagePageHtml("Nothing to approve", REASONS[r.reason] ?? REASONS.done));
      return;
    }
    res.status(200).send(reviewPageHtml(r.post, token!, `${API_PUBLIC_BASE}/social/review/${encodeURIComponent(id)}`, publishMode()));
  }

  /** The publish button. The only route that can approve a post. */
  @Post("review/:id")
  @HttpCode(200)
  async decide(@Param("id") id: string, @Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    res.setHeader("Content-Security-Policy", REVIEW_CSP);
    res.setHeader("Cache-Control", "no-store");
    const token = typeof body?.t === "string" ? body.t : undefined;
    const decision = body?.decision === "reject" ? "reject" : body?.decision === "approve" ? "approve" : null;
    if (!decision) {
      res.status(400).send(messagePageHtml("Nothing posted", "The form was incomplete."));
      return;
    }
    const r = await this.social.decide(id, token, decision, parsePlatformSelection(body?.platforms));
    if (!r.ok) {
      res.status(r.reason === "not_found" ? 404 : 200).send(messagePageHtml("Nothing posted", REASONS[r.reason] ?? REASONS.done));
      return;
    }
    if (decision === "reject") {
      res.send(messagePageHtml("Not posted", "This post will not be published."));
      return;
    }
    this.logger.log(`Social post ${id} approved, results: ${r.results.map((x) => `${x.platform}=${x.state}`).join(" ")}`);
    res.send(resultHtml(r.post, r.results));
  }

  /** Daily run. Cloud Scheduler, OIDC. */
  @SkipThrottle()
  @UseGuards(SchedulerOidcGuard)
  @Post("tick")
  @HttpCode(200)
  tick() {
    return this.social.tick();
  }

  /** Exactly what would be posted on a calendar date, per platform. Sends nothing. */
  @UseGuards(BasicAuthGuard)
  @Get("preview")
  preview(@Query("date") date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return { error: "date=YYYY-MM-DD is required" };
    return this.social.preview(date);
  }

  /** What was posted where and when. */
  @UseGuards(BasicAuthGuard)
  @Get("posts")
  posts() {
    return this.social.records();
  }

  /** Credential health, without sending any email. */
  @UseGuards(BasicAuthGuard)
  @Get("tokens")
  tokens() {
    return this.social.checkTokens();
  }

  /** The one switch. Paused: nothing is prepared and nothing is sent until resumed. */
  @UseGuards(BasicAuthGuard)
  @Post("pause")
  @HttpCode(200)
  async pause() {
    await this.social.setPaused(true);
    return { paused: true };
  }

  @UseGuards(BasicAuthGuard)
  @Post("resume")
  @HttpCode(200)
  async resume() {
    await this.social.setPaused(false);
    return { paused: false };
  }
}
