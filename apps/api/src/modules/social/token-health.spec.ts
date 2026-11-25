import { checkLinkedIn, checkMeta, checkX, warningStage, needsAlert } from "./token-health";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

const now = new Date("2026-12-01T00:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("LinkedIn token age", () => {
  beforeEach(() => { process.env.LINKEDIN_ACCESS_TOKEN = "x"; process.env.LINKEDIN_AUTHOR_URN = "urn:li:organization:1"; });

  it("is fine early in its 60 days", async () => {
    expect((await checkLinkedIn(async () => days(10), now)).status).toBe("ok");
  });

  it("warns from 14 days before expiry, in stages", async () => {
    const a = await checkLinkedIn(async () => days(47), now);
    expect(a).toMatchObject({ status: "expiring", daysLeft: 13 });
    const b = await checkLinkedIn(async () => days(54), now);
    expect(b.alertKey).not.toBe(a.alertKey);
    expect(warningStage(13)).toBe(14);
    expect(warningStage(6)).toBe(7);
    expect(warningStage(20)).toBeNull();
  });

  it("reports expiry after 60 days", async () => {
    expect((await checkLinkedIn(async () => days(61), now)).status).toBe("expired");
  });

  it("says how to make the age readable when it cannot be read", async () => {
    const h = await checkLinkedIn(async () => null, now);
    expect(h.status).toBe("unknown");
    expect(h.detail).toContain("roles/secretmanager.viewer");
    expect(needsAlert(h)).toBe(true);
  });

  it("reports missing credentials", async () => {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    expect((await checkLinkedIn(async () => days(1), now)).status).toBe("missing");
  });
});

describe("Meta token", () => {
  beforeEach(() => { process.env.META_PAGE_ACCESS_TOKEN = "m"; process.env.META_PAGE_ID = "1"; process.env.META_IG_USER_ID = "2"; });
  const debug = (data: unknown, status = 200) => jest.fn(async () => new Response(JSON.stringify({ data }), { status })) as never;

  it("is fine for a never-expiring Page token with both permissions", async () => {
    const r = await checkMeta(debug({ is_valid: true, expires_at: 0, scopes: ["pages_manage_posts", "instagram_basic", "instagram_content_publish"] }), now);
    expect(r.map((h) => h.status)).toEqual(["ok", "ok"]);
  });

  it("flags a token that cannot publish to Instagram", async () => {
    const r = await checkMeta(debug({ is_valid: true, expires_at: 0, scopes: ["pages_manage_posts"] }), now);
    expect(r[1]).toMatchObject({ platform: "instagram", status: "invalid" });
    expect(r[1].detail).toContain("instagram_content_publish");
  });

  it("flags an invalid token and a dated expiry", async () => {
    expect((await checkMeta(debug({ is_valid: false, scopes: [] }), now))[0].status).toBe("invalid");
    const soon = Math.floor((now.getTime() + 5 * 86_400_000) / 1000);
    expect((await checkMeta(debug({ is_valid: true, expires_at: soon, scopes: ["pages_manage_posts"] }), now))[0].status).toBe("expiring");
  });
});

describe("X", () => {
  it("is off by default and needs all four keys when on", () => {
    delete process.env.SOCIAL_X_ENABLED;
    expect(checkX().status).toBe("off");
    process.env.SOCIAL_X_ENABLED = "true";
    expect(checkX().status).toBe("missing");
    expect(needsAlert(checkX())).toBe(true);
    Object.assign(process.env, { X_API_KEY: "a", X_API_SECRET: "b", X_ACCESS_TOKEN: "c", X_ACCESS_TOKEN_SECRET: "d" });
    expect(checkX().status).toBe("ok");
  });
});
