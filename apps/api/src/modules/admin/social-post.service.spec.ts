/**
 * Unit tests for SocialPostService — the social-post safety gate.
 *
 * Safety-critical contract (FR-SOCIAL-013 / FR-SAFETY-006, OD-004):
 * a draft flagged `safetyBlocked` must NEVER publish, regardless of reviewer
 * action. `approvePost()` must throw ForbiddenException and not mutate the
 * queue or call any platform API.
 *
 * GCS is avoided by spying on the private loadQueue/saveQueue; LlmService and
 * EmailService are stubbed (no network).
 */

import { ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { SocialPostService, escapeLittleText } from "./social-post.service";

jest.mock("@google-cloud/storage", () => ({ Storage: jest.fn() }));

type Platform = "facebook" | "instagram" | "linkedin";

interface Draft {
  id: string;
  slug: string;
  title: string;
  contentType: string;
  articleUrl: string;
  copy: Record<Platform, string>;
  status: string;
  approvalToken?: string;
  createdAt: string;
  safetyWarnings?: string[];
  safetyBlocked?: boolean;
  approvedBy?: string;
  rejectedBy?: string;
  approvedPlatforms?: Platform[];
}

const ID = "post-123";
const TITLE = "Test Social Post";

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: ID,
    slug: "test-slug",
    title: TITLE,
    contentType: "treatment",
    articleUrl: "https://suchitracancercare.org/x",
    copy: { facebook: "fb", instagram: "ig", linkedin: "li" },
    status: "sent_for_approval",
    createdAt: "2026-06-01T00:00:00.000Z",
    safetyBlocked: false,
    ...overrides,
  };
}

describe("SocialPostService — safety gate", () => {
  let service: SocialPostService;
  let saveQueueSpy: jest.SpyInstance;
  let validToken: string;

  const llmStub = {} as never;
  const sendEmail = jest.fn().mockResolvedValue(undefined);
  const emailStub = { sendEmail } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialPostService(llmStub, emailStub);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    saveQueueSpy = jest.spyOn(service as any, "saveQueue").mockResolvedValue(undefined);
    // No platforms configured → no network calls on the happy path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, "resolvePlatforms").mockReturnValue([]);
    // confirmation email is fire-and-forget; stub to a no-op promise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, "sendConfirmationEmail").mockResolvedValue(undefined);

    // Generate a token the service itself accepts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validToken = (service as any).buildToken(ID);
  });

  function stubQueue(draft: Draft) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(service as any, "loadQueue").mockResolvedValue({ posts: [draft] });
  }

  // ── Hard block ────────────────────────────────────────────────────────────

  describe("approvePost — hard block (FR-SOCIAL-013)", () => {
    it("throws ForbiddenException and does NOT publish a safetyBlocked draft", async () => {
      const draft = makeDraft({ safetyBlocked: true, safetyWarnings: ["cure claim"] });
      stubQueue(draft);

      await expect(service.approvePost(ID, validToken)).rejects.toThrow(ForbiddenException);

      // The queue must not be mutated and status must remain unpublished.
      expect(saveQueueSpy).not.toHaveBeenCalled();
      expect(draft.status).toBe("sent_for_approval");
    });

    it("allows a non-blocked draft past the gate and marks it published", async () => {
      const draft = makeDraft({ safetyBlocked: false });
      stubQueue(draft);

      const result = await service.approvePost(ID, validToken, undefined, "Gautam");

      expect(result.title).toBe(TITLE);
      expect(saveQueueSpy).toHaveBeenCalledTimes(1);
      expect(draft.status).toBe("published");
      expect(draft.approvedBy).toBe("Gautam");
    });
  });

  // ── Idempotency (FR-SOCIAL-007) ─────────────────────────────────────────────

  describe("approvePost — idempotency", () => {
    it.each(["published", "rejected"])(
      "returns early without throwing or re-saving when already %s",
      async (status) => {
        const draft = makeDraft({ status, approvedBy: "Divya", approvedPlatforms: ["facebook"] });
        stubQueue(draft);

        const result = await service.approvePost(ID, validToken, undefined, "Nisha");

        expect(result.title).toBe(TITLE);
        expect(saveQueueSpy).not.toHaveBeenCalled();
      },
    );

    it("blocks a safetyBlocked draft even if a duplicate click arrives (block before publish-state check passes)", async () => {
      // status still sent_for_approval but blocked — must throw, not publish
      const draft = makeDraft({ safetyBlocked: true });
      stubQueue(draft);
      await expect(service.approvePost(ID, validToken)).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Configured-platform omission (FR-SOCIAL-006, OD-008) ────────────────────

  describe("sendApprovalEmail — platform button omission", () => {
    const PLATFORM_ENV = [
      "META_PAGE_ID",
      "META_PAGE_ACCESS_TOKEN",
      "META_IG_USER_ID",
      "LINKEDIN_ACCESS_TOKEN",
      "LINKEDIN_AUTHOR_URN",
    ];
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = {};
      for (const k of PLATFORM_ENV) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(() => {
      for (const k of PLATFORM_ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    async function firstEmailHtml(draft: Draft): Promise<string> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).sendApprovalEmail(draft);
      return sendEmail.mock.calls[0][0].html as string;
    }

    it("shows only the Facebook button when only Facebook is configured", async () => {
      process.env.META_PAGE_ID = "page-1";
      process.env.META_PAGE_ACCESS_TOKEN = "tok-1";

      const html = await firstEmailHtml(makeDraft());

      expect(html).toContain("Facebook only");
      expect(html).not.toContain("Instagram only");
      expect(html).not.toContain("LinkedIn only");
      // Single platform → no "Approve all" button
      expect(html).not.toContain("Approve all");
    });

    it("shows all buttons and an 'Approve all (3 platforms)' button when all are configured", async () => {
      process.env.META_PAGE_ID = "page-1";
      process.env.META_PAGE_ACCESS_TOKEN = "tok-1";
      process.env.META_IG_USER_ID = "ig-1";
      process.env.LINKEDIN_ACCESS_TOKEN = "li-tok";
      process.env.LINKEDIN_AUTHOR_URN = "urn:li:person:1";

      const html = await firstEmailHtml(makeDraft());

      expect(html).toContain("Facebook only");
      expect(html).toContain("Instagram only");
      expect(html).toContain("LinkedIn only");
      expect(html).toContain("Approve all (3 platforms)");
    });

    it("omits all approve buttons and shows a HARD BLOCK banner for a blocked draft", async () => {
      process.env.META_PAGE_ID = "page-1";
      process.env.META_PAGE_ACCESS_TOKEN = "tok-1";

      const html = await firstEmailHtml(makeDraft({ safetyBlocked: true, safetyWarnings: ["cure claim"] }));

      expect(html).toContain("HARD BLOCK");
      expect(html).not.toContain("Facebook only");
      expect(html).not.toContain("Approve all");
    });
  });

  // ── Auth + lookup guards ────────────────────────────────────────────────────

  describe("approvePost — guards", () => {
    it("throws UnauthorizedException on a bad token", async () => {
      stubQueue(makeDraft());
      await expect(service.approvePost(ID, "deadbeef")).rejects.toThrow(UnauthorizedException);
    });

    it("throws NotFoundException when the post id is not in the queue", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jest.spyOn(service as any, "loadQueue").mockResolvedValue({ posts: [] });
      await expect(service.approvePost(ID, validToken)).rejects.toThrow(NotFoundException);
    });
  });
});

// ── LinkedIn organisation posting (issue #27) ───────────────────────────────

describe("SocialPostService — LinkedIn org posting", () => {
  let service: SocialPostService;
  const llmStub = {} as never;
  const emailStub = { sendEmail: jest.fn().mockResolvedValue(undefined) } as never;

  const SAVED: Record<string, string | undefined> = {};
  const KEYS = ["LINKEDIN_ACCESS_TOKEN", "LINKEDIN_AUTHOR_URN"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callPost = (text = "Hello", url = "https://suchitracancercare.org/a", title = "T"): Promise<any> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).postLinkedIn(text, url, title);

  function stubFetch(init: { ok: boolean; status: number; headers?: Record<string, string>; text?: string }) {
    const fn = jest.fn().mockResolvedValue({
      ok: init.ok,
      status: init.status,
      headers: { get: (h: string) => (init.headers ?? {})[h.toLowerCase()] ?? null },
      text: async () => init.text ?? "",
    });
    (global as unknown as { fetch: unknown }).fetch = fn;
    return fn;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SocialPostService(llmStub, emailStub);
    for (const k of KEYS) { SAVED[k] = process.env[k]; delete process.env[k]; }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (SAVED[k] === undefined) delete process.env[k];
      else process.env[k] = SAVED[k];
    }
    delete (global as unknown as { fetch?: unknown }).fetch;
  });

  it("returns not_configured and makes no network call when credentials are absent", async () => {
    const fetchSpy = stubFetch({ ok: true, status: 201 });
    const res = await callPost();
    expect(res).toEqual({ success: false, error: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the versioned Posts API with an organization author and the required headers", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "tok";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:71580340";
    const fetchSpy = stubFetch({ ok: true, status: 201, headers: { "x-restli-id": "urn:li:share:99" } });

    const res = await callPost("Read our new guide", "https://suchitracancercare.org/x", "Chemotherapy");

    expect(res).toEqual({ success: true, postId: "urn:li:share:99" });
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.linkedin.com/rest/posts");
    // Versioned REST API — NOT the deprecated /v2/ugcPosts endpoint.
    expect(url).not.toContain("ugcPosts");
    expect(opts.headers["Authorization"]).toBe("Bearer tok");
    expect(opts.headers["X-Restli-Protocol-Version"]).toBe("2.0.0");
    expect(opts.headers["LinkedIn-Version"]).toMatch(/^20\d{4}$/);

    const body = JSON.parse(opts.body);
    expect(body.author).toBe("urn:li:organization:71580340");
    expect(body.commentary).toContain("Read our new guide");
    expect(body.visibility).toBe("PUBLIC");
    expect(body.distribution.feedDistribution).toBe("MAIN_FEED");
    expect(body.content.article.source).toBe("https://suchitracancercare.org/x");
    expect(body.content.article.title).toBe("Chemotherapy");
    expect(body.lifecycleState).toBe("PUBLISHED");
    // ugcPosts-era fields must be gone
    expect(body.specificContent).toBeUndefined();
  });

  it("logs a clear 'token expired' error pointing at the runbook on a 401", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "expired";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:1";
    stubFetch({ ok: false, status: 401, text: '{"message":"Empty oauth2 access token"}' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logSpy = jest.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

    const res = await callPost();

    expect(res.success).toBe(false);
    expect(res.error).toContain("token_expired");
    expect(res.error).toContain("docs/LINKEDIN_ORG_POSTING.md");
    const logged = logSpy.mock.calls[0][0] as string;
    expect(logged).toContain("401");
    expect(logged).toContain("expired");
    expect(logged).toContain("docs/LINKEDIN_ORG_POSTING.md");
  });

  it("explains a 403 as a missing w_organization_social scope or page-admin role", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "tok";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:1";
    stubFetch({ ok: false, status: 403, text: "ACCESS_DENIED" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

    const res = await callPost();

    expect(res.success).toBe(false);
    expect(res.error).toContain("insufficient_permissions");
  });

  it("rejects a malformed author URN before calling the API", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "tok";
    process.env.LINKEDIN_AUTHOR_URN = "71580340"; // bare org id, missing the urn prefix
    const fetchSpy = stubFetch({ ok: true, status: 201 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

    const res = await callPost();

    expect(res).toEqual({ success: false, error: "invalid_author_urn" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when fetch rejects (network error)", async () => {
    process.env.LINKEDIN_ACCESS_TOKEN = "tok";
    process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:1";
    (global as unknown as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn((service as any).logger, "error").mockImplementation(() => undefined);

    const res = await callPost();

    expect(res.success).toBe(false);
    expect(res.error).toContain("ECONNRESET");
  });
});

describe("escapeLittleText", () => {
  it("escapes every reserved little-text character", async () => {
    expect(escapeLittleText("(SCCF) #cancer @page [x] {y} <z> a|b c*d e_f g~h i\\j"))
      .toBe("\\(SCCF\\) \\#cancer \\@page \\[x\\] \\{y\\} \\<z\\> a\\|b c\\*d e\\_f g\\~h i\\\\j");
  });

  it("leaves ordinary prose and URLs untouched", () => {
    const plain = "Cancer care in Bihar: read more at https://suchitracancercare.org/x-y";
    expect(escapeLittleText(plain)).toBe(plain);
  });
});
