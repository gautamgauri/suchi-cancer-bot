/**
 * HTTP tests for POST /v1/contact: a real Nest app on a random local port with
 * the same global prefix, ValidationPipe and CORS delegate as main.ts. The
 * real EmailService runs; only nodemailer's transport is mocked, so nothing is
 * ever sent and the logging assertions cover EmailService too.
 * All addresses are example.org placeholders.
 */
jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

import { INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as nodemailer from "nodemailer";
import { EmailService } from "../email/email.service";
import { CONTACT_MAX_BODY_BYTES } from "./contact.controller";
import { ContactModule } from "./contact.module";
import { CONTACT_RATE_LIMITS } from "./contact-rate-limiter";
import { corsOptionsDelegate } from "./contact-request";

const ORIGIN = "https://suchitracancercare.org";
const TO = "inbox@example.org";
const CC = "staff-one@example.org; staff-two@example.org";

// Distinctive values so any leak into a log line is easy to detect.
const SECRET_NAME = "Visitor-Name-XYZZY";
const SECRET_EMAIL = "visitor-xyzzy@example.org";
const SECRET_MESSAGE = "My mother has stage-two symptoms XYZZY, please advise";

const sendMail = jest.fn();
let app: INestApplication;
let baseUrl: string;
let logLines: string[];
let ipCounter = 0;

function validBody(overrides: Record<string, unknown> = {}) {
  return { name: SECRET_NAME, email: SECRET_EMAIL, message: SECRET_MESSAGE, website: "", elapsedMs: 12000, ...overrides };
}

async function post(body: unknown, opts: { origin?: string | null; ip?: string; raw?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // A fresh client IP per request unless a test pins one, so the per-IP limit stays out of the way.
    "x-forwarded-for": opts.ip ?? `198.51.100.${++ipCounter % 250}`,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const res = await fetch(`${baseUrl}/v1/contact`, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

async function startApp() {
  const moduleRef = await Test.createTestingModule({ imports: [ContactModule] }).compile();
  app = moduleRef.createNestApplication({ cors: corsOptionsDelegate, logger: false });
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  baseUrl = (await app.getUrl()).replace("[::1]", "127.0.0.1");
}

function captureLogs() {
  logLines = [];
  const record = (...args: unknown[]) => {
    logLines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
  };
  for (const method of ["log", "error", "warn", "debug", "verbose", "fatal"] as const) {
    jest.spyOn(Logger.prototype, method).mockImplementation(record as never);
    jest.spyOn(Logger, method as "log").mockImplementation(record as never);
  }
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    jest.spyOn(console, method).mockImplementation(record);
  }
}

function expectNoVisitorDataInLogs() {
  const all = logLines.join("\n");
  expect(all).not.toContain(SECRET_NAME);
  expect(all).not.toContain(SECRET_EMAIL);
  expect(all).not.toContain("XYZZY");
}

beforeEach(async () => {
  jest.restoreAllMocks();
  sendMail.mockReset().mockResolvedValue({ messageId: "<test@example.org>" });
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  process.env.SMTP_HOST = "smtp.example.org";
  process.env.SMTP_USER = "sender@example.org";
  process.env.SMTP_PASS = "not-a-real-password";
  delete process.env.SMTP_FROM;
  process.env.CONTACT_FORM_TO = TO;
  process.env.CONTACT_FORM_CC = CC;
  process.env.NODE_ENV = "test";
  captureLogs();
  await startApp();
});

afterEach(async () => {
  await app?.close();
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "CONTACT_FORM_TO", "CONTACT_FORM_CC"]) delete process.env[k];
});

describe("POST /v1/contact: delivery", () => {
  it("sends ONE email To/Cc from env with Reply-To the visitor, and returns 200", async () => {
    const sendSpy = jest.spyOn(EmailService.prototype, "sendEmail");
    const res = await post(validBody());

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, requestId: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.to).toBe(TO);
    expect(mail.cc).toBe("staff-one@example.org, staff-two@example.org");
    expect(mail.replyTo).toBe(SECRET_EMAIL);
    expect(mail.html).toBeUndefined();
    expect(mail.subject).toBe(`Website contact form message [${res.json.requestId}]`);
    expect(mail.subject).not.toContain(SECRET_NAME);
    expect(mail.text).toContain(`Name: ${SECRET_NAME}`);
    expect(mail.text).toContain(SECRET_MESSAGE);
  });

  it("never takes recipients from the request (extra fields are rejected, nothing sent)", async () => {
    for (const extra of [{ to: "attacker@example.org" }, { cc: "attacker@example.org" }, { bcc: "attacker@example.org" }, { replyTo: "x@example.org" }]) {
      const res = await post(validBody(extra));
      expect(res.status).toBe(400);
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not send an auto-reply or any mail to the visitor's address", async () => {
    await post(validBody());
    for (const [mail] of sendMail.mock.calls) {
      expect([mail.to, mail.cc, mail.bcc].join(" ")).not.toContain(SECRET_EMAIL);
    }
  });
});

describe("POST /v1/contact: validation and header injection", () => {
  it.each([
    ["CRLF in name", { name: "Ann\r\nBcc: victim@example.org" }],
    ["LF in name", { name: "Ann\nX" }],
    ["CRLF in email", { email: "a@example.org\r\nBcc: victim@example.org" }],
    ["Unicode line separator in name", { name: "Ann Bcc" }],
    ["invalid email", { email: "not-an-email" }],
    ["two addresses in email", { email: "a@example.org, b@example.org" }],
    ["empty name", { name: "" }],
    ["empty message", { message: "" }],
    ["name over 100 chars", { name: "n".repeat(101) }],
    ["email over 254 chars", { email: `${"a".repeat(250)}@example.org` }],
    ["message over 5000 chars", { message: "m".repeat(5001) }],
    ["missing elapsedMs", { elapsedMs: undefined }],
    ["non-numeric elapsedMs", { elapsedMs: "soon" }],
  ])("rejects %s with 400 and sends nothing", async (_label, overrides) => {
    const res = await post(validBody(overrides));
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only name or message (service-level check)", async () => {
    expect((await post(validBody({ name: "   " }))).status).toBe(400);
    expect((await post(validBody({ message: " \n\t " }))).status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("accepts a multi-line message and a 5000-character Hindi message", async () => {
    expect((await post(validBody({ message: "line one\nline two" }))).status).toBe(200);
    expect((await post(validBody({ message: "क".repeat(5000) }))).status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("caps the body size before validation (413)", async () => {
    const padded = JSON.stringify(validBody()).replace("{", "{" + " ".repeat(CONTACT_MAX_BODY_BYTES));
    const res = await post(null, { raw: padded });
    expect(res.status).toBe(413);
    expect(res.json.code).toBe("CONTACT_TOO_LARGE");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("POST /v1/contact: abuse controls", () => {
  it("honeypot filled -> 400 CONTACT_REJECTED, nothing sent", async () => {
    const res = await post(validBody({ website: "https://spam.example.org" }));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("CONTACT_REJECTED");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("submitted too fast -> 400 CONTACT_TOO_FAST, nothing sent", async () => {
    const res = await post(validBody({ elapsedMs: 800 }));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("CONTACT_TOO_FAST");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it(`limits each client IP to ${CONTACT_RATE_LIMITS.perIp.limit} attempts per window (429), counting invalid ones`, async () => {
    const ip = "203.0.113.7";
    // Invalid attempts still count: they are checked in the guard, before validation.
    expect((await post(validBody({ email: "bad" }), { ip })).status).toBe(400);
    for (let i = 1; i < CONTACT_RATE_LIMITS.perIp.limit; i++) {
      expect((await post(validBody(), { ip })).status).toBe(200);
    }
    const blocked = await post(validBody(), { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.json.code).toBe("CONTACT_RATE_LIMITED");
    expect((await post(validBody(), { ip: "203.0.113.8" })).status).toBe(200);
  });

  it("keys the limit on the right-most X-Forwarded-For hop, so a forged left-most hop does not evade it", async () => {
    for (let i = 0; i < CONTACT_RATE_LIMITS.perIp.limit; i++) {
      expect((await post(validBody(), { ip: `10.0.0.${i}, 203.0.113.9` })).status).toBe(200);
    }
    expect((await post(validBody(), { ip: "10.9.9.9, 203.0.113.9" })).status).toBe(429);
  });

  it("rejects requests without an Origin, or from another origin (403), before anything else", async () => {
    for (const origin of [null, "https://evil.example.org", "http://suchitracancercare.org"]) {
      const res = await post(validBody(), { origin });
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("CONTACT_ORIGIN_NOT_ALLOWED");
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("CORS: preflight allows only the landing origins on /v1/contact; other routes keep the open default", async () => {
    const preflight = (path: string, origin: string) =>
      fetch(`${baseUrl}${path}`, {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
      });

    const allowed = await preflight("/v1/contact", ORIGIN);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST");

    const www = await preflight("/v1/contact", "https://www.suchitracancercare.org");
    expect(www.headers.get("access-control-allow-origin")).toBe("https://www.suchitracancercare.org");

    const denied = await preflight("/v1/contact", "https://evil.example.org");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();

    const otherRoute = await preflight("/v1/chat", "https://evil.example.org");
    expect(otherRoute.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("POST /v1/contact: not configured -> 503, nothing sent", () => {
  it.each([
    ["CONTACT_FORM_TO unset", () => delete process.env.CONTACT_FORM_TO],
    ["CONTACT_FORM_TO empty", () => (process.env.CONTACT_FORM_TO = "")],
    ["CONTACT_FORM_TO malformed", () => (process.env.CONTACT_FORM_TO = "inbox-at-example.org")],
    ["CONTACT_FORM_CC has a malformed entry", () => (process.env.CONTACT_FORM_CC = "ok@example.org, nope")],
  ])("%s", async (_label, mutate) => {
    mutate();
    const res = await post(validBody());
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("CONTACT_FORM_NOT_CONFIGURED");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("SMTP unset", async () => {
    await app.close();
    delete process.env.SMTP_HOST;
    await startApp();
    const res = await post(validBody());
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("CONTACT_FORM_NOT_CONFIGURED");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends with no Cc when CONTACT_FORM_CC is unset", async () => {
    delete process.env.CONTACT_FORM_CC;
    expect((await post(validBody())).status).toBe(200);
    expect(sendMail.mock.calls[0][0].cc).toBeUndefined();
  });
});

describe("POST /v1/contact: SMTP failure", () => {
  it("returns 502 CONTACT_SEND_FAILED so the page can show the fallback address", async () => {
    sendMail.mockRejectedValueOnce(new Error("550 5.1.1 mailbox unavailable"));
    const res = await post(validBody());
    expect(res.status).toBe(502);
    expect(res.json.code).toBe("CONTACT_SEND_FAILED");
  });
});

describe("POST /v1/contact: privacy of logs", () => {
  it("never logs the name, email address or message, on any path", async () => {
    await post(validBody()); // sent
    await post(validBody({ email: "bad\r\nx" })); // validation failure
    await post(validBody({ website: "x" })); // honeypot
    await post(validBody({ elapsedMs: 1 })); // too fast
    sendMail.mockRejectedValueOnce(new Error("421 try later"));
    await post(validBody()); // SMTP failure
    delete process.env.CONTACT_FORM_TO;
    await post(validBody()); // not configured
    for (let i = 0; i < 6; i++) await post(validBody(), { ip: "203.0.113.50" }); // rate limited

    expect(logLines.some((l) => /contact form: outcome=sent request=[0-9a-f]{8}$/.test(l))).toBe(true);
    expect(logLines.some((l) => l.includes("outcome=send_failed"))).toBe(true);
    expect(logLines.some((l) => l.includes("outcome=rate_limited_ip"))).toBe(true);
    expectNoVisitorDataInLogs();
  });
});
