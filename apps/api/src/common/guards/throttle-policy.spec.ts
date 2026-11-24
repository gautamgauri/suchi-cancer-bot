import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { HealthController } from "../../modules/health/health.controller";
import { WhatsAppController } from "../../modules/whatsapp/whatsapp.controller";
import { AdminController } from "../../modules/admin/admin.controller";
import { ReviewController } from "../../modules/review/review.controller";
import { ChatController } from "../../modules/chat/chat.controller";
import { SessionsController } from "../../modules/sessions/sessions.controller";
import { VoiceController } from "../../modules/voice/voice.controller";
import { WhatsAppNavigatorController } from "../../modules/whatsapp-navigator/whatsapp-navigator.controller";
import { SchedulerOidcGuard } from "./scheduler-oidc.guard";
import { SAFETY_ROUTE_KEY } from "./client-ip-throttler.guard";

/**
 * Pins the rate-limit policy now that ClientIpThrottlerGuard is global.
 * @nestjs/throttler v6 TTLs are MILLISECONDS — a `ttl: 60` meant "60 ms" and
 * made the limit meaningless, so every explicit TTL must be >= 1000.
 */
const SKIP = "THROTTLER:SKIPdefault";
const LIMIT = "THROTTLER:LIMITdefault";
const TTL = "THROTTLER:TTLdefault";

describe("throttle policy", () => {
  it("health and the Meta WhatsApp webhook are never throttled", () => {
    expect(Reflect.getMetadata(SKIP, HealthController)).toBe(true);
    expect(Reflect.getMetadata(SKIP, WhatsAppController)).toBe(true);
  });

  it("every Cloud Scheduler (OIDC) admin route skips throttling", () => {
    const proto = AdminController.prototype as any;
    const schedulerRoutes = Object.getOwnPropertyNames(proto).filter((name) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? [];
      return guards.includes(SchedulerOidcGuard);
    });
    expect(schedulerRoutes.length).toBeGreaterThanOrEqual(8);
    for (const name of schedulerRoutes) {
      expect({ name, skip: Reflect.getMetadata(SKIP, proto[name]) }).toEqual({ name, skip: true });
    }
  });

  it("admin and review portals get a higher class-level limit", () => {
    for (const c of [AdminController, ReviewController]) {
      expect(Reflect.getMetadata(LIMIT, c)).toBe(120);
      expect(Reflect.getMetadata(TTL, c)).toBe(60_000);
    }
  });

  it("the legacy navigator webhook has an explicit limit (caller unknown, not Meta)", () => {
    const handler = (WhatsAppNavigatorController.prototype as any).handleWebhook;
    expect(Reflect.getMetadata(LIMIT, handler)).toBe(60);
    expect(Reflect.getMetadata(TTL, handler)).toBe(60_000);
  });

  it("the routes a patient needs in an emergency are marked as safety routes", () => {
    expect(Reflect.getMetadata(SAFETY_ROUTE_KEY, (ChatController.prototype as any).send)).toBe(true);
    expect(Reflect.getMetadata(SAFETY_ROUTE_KEY, (SessionsController.prototype as any).create)).toBe(true);
    expect(Reflect.getMetadata(SAFETY_ROUTE_KEY, (VoiceController.prototype as any).respond)).toBe(true);
  });

  it("route-level TTLs are in milliseconds", () => {
    for (const ctrl of [ChatController, VoiceController, SessionsController, WhatsAppNavigatorController] as any[]) {
      const proto = ctrl.prototype;
      const ttls = Object.getOwnPropertyNames(proto)
        .map((name) => ({ name, ttl: Reflect.getMetadata(TTL, proto[name]) }))
        .filter((r) => r.ttl !== undefined);
      expect(ttls.length).toBeGreaterThan(0);
      for (const r of ttls) expect(r).toEqual({ name: r.name, ttl: 60_000 });
    }
  });
});
