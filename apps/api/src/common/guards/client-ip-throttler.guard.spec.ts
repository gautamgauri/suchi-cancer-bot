import "reflect-metadata";
import { Body, Controller, Get, INestApplication, Logger, Module, Post } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SkipThrottle, Throttle, ThrottlerModule } from "@nestjs/throttler";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AddressInfo } from "net";
import {
  ClientIpThrottlerGuard,
  RESOLUTION_LOG_INTERVAL_MS,
  SAFETY_BYPASS_LIMIT,
  SAFETY_BYPASS_TTL_MS,
  SafetyRoute,
  URGENCY_BYPASS_LIMIT,
  classifyClientAddress,
  resolveClientAddress,
  resolveClientIp,
  TRUSTED_PROXY_HOPS,
} from "./client-ip-throttler.guard";
import { PerKeyThrottlerStorage } from "./per-key-throttler-storage";
import * as deterministicSafety from "../../modules/chat/deterministic-safety";

describe("resolveClientIp", () => {
  it("uses the rightmost X-Forwarded-For entry (the one Cloud Run's front end appended)", () => {
    expect(resolveClientIp({ headers: { "x-forwarded-for": "203.0.113.7" } })).toBe("203.0.113.7");
    // Client-supplied leftmost entry is ignored — it is spoofable.
    expect(resolveClientIp({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" } })).toBe("203.0.113.7");
  });

  it("honours a larger hop count (external LB in front of Cloud Run)", () => {
    expect(resolveClientIp({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7, 34.1.2.3" } }, 2)).toBe("203.0.113.7");
  });

  it("falls back to req.ip / socket address without the header", () => {
    expect(resolveClientIp({ headers: {}, ip: "10.0.0.1" })).toBe("10.0.0.1");
    expect(resolveClientIp({ headers: {}, socket: { remoteAddress: "10.0.0.2" } })).toBe("10.0.0.2");
  });

  it("trusts exactly one hop by default (Cloud Run)", () => {
    expect(TRUSTED_PROXY_HOPS).toBe(1);
  });
});

describe("client address classification (PR #202 fail-open)", () => {
  it("treats ordinary public addresses as public", () => {
    expect(classifyClientAddress("203.0.113.7")).toBe("public");
    expect(classifyClientAddress("2001:db8::1")).toBe("public");
  });

  it("flags empty, invalid, private, loopback, CGNAT and Google front-end addresses", () => {
    expect(classifyClientAddress("")).toBe("empty");
    expect(classifyClientAddress("unknown")).toBe("empty");
    expect(classifyClientAddress(undefined)).toBe("empty");
    expect(classifyClientAddress("not-an-ip")).toBe("invalid");
    for (const ip of [
      "10.1.2.3",
      "172.20.0.5",
      "192.168.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "100.64.0.9",
      "35.191.10.20",
      "130.211.1.2",
      "::1",
      "fd00::5",
      "fe80::1",
      "::ffff:10.0.0.7",
    ]) {
      expect({ ip, cls: classifyClientAddress(ip) }).toEqual({ ip, cls: "private-or-google" });
    }
  });

  it("reports how many X-Forwarded-For entries there were and which was used", () => {
    expect(resolveClientAddress({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" } })).toEqual({
      ip: "203.0.113.7",
      entries: 2,
      position: 1,
    });
    expect(resolveClientAddress({ headers: {}, ip: "10.0.0.1" })).toEqual({ ip: "10.0.0.1", entries: 0, position: -1 });
  });
});

describe("X-Forwarded-For debug line", () => {
  let debug: jest.SpyInstance;
  beforeEach(() => {
    ClientIpThrottlerGuard.resetResolutionLog();
    debug = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });
  afterEach(() => debug.mockRestore());

  it("is emitted at most once per instance per interval, with counts and no address", () => {
    const resolved = resolveClientAddress({ headers: { "x-forwarded-for": "198.51.100.77, 203.0.113.99" } });
    expect(ClientIpThrottlerGuard.logResolution(resolved, 1_000_000)).toBe(true);
    expect(ClientIpThrottlerGuard.logResolution(resolved, 1_000_000 + RESOLUTION_LOG_INTERVAL_MS - 1)).toBe(false);
    expect(ClientIpThrottlerGuard.logResolution(resolved, 1_000_000 + RESOLUTION_LOG_INTERVAL_MS)).toBe(true);
    expect(debug).toHaveBeenCalledTimes(2);
    const line = String(debug.mock.calls[0][0]);
    expect(line).toContain("entries=2");
    expect(line).toContain("used position=1");
    expect(line).toContain("address class=public");
    expect(line).not.toContain("198.51.100.77");
    expect(line).not.toContain("203.0.113.99");
    expect(line).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("AppModule binds the throttler guard globally", () => {
  // AppModule's decorator calls ConfigModule.forRoot, which validates the
  // environment the moment the file is loaded. With DATABASE_URL and the admin
  // credentials unset (CI has no .env) that validation rejects, and the
  // unhandled rejection failed whichever test happened to be running. So the
  // module is loaded here, under placeholder values, and the environment is
  // put back afterwards.
  const REQUIRED_ENV = ["DATABASE_URL", "ADMIN_BASIC_USER", "ADMIN_BASIC_PASS"] as const;

  async function loadAppModule(): Promise<any> {
    const before = { ...process.env };
    for (const key of REQUIRED_ENV) {
      if (!process.env[key]) process.env[key] = "placeholder-for-spec";
    }
    try {
      const { AppModule } = await import("../../app.module");
      return AppModule;
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in before)) delete process.env[key];
      }
      for (const key of REQUIRED_ENV) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  }

  it("registers ClientIpThrottlerGuard as APP_GUARD", async () => {
    const AppModule = await loadAppModule();
    const providers: any[] = Reflect.getMetadata("providers", AppModule) ?? [];
    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: ClientIpThrottlerGuard });
    // sanity: not relying on per-controller @UseGuards
    expect(Reflect.getMetadata(GUARDS_METADATA, AppModule)).toBeUndefined();
  });
});

@Controller("t")
class TestController {
  @Get("limited")
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  limited() {
    return { ok: true };
  }

  @Get("skipped")
  @SkipThrottle()
  skipped() {
    return { ok: true };
  }

  @Get("safety")
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  @SafetyRoute()
  safety() {
    return { ok: true };
  }

  @Post("chat")
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  @SafetyRoute()
  chat(@Body() _body: unknown) {
    return { ok: true };
  }
}

@Module({
  // The same storage as production (review N6).
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }], storage: new PerKeyThrottlerStorage() })],
  controllers: [TestController],
  providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
})
class TestModule {}

describe("ClientIpThrottlerGuard over HTTP (trust proxy = 1, as in main.ts)", () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const a = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
    a.set("trust proxy", TRUSTED_PROXY_HOPS);
    await a.listen(0, "127.0.0.1");
    app = a;
    const { port } = a.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const hit = (path: string, xff: string) =>
    fetch(`${base}${path}`, { headers: { "x-forwarded-for": xff } }).then((r) => r.status);

  it("buckets by client IP: a spoofed leftmost XFF entry does not escape the limit", async () => {
    expect(await hit("/t/limited", "1.1.1.1, 198.51.100.10")).toBe(200);
    expect(await hit("/t/limited", "2.2.2.2, 198.51.100.10")).toBe(200);
    expect(await hit("/t/limited", "3.3.3.3, 198.51.100.10")).toBe(429);
  });

  it("different clients behind the same front end get separate buckets", async () => {
    // All requests share the same socket peer (127.0.0.1, standing in for the GFE).
    expect(await hit("/t/limited", "198.51.100.20")).toBe(200);
    expect(await hit("/t/limited", "198.51.100.20")).toBe(200);
    expect(await hit("/t/limited", "198.51.100.21")).toBe(200);
  });

  it("a safety route fails open when the resolved address is private or Google's", async () => {
    for (const xff of ["10.20.30.40", "35.191.3.4", "203.0.113.50, 130.211.0.9"]) {
      for (let i = 0; i < 4; i++) {
        expect({ xff, status: await hit("/t/safety", xff) }).toEqual({ xff, status: 200 });
      }
    }
  });

  it("a safety route still limits an ordinary public client", async () => {
    expect(await hit("/t/safety", "198.51.100.40")).toBe(200);
    expect(await hit("/t/safety", "198.51.100.40")).toBe(200);
    expect(await hit("/t/safety", "198.51.100.40")).toBe(429);
  });

  // PR #202: a rate-limited patient in an emergency got a 429, which the web
  // client shows as a generic error. Synthetic probe text from the safety specs.
  const post = (xff: string, userText: string) =>
    fetch(`${base}/t/chat`, {
      method: "POST",
      headers: { "x-forwarded-for": xff, "content-type": "application/json" },
      body: JSON.stringify({ channel: "web", userText }),
    }).then((r) => r.status);

  it("a chat message that trips an emergency, self-harm or crisis check is never rate-limited", async () => {
    const ip = "198.51.100.50";
    expect(await post(ip, "what is chemotherapy?")).toBe(201);
    expect(await post(ip, "what is chemotherapy?")).toBe(429);
    expect(await post(ip, "I am coughing up blood right now")).toBe(201);
    expect(await post(ip, "I want to kill myself")).toBe(201);
    expect(await post(ip, "I don't want to live anymore")).toBe(201);
    // A refusal template is not urgent and does not get round the limit.
    expect(await post(ip, "what dose of tamoxifen should I take")).toBe(429);
    expect(await post(ip, "what is chemotherapy?")).toBe(429);
  });

  // Review B1: the guard must screen the whole message, as the pipeline does.
  it.each([
    ["English self-harm", "I have some questions about my treatment plan. ".repeat(200) + " I want to kill myself"],
    ["Devanagari emergency", "मेरे इलाज के बारे में कुछ सवाल हैं। ".repeat(400) + " सांस नहीं आ रही"],
  ])("a %s phrase beyond 4096 characters still passes the limiter", async (_name, text) => {
    expect(text.length).toBeGreaterThan(4096);
    const ip = _name.startsWith("English") ? "198.51.100.61" : "198.51.100.62";
    expect(await post(ip, "what is chemotherapy?")).toBe(201);
    expect(await post(ip, "what is chemotherapy?")).toBe(429);
    expect(await post(ip, text)).toBe(201);
  });

  it("safety messages pass a spent limit up to their own cap, then get 429 with Retry-After", async () => {
    const before = ClientIpThrottlerGuard.safetyBypassLimit;
    ClientIpThrottlerGuard.safetyBypassLimit = 3;
    try {
      const ip = "198.51.100.70";
      // The first uses the route's own limit (1 a minute). The next three are
      // refused by it and let through by the safety cap.
      for (let i = 0; i < 4; i++) expect(await post(ip, "I am coughing up blood right now")).toBe(201);
      // Both are now used up, so the flood is stopped.
      const res = await fetch(`${base}/t/chat`, {
        method: "POST",
        headers: { "x-forwarded-for": ip, "content-type": "application/json" },
        body: JSON.stringify({ channel: "web", userText: "I am coughing up blood right now" }),
      });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).not.toBeNull();
    } finally {
      ClientIpThrottlerGuard.safetyBypassLimit = before;
    }
  });

  // Review N2: the screen can be slow on some inputs, so the guard runs it
  // only for a request that the route's limit would refuse.
  it("does not screen a request that is within its limit", async () => {
    const screen = jest.spyOn(deterministicSafety, "safetyBypassCategory");
    try {
      const ip = "198.51.100.80";
      expect(await post(ip, "I am coughing up blood right now")).toBe(201);
      expect(screen).not.toHaveBeenCalled();
      // The next one is over the limit, so it is screened, and let through.
      expect(await post(ip, "I am coughing up blood right now")).toBe(201);
      expect(screen).toHaveBeenCalledTimes(1);
      // A let-through request does not carry the refusal's Retry-After header.
      const res = await fetch(`${base}/t/chat`, {
        method: "POST",
        headers: { "x-forwarded-for": ip, "content-type": "application/json" },
        body: JSON.stringify({ channel: "web", userText: "I want to kill myself" }),
      });
      expect(res.status).toBe(201);
      expect(res.headers.get("retry-after")).toBeNull();
    } finally {
      screen.mockRestore();
    }
  });

  // Review F2: an urgency-only message past the limit got a 429, where main
  // never refused it. It now has its own, lower cap.
  it("urgency-only messages pass a spent limit up to their own cap", async () => {
    const before = ClientIpThrottlerGuard.urgencyBypassLimit;
    ClientIpThrottlerGuard.urgencyBypassLimit = 2;
    try {
      const ip = "198.51.100.90";
      expect(await post(ip, "what is chemotherapy?")).toBe(201);
      expect(await post(ip, "what is chemotherapy?")).toBe(429);
      expect(await post(ip, "coughed up blood")).toBe(201);
      expect(await post(ip, "coughed up blood")).toBe(201);
      // The urgency cap is used up, so the next one is refused.
      expect(await post(ip, "coughed up blood")).toBe(429);
      // The emergency cap is separate and still has room.
      expect(await post(ip, "I am coughing up blood right now")).toBe(201);
    } finally {
      ClientIpThrottlerGuard.urgencyBypassLimit = before;
    }
  });

  it("the production caps are 300 and 30 a minute", () => {
    expect(SAFETY_BYPASS_LIMIT).toBe(300);
    expect(URGENCY_BYPASS_LIMIT).toBe(30);
    expect(SAFETY_BYPASS_TTL_MS).toBe(60_000);
  });

  it("@SkipThrottle routes are never throttled", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await hit("/t/skipped", "198.51.100.30")).toBe(200);
    }
  });
});
