import "reflect-metadata";
import { Controller, Get, INestApplication, Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SkipThrottle, Throttle, ThrottlerModule } from "@nestjs/throttler";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AddressInfo } from "net";
import { ClientIpThrottlerGuard, resolveClientIp, TRUSTED_PROXY_HOPS } from "./client-ip-throttler.guard";
import { AppModule } from "../../app.module";

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

describe("AppModule binds the throttler guard globally", () => {
  it("registers ClientIpThrottlerGuard as APP_GUARD", () => {
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
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] })],
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

  it("@SkipThrottle routes are never throttled", async () => {
    for (let i = 0; i < 5; i++) {
      expect(await hit("/t/skipped", "198.51.100.30")).toBe(200);
    }
  });
});
