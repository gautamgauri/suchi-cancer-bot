import { FacebookClient, InstagramClient } from "./meta.clients";
import { LinkedInClient, XClient, oauth1Signature, oauth1Header, escapeLittleText, X_POSTS_URL, LINKEDIN_POSTS_URL } from "./linkedin-x.clients";
import { httpOutcome, networkOutcome } from "./platform-client";

type Call = { url: string; init?: RequestInit };

function mockFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("unexpected call");
    if (r instanceof Error) throw r;
    return r;
  });
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("outcome rules", () => {
  it("retries only what certainly did not post", () => {
    expect(httpOutcome(429, "slow down")).toMatchObject({ kind: "rejected", retryable: true });
    expect(httpOutcome(400, "bad")).toMatchObject({ kind: "rejected", retryable: false });
    expect(httpOutcome(401, "expired")).toMatchObject({ kind: "rejected", retryable: false, tokenProblem: true });
    expect(httpOutcome(503, "down")).toMatchObject({ kind: "uncertain" });
    expect(networkOutcome(Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }))).toMatchObject({ kind: "rejected", retryable: true });
    expect(networkOutcome(Object.assign(new Error("aborted"), { name: "AbortError" }))).toMatchObject({ kind: "uncertain" });
    expect(networkOutcome(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toMatchObject({ kind: "uncertain" });
  });
});

describe("FacebookClient", () => {
  beforeEach(() => { process.env.META_PAGE_ID = "104"; process.env.META_PAGE_ACCESS_TOKEN = "tok"; });

  it("posts the message to the Page feed and returns the post id and permalink", async () => {
    const { fn, calls } = mockFetch([json(200, { id: "104_999" })]);
    const out = await new FacebookClient(fn).publish({ text: "Hello." });
    expect(out).toMatchObject({ kind: "published", postId: "104_999", permalink: "https://www.facebook.com/104/posts/999" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/104/feed");
    const body = new URLSearchParams(String(calls[0].init!.body));
    expect(body.get("message")).toBe("Hello.");
  });

  it("reports an invalid token (code 190) as a token problem", async () => {
    const { fn } = mockFetch([json(400, { error: { message: "Session has expired", code: 190 } })]);
    expect(await new FacebookClient(fn).publish({ text: "x" })).toMatchObject({ kind: "rejected", retryable: false, tokenProblem: true });
  });

  it("is not configured without credentials and makes no call", async () => {
    delete process.env.META_PAGE_ACCESS_TOKEN;
    const { fn } = mockFetch([]);
    expect(await new FacebookClient(fn).publish({ text: "x" })).toMatchObject({ kind: "not_configured" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("renders without the token", () => {
    expect(JSON.stringify(new FacebookClient().render({ text: "x" }))).not.toContain("tok");
  });
});

describe("InstagramClient", () => {
  beforeEach(() => { process.env.META_IG_USER_ID = "178"; process.env.META_PAGE_ACCESS_TOKEN = "tok"; });
  const sleep = async () => undefined;

  it("creates a container, waits for it, then publishes", async () => {
    const { fn, calls } = mockFetch([json(200, { id: "c1" }), json(200, { status_code: "FINISHED" }), json(200, { id: "m1" })]);
    const out = await new InstagramClient(fn, sleep).publish({ text: "Caption.", imageUrl: "https://suchitracancercare.org/social/cards/a.jpg" });
    expect(out).toMatchObject({ kind: "published", postId: "m1" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/178/media");
    expect(new URLSearchParams(String(calls[0].init!.body)).get("image_url")).toBe("https://suchitracancercare.org/social/cards/a.jpg");
    expect(calls[2].url).toBe("https://graph.facebook.com/v21.0/178/media_publish");
    expect(new URLSearchParams(String(calls[2].init!.body)).get("creation_id")).toBe("c1");
  });

  it("refuses a PNG before calling, because the API takes JPEG only", async () => {
    const { fn } = mockFetch([]);
    expect(await new InstagramClient(fn, sleep).publish({ text: "x", imageUrl: "https://a.org/card.png" })).toMatchObject({ kind: "rejected", retryable: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it("treats a failed container as safe to retry", async () => {
    const { fn } = mockFetch([json(500, { error: { message: "oops" } })]);
    expect(await new InstagramClient(fn, sleep).publish({ text: "x", imageUrl: "https://a.org/c.jpg" })).toMatchObject({ kind: "rejected", retryable: true });
  });

  it("treats a timeout on the publish step as uncertain", async () => {
    const { fn } = mockFetch([json(200, { id: "c1" }), json(200, { status_code: "FINISHED" }), Object.assign(new Error("aborted"), { name: "AbortError" })]);
    expect(await new InstagramClient(fn, sleep).publish({ text: "x", imageUrl: "https://a.org/c.jpg" })).toMatchObject({ kind: "uncertain" });
  });
});

describe("LinkedInClient", () => {
  beforeEach(() => { process.env.LINKEDIN_ACCESS_TOKEN = "li"; process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:42"; });

  it("posts to the versioned Posts API as the organisation with escaped commentary", async () => {
    const { fn, calls } = mockFetch([new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:7" } })]);
    const out = await new LinkedInClient(fn).publish({ text: "Read (this) #now" });
    expect(out).toMatchObject({ kind: "published", postId: "urn:li:share:7", permalink: "https://www.linkedin.com/feed/update/urn:li:share:7/" });
    expect(calls[0].url).toBe(LINKEDIN_POSTS_URL);
    const h = calls[0].init!.headers as Record<string, string>;
    expect(h["LinkedIn-Version"]).toMatch(/^\d{6}$/);
    expect(h["X-Restli-Protocol-Version"]).toBe("2.0.0");
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body.author).toBe("urn:li:organization:42");
    expect(body.commentary).toBe("Read \\(this\\) \\#now");
  });

  it("marks a 401 as a token problem pointing at the runbook", async () => {
    const { fn } = mockFetch([new Response("expired", { status: 401 })]);
    const out = await new LinkedInClient(fn).publish({ text: "x" });
    expect(out).toMatchObject({ kind: "rejected", tokenProblem: true });
    expect((out as { error: string }).error).toContain("LINKEDIN_ORG_POSTING.md");
  });

  it("refuses a malformed author URN without calling", async () => {
    process.env.LINKEDIN_AUTHOR_URN = "12345";
    const { fn } = mockFetch([]);
    expect(await new LinkedInClient(fn).publish({ text: "x" })).toMatchObject({ kind: "not_configured" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("escapes every little-text reserved character", () => {
    expect(escapeLittleText("\\|{}@[]()<>#*_~")).toBe("\\\\\\|\\{\\}\\@\\[\\]\\(\\)\\<\\>\\#\\*\\_\\~");
  });
});

describe("X client", () => {
  it("matches the worked OAuth 1.0a signature on docs.x.com", () => {
    const oauth = {
      oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
      oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1318622958",
      oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      oauth_version: "1.0",
    };
    const params = { include_entities: "true", status: "Hello Ladies + Gentlemen, a signed OAuth request!" };
    const cs = "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw";
    const ts = "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE";
    expect(oauth1Signature("POST", "https://api.x.com/1.1/statuses/update.json", oauth, params, cs, ts)).toBe("Ls93hJiZbQ3akF3HF3x1Bz8/zU4=");
    // The same example on the older twitter.com host, as published for years.
    expect(oauth1Signature("POST", "https://api.twitter.com/1.1/statuses/update.json", oauth, params, cs, ts)).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("builds an Authorization header with all OAuth fields", () => {
    const h = oauth1Header("POST", X_POSTS_URL, { consumerKey: "ck", consumerSecret: "cs", token: "t", tokenSecret: "ts" }, 1_700_000_000_000, "nonce");
    expect(h).toMatch(/^OAuth /);
    for (const k of ["oauth_consumer_key=\"ck\"", "oauth_nonce=\"nonce\"", "oauth_signature_method=\"HMAC-SHA1\"", "oauth_timestamp=\"1700000000\"", "oauth_token=\"t\"", "oauth_version=\"1.0\"", "oauth_signature="]) {
      expect(h).toContain(k);
    }
  });

  const keys = () => {
    process.env.X_API_KEY = "ck"; process.env.X_API_SECRET = "cs"; process.env.X_ACCESS_TOKEN = "t"; process.env.X_ACCESS_TOKEN_SECRET = "ts";
  };

  it("is off unless the flag is on, even with keys", async () => {
    keys();
    delete process.env.SOCIAL_X_ENABLED;
    const { fn } = mockFetch([]);
    const c = new XClient(fn);
    expect(c.isConfigured()).toBe(false);
    expect(await c.publish({ text: "x" })).toMatchObject({ kind: "not_configured" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("needs all four keys when switched on", async () => {
    process.env.SOCIAL_X_ENABLED = "true";
    process.env.X_API_KEY = "ck";
    const { fn } = mockFetch([]);
    expect(await new XClient(fn).publish({ text: "x" })).toMatchObject({ kind: "not_configured" });
  });

  it("posts JSON text to /2/tweets with an OAuth 1.0a header and reads data.id", async () => {
    keys();
    process.env.SOCIAL_X_ENABLED = "true";
    const { fn, calls } = mockFetch([json(201, { data: { id: "1855", text: "Hello." } })]);
    const out = await new XClient(fn).publish({ text: "Hello." });
    expect(out).toMatchObject({ kind: "published", postId: "1855", permalink: "https://x.com/i/web/status/1855" });
    expect(calls[0].url).toBe("https://api.x.com/2/tweets");
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ text: "Hello." });
    expect((calls[0].init!.headers as Record<string, string>).Authorization).toMatch(/^OAuth oauth_consumer_key="ck"/);
  });

  it("maps 429 to a retry and 401 to a token problem", async () => {
    keys();
    process.env.SOCIAL_X_ENABLED = "true";
    const a = mockFetch([json(429, { title: "Too Many Requests" })]);
    expect(await new XClient(a.fn).publish({ text: "x" })).toMatchObject({ kind: "rejected", retryable: true });
    const b = mockFetch([json(401, { title: "Unauthorized" })]);
    expect(await new XClient(b.fn).publish({ text: "x" })).toMatchObject({ kind: "rejected", tokenProblem: true });
    const c = mockFetch([json(403, { detail: "You are not allowed to create a Tweet with duplicate content." })]);
    expect(await new XClient(c.fn).publish({ text: "x" })).toMatchObject({ kind: "rejected", retryable: false });
  });
});
