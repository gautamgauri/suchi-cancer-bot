import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { SocialController } from "./social.controller";
import { SchedulerOidcGuard } from "../../common/guards/scheduler-oidc.guard";
import { BasicAuthGuard } from "../../common/guards/basic-auth.guard";

function res() {
  const r = { statusCode: 200, body: "", headers: {} as Record<string, string> } as {
    statusCode: number; body: string; headers: Record<string, string>;
    status: (c: number) => typeof r; send: (b: string) => typeof r; setHeader: (k: string, v: string) => void;
  };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.send = (b: string) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}

const post = {
  id: "p1", title: "A post", lane: "practical", sources: [{ text: "f", url: "https://www.cancer.gov/x", fetchedOn: "2026-11-25" }],
  platforms: {
    linkedin: { state: "offered", text: "LinkedIn <text>", attempts: [] },
    facebook: { state: "offered", text: "Facebook text", attempts: [] },
    instagram: { state: "offered", text: "Caption", cardText: "Card", imageUrl: "https://suchitracancercare.org/social/cards/a.jpg", attempts: [] },
    x: { state: "skipped", text: "", attempts: [] },
  },
};

describe("SocialController", () => {
  it("uses bare paths (the v1 prefix is global)", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SocialController)).toBe("social");
  });

  it("approves only by POST, and the GET route only shows", () => {
    const proto = SocialController.prototype as unknown as Record<string, unknown>;
    expect(Reflect.getMetadata(METHOD_METADATA, proto.review)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, proto.decide)).toBe(RequestMethod.POST);
  });

  it("guards the tick with the scheduler identity and the admin routes with basic auth", () => {
    const proto = SocialController.prototype as unknown as Record<string, unknown>;
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.tick)).toEqual([SchedulerOidcGuard]);
    for (const m of ["preview", "posts", "tokens", "pause", "resume"]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, proto[m])).toEqual([BasicAuthGuard]);
    }
  });

  it("GET shows every platform's text escaped, the card image and a POST form", async () => {
    const svc = { getForReview: jest.fn(async () => ({ ok: true, post })) };
    const c = new SocialController(svc as never);
    const r = res();
    await c.review("p1", "tok", r as never);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('<form method="post"');
    expect(r.body).toContain("LinkedIn &lt;text&gt;");
    expect(r.body).toContain('<img src="https://suchitracancercare.org/social/cards/a.jpg"');
    expect(r.body).toContain('name="platforms" value="facebook" checked');
    expect(r.body).not.toContain('value="x" checked');
    expect(r.headers["Content-Security-Policy"]).toContain("form-action 'self'");
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  it("GET with a bad link explains and posts nothing", async () => {
    const svc = { getForReview: jest.fn(async () => ({ ok: false, reason: "expired" })) };
    const r = res();
    await new SocialController(svc as never).review("p1", "tok", r as never);
    expect(r.body).toContain("expired");
  });

  it("POST passes the token, decision and ticked platforms to the service", async () => {
    const svc = { decide: jest.fn(async () => ({ ok: true, post, results: [{ platform: "facebook", state: "published", permalink: "https://fb/1" }] })) };
    const r = res();
    await new SocialController(svc as never).decide("p1", { t: "tok", decision: "approve", platforms: ["facebook", "bogus"] }, r as never);
    expect(svc.decide).toHaveBeenCalledWith("p1", "tok", "approve", ["facebook"]);
    expect(r.body).toContain("Facebook: posted");
  });

  it("POST without a decision does nothing", async () => {
    const svc = { decide: jest.fn() };
    const r = res();
    await new SocialController(svc as never).decide("p1", { t: "tok" }, r as never);
    expect(r.statusCode).toBe(400);
    expect(svc.decide).not.toHaveBeenCalled();
  });
});
