import { SocialPublisher, MAX_PUBLISH_ATTEMPTS, RETRY_AFTER_MS } from "./social-publisher";
import { MemorySocialStore } from "./social-store";
import { Platform, SocialPost } from "./social.types";
import { PlatformClient, PublishOutcome } from "./platforms/platform-client";

function client(platform: Platform, outcomes: PublishOutcome[], delayMs = 0): PlatformClient & { calls: number } {
  const c = {
    platform,
    calls: 0,
    isConfigured: () => true,
    render: (p: { text: string }) => ({ url: `https://${platform}.example/post`, body: { text: p.text } }),
    publish: async () => {
      c.calls++;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return outcomes.shift() ?? { kind: "published", postId: `${platform}-extra` };
    },
  };
  return c as PlatformClient & { calls: number };
}

function approvedPost(now: Date, overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "p1", lane: "practical", topicId: "t", title: "T", createdAt: now.toISOString(), sources: [],
    platforms: {
      linkedin: { state: "approved", text: "li", attempts: [] },
      facebook: { state: "approved", text: "fb", attempts: [] },
      instagram: { state: "approved", text: "ig", imageUrl: "https://suchitracancercare.org/social/cards/a.jpg", cardText: "c", attempts: [] },
      x: { state: "skipped", text: "", attempts: [] },
    },
    status: "approved", contentHash: "h",
    approval: { issuedAt: now.toISOString(), expiresAt: now.toISOString(), usedAt: now.toISOString(), decision: "approved" },
    ...overrides,
  };
}

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("SocialPublisher", () => {
  let now = new Date("2026-12-01T04:00:00Z");
  const clock = () => now;
  beforeEach(() => {
    now = new Date("2026-12-01T04:00:00Z");
    process.env.SOCIAL_PUBLISH_MODE = "live";
  });

  function setup(outcomes: Partial<Record<Platform, PublishOutcome[]>> = {}, delay = 0) {
    const store = new MemorySocialStore({ durable: true });
    const clients = {
      linkedin: client("linkedin", outcomes.linkedin ?? [{ kind: "published", postId: "urn:li:share:1", permalink: "https://li/1" }], delay),
      facebook: client("facebook", outcomes.facebook ?? [{ kind: "published", postId: "104_1" }], delay),
      instagram: client("instagram", outcomes.instagram ?? [{ kind: "published", postId: "m1" }], delay),
      x: client("x", outcomes.x ?? [], delay),
    };
    return { store, clients, pub: new SocialPublisher(store, clients, clock) };
  }

  it("publishes each approved platform once and records the post ids", async () => {
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(now));
    const results = await pub.publishApproved("p1");
    expect(results.map((r) => `${r.platform}:${r.state}`).sort()).toEqual(["facebook:published", "instagram:published", "linkedin:published"]);
    const saved = (await store.getPost("p1"))!.value;
    expect(saved.platforms.linkedin).toMatchObject({ state: "published", platformPostId: "urn:li:share:1", permalink: "https://li/1", publishedAt: now.toISOString() });
    expect(saved.status).toBe("done");
    expect(clients.x.calls).toBe(0);
  });

  it("never posts twice when two runs race on the same approval", async () => {
    const { store, clients, pub } = setup({}, 20);
    await store.createPost(approvedPost(now));
    await Promise.all([pub.publishApproved("p1"), pub.publishApproved("p1"), pub.publishApproved("p1")]);
    expect(clients.linkedin.calls).toBe(1);
    expect(clients.facebook.calls).toBe(1);
    expect(clients.instagram.calls).toBe(1);
  });

  it("does nothing on a second run after success", async () => {
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(now));
    await pub.publishApproved("p1");
    expect(await pub.publishApproved("p1")).toEqual([]);
    expect(clients.facebook.calls).toBe(1);
  });

  it("isolates a failing platform from the others", async () => {
    const { store, pub } = setup({ linkedin: [{ kind: "rejected", error: "HTTP 401", httpStatus: 401, retryable: false, tokenProblem: true }] });
    await store.createPost(approvedPost(now));
    const results = await pub.publishApproved("p1");
    const by = Object.fromEntries(results.map((r) => [r.platform, r]));
    expect(by.linkedin).toMatchObject({ state: "failed", tokenProblem: true });
    expect(by.facebook.state).toBe("published");
    expect(by.instagram.state).toBe("published");
  });

  it("isolates a client that throws", async () => {
    const { store, clients, pub } = setup();
    clients.facebook.publish = async () => { throw new Error("bug"); };
    await store.createPost(approvedPost(now));
    const results = await pub.publishApproved("p1");
    expect(results.find((r) => r.platform === "facebook")!.state).toBe("uncertain");
    expect(results.find((r) => r.platform === "linkedin")!.state).toBe("published");
  });

  it("never retries an uncertain outcome", async () => {
    const { store, clients, pub } = setup({ facebook: [{ kind: "uncertain", error: "timeout" }] });
    await store.createPost(approvedPost(now));
    await pub.publishApproved("p1");
    now = new Date(now.getTime() + RETRY_AFTER_MS * 10);
    expect(await pub.requeueRetryable()).toEqual([]);
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(1);
    expect((await store.getPost("p1"))!.value.platforms.facebook.state).toBe("uncertain");
  });

  it("retries a definite, retryable failure after a wait, up to the limit", async () => {
    const rejected: PublishOutcome = { kind: "rejected", error: "HTTP 429", httpStatus: 429, retryable: true };
    const { store, clients, pub } = setup({ x: [], facebook: [rejected, rejected, rejected, rejected] });
    await store.createPost(approvedPost(now));
    await pub.publishApproved("p1");
    expect(await pub.requeueRetryable()).toEqual([]); // too soon
    for (let i = 0; i < 5; i++) {
      now = new Date(now.getTime() + RETRY_AFTER_MS + 1000);
      const ids = await pub.requeueRetryable();
      for (const id of ids) await pub.publishApproved(id);
    }
    expect(clients.facebook.calls).toBe(MAX_PUBLISH_ATTEMPTS);
    expect((await store.getPost("p1"))!.value.platforms.facebook.state).toBe("failed");
  });

  it("dry run renders exactly what would be sent and calls no platform", async () => {
    process.env.SOCIAL_PUBLISH_MODE = "dry_run";
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(now));
    const results = await pub.publishApproved("p1");
    expect(results.every((r) => r.state === "dry_run")).toBe(true);
    expect(clients.linkedin.calls + clients.facebook.calls + clients.instagram.calls).toBe(0);
    const saved = (await store.getPost("p1"))!.value;
    expect(saved.platforms.facebook.rendered).toEqual({ url: "https://facebook.example/post", body: { text: "fb" } });
    expect(saved.platforms.facebook.platformPostId).toBeUndefined();
  });

  it("sends nothing while paused, and the post waits", async () => {
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(now));
    await store.setPaused(true);
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(0);
    expect((await store.getPost("p1"))!.value.platforms.facebook.state).toBe("approved");
    await store.setPaused(false);
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(1);
  });

  it("sends nothing when the mode is off", async () => {
    process.env.SOCIAL_PUBLISH_MODE = "off";
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(now));
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(0);
  });

  it("does not send an approval more than seven days old", async () => {
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(new Date("2026-11-20T00:00:00Z")));
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(0);
    expect((await store.getPost("p1"))!.value.platforms.facebook.state).toBe("skipped");
  });

  it("sends nothing for a post that has not been approved", async () => {
    const { store, clients, pub } = setup();
    const offered = approvedPost(now, { status: "awaiting_approval" });
    for (const p of ["linkedin", "facebook", "instagram"] as const) offered.platforms[p].state = "offered";
    await store.createPost(offered);
    expect(await pub.publishApproved("p1")).toEqual([]);
    expect(clients.linkedin.calls + clients.facebook.calls + clients.instagram.calls).toBe(0);
  });

  it("refuses to claim a platform when the post's status is not approved", async () => {
    const { store, clients, pub } = setup();
    // A platform left in "approved" on a post that was rejected or expired.
    await store.createPost(approvedPost(now, { status: "rejected" }));
    expect(await pub.publishApproved("p1")).toEqual([]);
    expect(clients.facebook.calls).toBe(0);
    // Even when called straight at the claim, past the status check above.
    const anyPub = pub as unknown as { publishOne: (id: string, p: string) => Promise<unknown> };
    expect(await anyPub.publishOne("p1", "facebook")).toBeNull();
    expect(clients.facebook.calls).toBe(0);
  });

  it("sends platforms one after another, never two at once", async () => {
    const { store, clients, pub } = setup({}, 15);
    let active = 0;
    let most = 0;
    for (const c of Object.values(clients)) {
      const orig = c.publish;
      c.publish = async (p) => { active++; most = Math.max(most, active); try { return await orig(p); } finally { active--; } };
    }
    await store.createPost(approvedPost(now));
    await pub.publishApproved("p1");
    expect(most).toBe(1);
  });

  it("refuses live sending from the in-memory store", async () => {
    const store = new MemorySocialStore();
    const c = client("facebook", []);
    const pub = new SocialPublisher(store, { linkedin: client("linkedin", []), facebook: c, instagram: client("instagram", []), x: client("x", []) }, clock);
    await store.createPost(approvedPost(now));
    const results = await pub.publishApproved("p1");
    expect(c.calls).toBe(0);
    expect(results[0].attempt!.error).toMatch(/QUEUE_GCS_BUCKET/);
  });

  it("marks a claim left in publishing for 15 minutes as uncertain, and never sends it again", async () => {
    const { store, clients, pub } = setup();
    const p = approvedPost(now);
    p.platforms.facebook.state = "publishing";
    p.platforms.facebook.claimedAt = now.toISOString();
    await store.createPost(p);
    expect(await pub.releaseStuck()).toEqual([]);
    now = new Date(now.getTime() + 16 * 60_000);
    expect(await pub.releaseStuck()).toEqual([{ id: "p1", title: "T", platform: "facebook" }]);
    expect((await store.getPost("p1"))!.value.platforms.facebook.state).toBe("uncertain");
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(0);
  });

  it("reports a result it could not save, leaving the claim for the stuck check", async () => {
    const { store, pub } = setup();
    await store.createPost(approvedPost(now));
    const realUpdate = store.updatePost.bind(store);
    let n = 0;
    // Let the claim through, then refuse every write of the result.
    store.updatePost = async (post, v) => (post.platforms.linkedin.state === "publishing" && n++ === 0 ? realUpdate(post, v) : post.platforms.linkedin.state === "publishing" ? realUpdate(post, v) : false);
    const results = await pub.publishApproved("p1");
    const li = results.find((r) => r.platform === "linkedin")!;
    expect(li.recordNotSaved).toBe(true);
    expect((await store.getPost("p1"))!.value.platforms.linkedin.state).toBe("publishing");
  }, 20_000);

  it("lists approved posts that are still waiting to be sent", async () => {
    const { store, pub } = setup();
    await store.createPost(approvedPost(now));
    expect(await pub.waitingApproved()).toEqual(["p1"]);
  });

  it("refuses a clinical post whose article is not reviewed, even if approved", async () => {
    const { store, clients, pub } = setup();
    await store.createPost(approvedPost(now, { lane: "clinical", article: { slug: "a", reviewStatus: "ai_draft" } }));
    await pub.publishApproved("p1");
    expect(clients.facebook.calls).toBe(0);
    expect((await store.getPost("p1"))!.value.platforms.facebook.state).toBe("failed");
  });
});
