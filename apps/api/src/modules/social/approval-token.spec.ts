import { contentHashOf, signApprovalToken, verifyApprovalToken, parsePlatformSelection, ApprovalSecretMissingError } from "./approval-token";
import { SocialPost } from "./social.types";

function post(text = "Hello."): Pick<SocialPost, "id" | "platforms" | "contentHash"> {
  const p = {
    id: "2026-12-01-first-appointment",
    platforms: {
      linkedin: { state: "offered", text, attempts: [] },
      facebook: { state: "offered", text: "FB", attempts: [] },
      instagram: { state: "offered", text: "IG", cardText: "Card", imageUrl: "https://suchitracancercare.org/social/cards/a.jpg", attempts: [] },
      x: { state: "skipped", text: "", attempts: [] },
    },
    contentHash: "",
  } as unknown as SocialPost;
  p.contentHash = contentHashOf(p);
  return p;
}

describe("approval tokens", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SOCIAL_APPROVAL_SECRET = "test-secret-at-least-sixteen";
    delete process.env.CONTENT_APPROVAL_SECRET;
  });
  afterAll(() => { process.env = saved; });

  const now = new Date("2026-12-01T03:30:00Z");

  it("verifies a fresh token for the same post and content", () => {
    const p = post();
    const { token, expiresAt } = signApprovalToken(p.id, p.contentHash, now);
    expect(expiresAt.toISOString()).toBe("2026-12-04T03:30:00.000Z");
    expect(verifyApprovalToken(token, p, now).ok).toBe(true);
  });

  it("refuses an expired token", () => {
    const p = post();
    const { token } = signApprovalToken(p.id, p.contentHash, now);
    expect(verifyApprovalToken(token, p, new Date("2026-12-04T03:30:01Z")).reason).toBe("expired");
  });

  it("refuses a token for another post", () => {
    const p = post();
    const { token } = signApprovalToken("another-post", p.contentHash, now);
    expect(verifyApprovalToken(token, p, now).reason).toBe("wrong_post");
  });

  it("refuses a token when the text changed after it was issued", () => {
    const p = post();
    const { token } = signApprovalToken(p.id, p.contentHash, now);
    const changed = post("Changed.");
    expect(verifyApprovalToken(token, changed, now).reason).toBe("content_changed");
  });

  it("refuses a tampered payload or signature", () => {
    const p = post();
    const { token } = signApprovalToken(p.id, p.contentHash, now);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: p.id, h: p.contentHash, e: 9999999999, n: "x" })).toString("base64url");
    expect(verifyApprovalToken(`${forged}.${sig}`, p, now).reason).toBe("bad_signature");
    expect(verifyApprovalToken(`${payload}.${sig.slice(0, -2)}AA`, p, now).ok).toBe(false);
    expect(verifyApprovalToken("garbage", p, now).reason).toBe("malformed");
    expect(verifyApprovalToken(undefined, p, now).reason).toBe("malformed");
  });

  it("refuses a token signed with another secret", () => {
    const p = post();
    const { token } = signApprovalToken(p.id, p.contentHash, now);
    process.env.SOCIAL_APPROVAL_SECRET = "a-different-secret-value";
    expect(verifyApprovalToken(token, p, now).reason).toBe("bad_signature");
  });

  it("has no built-in fallback secret", () => {
    delete process.env.SOCIAL_APPROVAL_SECRET;
    const p = post();
    expect(() => signApprovalToken(p.id, p.contentHash, now)).toThrow(ApprovalSecretMissingError);
    expect(verifyApprovalToken("a.b", p, now).reason).toBe("no_secret");
  });

  it("uses CONTENT_APPROVAL_SECRET when no social secret is set", () => {
    delete process.env.SOCIAL_APPROVAL_SECRET;
    process.env.CONTENT_APPROVAL_SECRET = "content-secret-long-enough";
    const p = post();
    const { token } = signApprovalToken(p.id, p.contentHash, now);
    expect(verifyApprovalToken(token, p, now).ok).toBe(true);
  });

  it("hashes only offered platforms, including the image", () => {
    const a = post();
    const b = post();
    b.platforms.instagram.imageUrl = "https://suchitracancercare.org/social/cards/b.jpg";
    expect(contentHashOf(b)).not.toBe(a.contentHash);
    const c = post();
    c.platforms.x.text = "anything";
    expect(contentHashOf(c)).toBe(a.contentHash);
  });

  it("parses the platform checkboxes and ignores anything else", () => {
    expect(parsePlatformSelection(["linkedin", "x", "myspace", "x"])).toEqual(["linkedin", "x"]);
    expect(parsePlatformSelection("facebook")).toEqual(["facebook"]);
    expect(parsePlatformSelection(undefined)).toEqual([]);
  });
});
