/**
 * Shared types for social distribution (LinkedIn, Facebook, Instagram, X).
 *
 * A SocialPost is one piece of content adapted per platform. It moves through
 * a single lifecycle. Nothing reaches a platform until the owner has opened
 * the review page and pressed the publish button (a POST), and each platform
 * is claimed, posted and recorded on its own, so a failure on one never
 * touches another and a retry can never post twice.
 */

export const PLATFORMS = ["linkedin", "facebook", "instagram", "x"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Content lanes. Practical support and Onco Talks need only the owner's
 * approval. The clinical lane is blocked unless the source article's
 * `review_status` is `reviewed` (AGENTS.md section 1, rule 3). `published`
 * means only that the article is live, and does not open it.
 */
export type Lane = "practical" | "onco_talks" | "clinical";

export interface SourceFact {
  /** The fact as it may be stated in a post. */
  text: string;
  /** Official page the fact was read on. */
  url: string;
  /** ISO date the page was fetched. */
  fetchedOn: string;
}

/** What the generator and the gate know about one calendar item. */
export interface ContentBrief {
  topicId: string;
  lane: Lane;
  title: string;
  /** One or two sentences on what the post is for and who it is for. */
  angle: string;
  facts: SourceFact[];
  /** Site path for the next step, when it is a site page (e.g. /watch/x/). */
  sitePath?: string;
  /** Next step kind per platform. */
  nextStep: "chat" | "site" | "whatsapp";
  /** Words that may appear because the source itself uses them (e.g. a video title). */
  allowedTerms?: string[];
  /** Clinical lane only: the article the post is drafted from. */
  article?: { slug: string; reviewStatus: string };
}

export interface PlatformDraftText {
  text: string;
  /** Instagram only: the words printed on the card image. */
  cardText?: string;
  /** Instagram only: public JPEG URL of the card. */
  imageUrl?: string;
}

export type PlatformState =
  | "draft"        // generated, not yet offered
  | "held"         // failed the voice gate, never offered for approval
  | "offered"      // in the approval email
  | "skipped"      // owner left it out, or platform disabled
  | "approved"     // owner approved, waiting to be claimed
  | "publishing"   // claimed by one worker; nobody else may post it
  | "published"    // platform returned a post id
  | "dry_run"      // rendered exactly, no platform call made
  | "failed"       // platform definitely rejected it; safe to retry if retryable
  | "uncertain";   // outcome unknown (timeout, 5xx). Never retried automatically.

export interface PublishAttempt {
  at: string;
  outcome: "published" | "dry_run" | "rejected" | "uncertain" | "not_configured" | "paused";
  httpStatus?: number;
  error?: string;
  retryable?: boolean;
}

export interface PlatformRecord extends PlatformDraftText {
  state: PlatformState;
  voice?: { passed: boolean; violations: string[]; score: number; attempts: number };
  attempts: PublishAttempt[];
  /** When this platform was claimed for sending. */
  claimedAt?: string;
  platformPostId?: string;
  permalink?: string;
  publishedAt?: string;
  /** Dry run: the exact request that would have been sent, without credentials. */
  rendered?: Record<string, unknown>;
}

export type PostStatus =
  | "held_for_owner"     // nothing passed the gate, or the lane is blocked
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "expired"
  | "done";

export interface SocialPost {
  id: string;
  lane: Lane;
  topicId: string;
  title: string;
  createdAt: string;
  sources: SourceFact[];
  platforms: Record<Platform, PlatformRecord>;
  status: PostStatus;
  /** SHA-256 over the exact text and images offered, bound into the approval token. */
  contentHash: string;
  approval?: {
    issuedAt: string;
    expiresAt: string;
    usedAt?: string;
    decision?: "approved" | "rejected";
    platforms?: Platform[];
  };
  heldReasons?: string[];
  /** Clinical lane only: the reviewed article the post was drafted from. */
  article?: { slug: string; reviewStatus: string };
  /** Calendar date the post belongs to, when it came from the calendar. */
  date?: string;
  /** SOCIAL_PUBLISH_MODE when the post was offered. Approval is refused if it has changed. */
  offeredMode?: "live" | "dry_run" | "off";
  /** The approval email could not be sent. Reported to the owner on the next tick. */
  emailFailedAt?: string;
  emailFailureReported?: boolean;
}
