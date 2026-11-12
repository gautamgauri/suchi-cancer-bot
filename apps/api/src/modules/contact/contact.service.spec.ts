import { HttpException } from "@nestjs/common";
import { EmailService } from "../email/email.service";
import { CONTACT_RATE_LIMITS, ContactRateLimiter } from "./contact-rate-limiter";
import { contactAllowedOrigins, contactClientIp, isContactOriginAllowed } from "./contact-request";
import { ContactService, readContactRecipients } from "./contact.service";

describe("readContactRecipients (recipients come only from env)", () => {
  it("reads To and a Cc list split on commas, semicolons or spaces", () => {
    expect(
      readContactRecipients({ CONTACT_FORM_TO: " inbox@example.org ", CONTACT_FORM_CC: "a@example.org, b@example.org;c@example.org d@example.org" }),
    ).toEqual({ to: "inbox@example.org", cc: ["a@example.org", "b@example.org", "c@example.org", "d@example.org"] });
  });

  it("drops a Cc that repeats the To address", () => {
    expect(readContactRecipients({ CONTACT_FORM_TO: "inbox@example.org", CONTACT_FORM_CC: "INBOX@example.org,a@example.org" })?.cc).toEqual([
      "a@example.org",
    ]);
  });

  it.each([
    [{}],
    [{ CONTACT_FORM_TO: "" }],
    [{ CONTACT_FORM_TO: "two@example.org,three@example.org" }],
    [{ CONTACT_FORM_TO: "Name <inbox@example.org>" }],
    [{ CONTACT_FORM_TO: "inbox@example.org", CONTACT_FORM_CC: "fine@example.org, broken" }],
    [{ CONTACT_FORM_TO: "inbox@example.org\r\nBcc: x@example.org" }],
  ])("fails closed (null) for %j", (env) => {
    expect(readContactRecipients(env as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("ContactRateLimiter", () => {
  it("allows the per-IP limit, blocks the next, and recovers after the window", () => {
    let t = 1_000_000;
    const limiter = new ContactRateLimiter(() => t);
    for (let i = 0; i < CONTACT_RATE_LIMITS.perIp.limit; i++) expect(limiter.tryAttempt("ip")).toBe(true);
    expect(limiter.tryAttempt("ip")).toBe(false);
    expect(limiter.tryAttempt("other-ip")).toBe(true);
    t += CONTACT_RATE_LIMITS.perIp.windowMs;
    expect(limiter.tryAttempt("ip")).toBe(true);
  });

  it("caps total sends across all IPs per window", () => {
    let t = 0;
    const limiter = new ContactRateLimiter(() => t);
    for (let i = 0; i < CONTACT_RATE_LIMITS.globalSends.limit; i++) expect(limiter.tryReserveSend()).toBe(true);
    expect(limiter.tryReserveSend()).toBe(false);
    t += CONTACT_RATE_LIMITS.globalSends.windowMs;
    expect(limiter.tryReserveSend()).toBe(true);
  });
});

describe("ContactService global send budget", () => {
  it("returns 429 once the global budget is spent, without calling the mail service", async () => {
    const email = { isConfigured: () => true, sendEmail: jest.fn().mockResolvedValue(true) } as unknown as EmailService;
    const limiter = new ContactRateLimiter(() => 0);
    const service = new ContactService(email, limiter);
    const env = { ...process.env };
    process.env.CONTACT_FORM_TO = "inbox@example.org";
    try {
      const dto = { name: "A", email: "a@example.org", message: "m", website: "", elapsedMs: 9000 };
      for (let i = 0; i < CONTACT_RATE_LIMITS.globalSends.limit; i++) await service.submit(dto, { requestId: `r${i}` });
      await expect(service.submit(dto, { requestId: "over" })).rejects.toMatchObject({ status: 429 });
      expect((email.sendEmail as jest.Mock).mock.calls).toHaveLength(CONTACT_RATE_LIMITS.globalSends.limit);
    } finally {
      process.env = env;
    }
  });

  it("re-checks line breaks itself even if called without the ValidationPipe", async () => {
    const email = { isConfigured: () => true, sendEmail: jest.fn() } as unknown as EmailService;
    const service = new ContactService(email, new ContactRateLimiter());
    const env = { ...process.env };
    process.env.CONTACT_FORM_TO = "inbox@example.org";
    try {
      const bad = { name: "A\r\nBcc: x@example.org", email: "a@example.org", message: "m", website: "", elapsedMs: 9000 };
      await expect(service.submit(bad, { requestId: "x" })).rejects.toBeInstanceOf(HttpException);
      expect(email.sendEmail).not.toHaveBeenCalled();
    } finally {
      process.env = env;
    }
  });
});

describe("contact request helpers", () => {
  it("allows only the landing origins in production, plus Astro dev servers elsewhere", () => {
    expect(contactAllowedOrigins("production")).toEqual(["https://suchitracancercare.org", "https://www.suchitracancercare.org"]);
    expect(isContactOriginAllowed("http://localhost:4321", "production")).toBe(false);
    expect(isContactOriginAllowed("http://localhost:4321", "development")).toBe(true);
    expect(isContactOriginAllowed(undefined, "development")).toBe(false);
  });

  it("uses the right-most X-Forwarded-For hop, falling back to the socket", () => {
    const req = (xff?: string | string[]) => ({ headers: { "x-forwarded-for": xff }, ip: "127.0.0.9", socket: {} }) as never;
    expect(contactClientIp(req("1.1.1.1, 2.2.2.2"))).toBe("2.2.2.2");
    expect(contactClientIp(req(["1.1.1.1", "3.3.3.3"]))).toBe("3.3.3.3");
    expect(contactClientIp(req(undefined))).toBe("127.0.0.9");
  });
});
