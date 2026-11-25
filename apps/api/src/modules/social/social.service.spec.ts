import { SocialService, istDate } from "./social.service";
import { MemorySocialStore } from "./social-store";
import { Platform } from "./social.types";
import { PlatformClient, PublishOutcome } from "./platforms/platform-client";
import { CALENDAR } from "./content/calendar";

function fakeClient(platform: Platform, configured = true): PlatformClient & { calls: string[] } {
  const c = {
    platform,
    calls: [] as string[],
    isConfigured: () => configured,
    render: (p: { text: string }) => ({ body: p.text }),
    publish: async (p: { text: string }): Promise<PublishOutcome> => {
      c.calls.push(p.text);
      return { kind: "published", postId: `${platform}-1`, permalink: `https://${platform}.example/1` };
    },
  };
  return c as PlatformClient & { calls: string[] };
}

/** An LLM stand-in that writes a plain post ending with the link the prompt asks for. */
function goodLlm() {
  return {
    generateRaw: jest.fn(async (_s: string, prompt: string) => {
      const link = /put exactly this link as the final line: (\S+)/.exec(prompt)?.[1];
      const body = "Suchi can help with clear explanations and with questions to ask your doctor. Suchi is not a doctor.";
      const text = link ? `${body}\n${link}` : `${body} The link is in our profile.`;
      return JSON.stringify({ text });
    }),
  };
}

const ARTICLE = (status: string) => `---
title: "Chemotherapy: What to Expect"
review_status: ${status}
---
# Chemotherapy

Chemotherapy uses medicines to treat cancer and is given in cycles with rest periods between them.
Your care team will explain the plan and what to expect at each visit to the day-care unit.
`;

describe("SocialService", () => {
  const saved = { ...process.env };
  let now: Date;
  let store: MemorySocialStore;
  let clients: Record<Platform, ReturnType<typeof fakeClient>>;
  let email: { sendEmail: jest.Mock };
  let llm: ReturnType<typeof goodLlm>;
  let articles: Record<string, string>;
  let svc: SocialService;

  function make() {
    svc = new SocialService(llm as never, email as never, {
      store,
      clients,
      now: () => now,
      fetchFn: jest.fn(async () => new Response(JSON.stringify({ data: { is_valid: true, expires_at: 0, scopes: ["pages_manage_posts", "instagram_basic", "instagram_content_publish"] } }), { status: 200 })) as never,
      secretCreatedAt: async () => new Date(now.getTime() - 10 * 86_400_000),
      readQueueObject: async (name: string) => articles[name] ?? null,
    });
  }

  beforeEach(() => {
    process.env = { ...saved };
    process.env.SOCIAL_APPROVAL_SECRET = "a-test-secret-of-enough-length";
    process.env.DAILY_REPORT_EMAIL = "owner@example.org";
    process.env.SOCIAL_PUBLISH_MODE = "live";
    process.env.LINKEDIN_ACCESS_TOKEN = "li";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:1";
    process.env.META_PAGE_ID = "1";
    process.env.META_IG_USER_ID = "2";
    process.env.META_PAGE_ACCESS_TOKEN = "m";
    delete process.env.SOCIAL_X_ENABLED;
    now = new Date("2026-12-01T03:30:00Z");
    store = new MemorySocialStore();
    clients = { linkedin: fakeClient("linkedin"), facebook: fakeClient("facebook"), instagram: fakeClient("instagram"), x: fakeClient("x", false) };
    email = { sendEmail: jest.fn(async () => true) };
    llm = goodLlm();
    articles = {};
    make();
  });
  afterAll(() => { process.env = saved; });

  const approvalEmail = () => email.sendEmail.mock.calls.map((c) => c[0]).find((m) => /For your approval/.test(m.subject));
  const tokenFrom = (html: string) => decodeURIComponent(/[?&]t=([^"&]+)/.exec(html)![1].replace(/&amp;/g, "&"));

  it("uses India's date", () => {
    expect(istDate(new Date("2026-11-30T19:00:00Z"))).toBe("2026-12-01");
  });

  describe("daily tick", () => {
    it("prepares today's calendar item once and emails the owner every platform's exact text", async () => {
      const r1 = await svc.tick();
      expect(r1.prepared).toEqual([{ id: "2026-12-01-first-appointment", status: "awaiting_approval" }]);
      const r2 = await svc.tick();
      expect(r2.prepared).toEqual([{ id: "2026-12-01-first-appointment", status: "exists" }]);

      const mails = email.sendEmail.mock.calls.map((c) => c[0]).filter((m) => /For your approval/.test(m.subject));
      expect(mails).toHaveLength(1);
      expect(mails[0].to).toBe("owner@example.org");
      expect(mails[0].cc).toBeUndefined();
      const item = CALENDAR[0];
      const html: string = mails[0].html;
      for (const p of ["linkedin", "facebook", "instagram"] as const) {
        const firstLine = item.drafts![p].text.split("\n")[0].replace(/'/g, "&#39;");
        expect(html).toContain(firstLine);
      }
      expect(html).toContain('<img src="https://suchitracancercare.org/social/cards/first-appointment.jpg"');
      expect(html).toContain("Nothing is posted from this email");
      // X is switched off, so it is not offered.
      expect((await store.getPost("2026-12-01-first-appointment"))!.value.platforms.x.state).toBe("skipped");
      // Nothing is published by preparing.
      expect(clients.facebook.calls).toHaveLength(0);
    });

    it("offers all four platforms in dry-run mode so the owner can judge every version", async () => {
      process.env.SOCIAL_PUBLISH_MODE = "dry_run";
      await svc.tick();
      const post = (await store.getPost("2026-12-01-first-appointment"))!.value;
      expect(Object.values(post.platforms).map((r) => r.state)).toEqual(["offered", "offered", "offered", "offered"]);
    });

    it("holds the post when no platform is configured in live mode", async () => {
      clients = { linkedin: fakeClient("linkedin", false), facebook: fakeClient("facebook", false), instagram: fakeClient("instagram", false), x: fakeClient("x", false) };
      make();
      await svc.tick();
      expect((await store.getPost("2026-12-01-first-appointment"))!.value.status).toBe("held_for_owner");
      expect(email.sendEmail.mock.calls.some((c) => /Social post held/.test(c[0].subject))).toBe(true);
    });

    it("holds the post when no signing secret is set", async () => {
      delete process.env.SOCIAL_APPROVAL_SECRET;
      delete process.env.CONTENT_APPROVAL_SECRET;
      await svc.tick();
      const post = (await store.getPost("2026-12-01-first-appointment"))!.value;
      expect(post.status).toBe("held_for_owner");
      expect(approvalEmail()).toBeUndefined();
    });

    it("prepares nothing while paused", async () => {
      await store.setPaused(true);
      const r = await svc.tick();
      expect(r.paused).toBe(true);
      expect(r.prepared).toEqual([]);
    });

    it("writes a generated item through the gate and offers it", async () => {
      now = new Date("2026-12-15T03:30:00Z");
      await svc.tick();
      const post = (await store.getPost("2026-12-15-what-suchi-does"))!.value;
      expect(post.status).toBe("awaiting_approval");
      expect(post.platforms.facebook.state).toBe("offered");
      expect(post.platforms.facebook.text).toMatch(/src=social-facebook$/);
      expect(post.platforms.instagram.cardText).toBe(CALENDAR.find((i) => i.date === "2026-12-15")!.card.text);
    });

    it("regenerates a failing draft at most three times, then holds it and never offers it", async () => {
      now = new Date("2026-12-15T03:30:00Z");
      llm.generateRaw.mockImplementation(async () => JSON.stringify({ text: "Did you know? Suchi will empower your cancer journey!" }));
      await svc.tick();
      const post = (await store.getPost("2026-12-15-what-suchi-does"))!.value;
      expect(post.status).toBe("held_for_owner");
      expect(post.platforms.facebook.state).toBe("held");
      expect(post.platforms.facebook.voice!.attempts).toBe(3);
      // 3 offered-in-live platforms x 3 attempts.
      expect(llm.generateRaw).toHaveBeenCalledTimes(9);
      // The regeneration prompt carries the reasons.
      expect(llm.generateRaw.mock.calls[1][1]).toContain("Your last draft broke these rules");
    });
  });

  describe("approval", () => {
    async function prepared() {
      await svc.tick();
      return tokenFrom(approvalEmail()!.html);
    }

    it("shows the review page without changing anything", async () => {
      const t = await prepared();
      const before = await store.getPost("2026-12-01-first-appointment");
      const r = await svc.getForReview("2026-12-01-first-appointment", t);
      expect(r.ok).toBe(true);
      expect((await store.getPost("2026-12-01-first-appointment"))!.version).toBe(before!.version);
      expect(clients.linkedin.calls).toHaveLength(0);
    });

    it("publishes the ticked platforms once, and a second press posts nothing", async () => {
      const t = await prepared();
      const r = await svc.decide("2026-12-01-first-appointment", t, "approve", ["linkedin", "facebook"]);
      expect(r.ok).toBe(true);
      expect(r.results!.map((x) => `${x.platform}:${x.state}`).sort()).toEqual(["facebook:published", "linkedin:published"]);
      expect(clients.facebook.calls).toEqual([CALENDAR[0].drafts!.facebook.text]);
      expect(clients.instagram.calls).toHaveLength(0);
      const post = (await store.getPost("2026-12-01-first-appointment"))!.value;
      expect(post.platforms.instagram.state).toBe("skipped");
      expect(post.platforms.facebook.platformPostId).toBe("facebook-1");

      const again = await svc.decide("2026-12-01-first-appointment", t, "approve", ["linkedin", "facebook", "instagram"]);
      expect(again).toMatchObject({ ok: false, reason: "already_decided" });
      expect(clients.facebook.calls).toHaveLength(1);
      expect(clients.instagram.calls).toHaveLength(0);
      expect(email.sendEmail.mock.calls.some((c) => /Social post sent/.test(c[0].subject))).toBe(true);
    });

    it("handles two simultaneous presses as one", async () => {
      const t = await prepared();
      const [a, b] = await Promise.all([
        svc.decide("2026-12-01-first-appointment", t, "approve", ["facebook"]),
        svc.decide("2026-12-01-first-appointment", t, "approve", ["facebook"]),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect(clients.facebook.calls).toHaveLength(1);
    });

    it("rejects without posting", async () => {
      const t = await prepared();
      const r = await svc.decide("2026-12-01-first-appointment", t, "reject", []);
      expect(r.ok).toBe(true);
      expect((await store.getPost("2026-12-01-first-appointment"))!.value.status).toBe("rejected");
      expect(clients.linkedin.calls).toHaveLength(0);
    });

    it("refuses an expired link and posts nothing", async () => {
      const t = await prepared();
      now = new Date(now.getTime() + 73 * 3600_000);
      expect(await svc.decide("2026-12-01-first-appointment", t, "approve", ["facebook"])).toMatchObject({ ok: false, reason: "expired" });
      expect(clients.facebook.calls).toHaveLength(0);
    });

    it("refuses a forged token", async () => {
      await prepared();
      expect(await svc.decide("2026-12-01-first-appointment", "abc.def", "approve", ["facebook"])).toMatchObject({ ok: false });
      expect(clients.facebook.calls).toHaveLength(0);
    });

    it("asks for at least one platform", async () => {
      const t = await prepared();
      expect(await svc.decide("2026-12-01-first-appointment", t, "approve", [])).toMatchObject({ ok: false, reason: "no_platform_chosen" });
      expect((await svc.getForReview("2026-12-01-first-appointment", t)).ok).toBe(true);
    });

    it("marks an unanswered approval as expired on a later tick", async () => {
      await prepared();
      now = new Date(now.getTime() + 4 * 86_400_000);
      const r = await svc.tick();
      expect(r.expired).toContain("2026-12-01-first-appointment");
    });
  });

  describe("clinical lane", () => {
    it("drafts nothing from an ai_draft article and waits for review", async () => {
      articles["content-drafts/chemotherapy.md"] = ARTICLE("ai_draft");
      const r = await svc.queueFromArticle("chemotherapy", "/tests-treatment/treatments/chemotherapy/");
      expect(r.status).toBe("waiting_for_review");
      expect(await store.listPosts()).toEqual([]);
      expect(llm.generateRaw).not.toHaveBeenCalled();
      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it("switches on for that article on the first tick after it is marked reviewed", async () => {
      articles["content-drafts/chemotherapy.md"] = ARTICLE("ai_draft");
      await svc.queueFromArticle("chemotherapy", "/tests-treatment/treatments/chemotherapy/");
      now = new Date("2026-11-27T03:30:00Z");
      expect((await svc.tick()).prepared).toEqual([]);
      articles["content-drafts/chemotherapy.md"] = ARTICLE("reviewed");
      const r = await svc.tick();
      expect(r.prepared.map((p) => p.id)).toEqual(["article-chemotherapy"]);
      const post = (await store.getPost("article-chemotherapy"))!.value;
      expect(post.lane).toBe("clinical");
      expect(post.article).toEqual({ slug: "chemotherapy", reviewStatus: "reviewed" });
      expect((await svc.tick()).prepared).toEqual([]);
    });
  });

  describe("credentials", () => {
    it("emails the owner once per stage as the LinkedIn token nears expiry", async () => {
      svc = new SocialService(llm as never, email as never, {
        store, clients, now: () => now,
        fetchFn: jest.fn(async () => new Response(JSON.stringify({ data: { is_valid: true, expires_at: 0, scopes: ["pages_manage_posts"] } }), { status: 200 })) as never,
        secretCreatedAt: async () => new Date("2026-10-10T00:00:00Z"),
        readQueueObject: async () => null,
      });
      await store.setPaused(true); // only the token check runs
      const r1 = await svc.tick();
      const li = r1.tokens.find((h) => h.platform === "linkedin")!;
      expect(li.status).toBe("expiring");
      const ig = r1.tokens.find((h) => h.platform === "instagram")!;
      expect(ig.status).toBe("invalid");
      expect(r1.alertsSent).toBe(2);
      const r2 = await svc.tick();
      expect(r2.alertsSent).toBe(0);
      now = new Date("2026-12-06T03:30:00Z");
      const r3 = await svc.tick();
      expect(r3.alertsSent).toBe(1);
      const alerts = email.sendEmail.mock.calls.filter((c) => /credentials need attention/.test(c[0].subject));
      expect(alerts).toHaveLength(2);
      expect(alerts[0][0].html).toContain("LINKEDIN_ORG_POSTING.md");
    });
  });

  describe("preview and records", () => {
    it("renders exactly what would be posted for a date without storing or sending", async () => {
      const out = await svc.preview("2026-12-03");
      expect(out).toHaveLength(1);
      expect((out[0].platforms.facebook as { request: { body: string } }).request.body).toBe(CALENDAR[1].drafts!.facebook.text);
      expect(await store.listPosts()).toEqual([]);
      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it("lists what was posted where and when", async () => {
      await svc.tick();
      const t = tokenFrom(approvalEmail()!.html);
      await svc.decide("2026-12-01-first-appointment", t, "approve", ["facebook"]);
      const rec = await svc.records();
      expect(rec[0]).toMatchObject({ id: "2026-12-01-first-appointment", status: "done" });
      expect((rec[0].platforms as Record<string, { postId?: string; publishedAt?: string }>).facebook).toMatchObject({ postId: "facebook-1", publishedAt: now.toISOString() });
    });
  });
});
